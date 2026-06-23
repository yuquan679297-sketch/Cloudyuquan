// Audio module — receives browser-captured 16kHz mono PCM over a local WebSocket proxy.

use anyhow::Result;
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{broadcast, Mutex},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

const WS_ADDR: &str = "127.0.0.1:8765";
const SILENCE_THRESHOLD: f32 = 0.01;
const SILENCE_CHUNKS_TO_NOTIFY: u32 = 3;

static SERVER: OnceLock<Arc<AudioServer>> = OnceLock::new();

#[derive(Clone)]
struct AudioServer {
    pcm: Arc<Mutex<Vec<u8>>>,
    events: broadcast::Sender<AudioEvent>,
}

#[derive(Clone)]
enum AudioEvent {
    PreviewStart,
    PreviewChunk(Vec<u8>),
    PreviewEnd,
    PcmReady(Vec<u8>),
    VadSilence { rms: f32, chunks: u32 },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PcmReadyPayload {
    pcm_base64: String,
    byte_length: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewChunkPayload {
    pcm_base64: String,
    byte_length: usize,
}

#[derive(Clone, Serialize)]
struct VadPayload {
    #[serde(rename = "type")]
    event_type: &'static str,
    rms: f32,
    #[serde(rename = "consecutiveSilenceChunks")]
    consecutive_silence_chunks: u32,
}

#[tauri::command]
pub async fn init(app: AppHandle) -> Result<String, String> {
    if SERVER.get().is_some() {
        return Ok("audio module ready".to_string());
    }

    let (events, _) = broadcast::channel(16);
    let server = Arc::new(AudioServer {
        pcm: Arc::new(Mutex::new(Vec::new())),
        events,
    });
    let listener = TcpListener::bind(WS_ADDR)
        .await
        .map_err(|error| format!("failed to bind audio websocket server on {WS_ADDR}: {error}"))?;

    if SERVER.set(server.clone()).is_ok() {
        tokio::spawn(run_event_emitter(app, server.events.subscribe()));
        tokio::spawn(async move {
            if let Err(error) = run_ws_server(listener, server).await {
                log::error!("audio websocket server stopped: {error:#}");
            }
        });
    }

    Ok("audio module ready".to_string())
}

async fn run_ws_server(listener: TcpListener, server: Arc<AudioServer>) -> Result<()> {
    log::info!("audio websocket server listening on ws://{WS_ADDR}");

    loop {
        let (stream, _) = listener.accept().await?;
        if let Err(error) = handle_connection(stream, server.clone()).await {
            log::warn!("audio websocket connection ended: {error:#}");
        }
    }
}

async fn handle_connection(stream: TcpStream, server: Arc<AudioServer>) -> Result<()> {
    let mut socket = accept_async(stream).await?;
    let mut consecutive_silence = 0;
    log::info!("audio websocket client connected");

    {
        let mut pcm = server.pcm.lock().await;
        pcm.clear();
    }
    let _ = server.events.send(AudioEvent::PreviewStart);

    while let Some(message) = socket.next().await {
        match message? {
            Message::Binary(chunk) => {
                let rms = rms_energy(&chunk);
                if rms < SILENCE_THRESHOLD {
                    consecutive_silence += 1;
                    if consecutive_silence == SILENCE_CHUNKS_TO_NOTIFY {
                        log::info!(
                            "audio VAD silence detected: rms={rms:.4}, chunks={consecutive_silence}"
                        );
                        let _ = server.events.send(AudioEvent::VadSilence {
                            rms,
                            chunks: consecutive_silence,
                        });
                    }
                } else {
                    consecutive_silence = 0;
                }

                let mut pcm = server.pcm.lock().await;
                pcm.extend_from_slice(&chunk);
                let _ = server.events.send(AudioEvent::PreviewChunk(chunk.to_vec()));
            }
            Message::Text(text) if text == "END_OF_STREAM" => {
                let pcm = server.pcm.lock().await.clone();
                log::info!(
                    "audio websocket received END_OF_STREAM, {} bytes PCM captured",
                    pcm.len()
                );
                let _ = server.events.send(AudioEvent::PreviewEnd);
                let _ = server.events.send(AudioEvent::PcmReady(pcm));
                break;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    Ok(())
}

async fn run_event_emitter(app: AppHandle, mut rx: broadcast::Receiver<AudioEvent>) {
    loop {
        match rx.recv().await {
            Ok(AudioEvent::PreviewStart) => {
                if let Err(error) = app.emit("asr://preview-start", ()) {
                    log::error!("failed to emit preview-start event: {error}");
                }
            }
            Ok(AudioEvent::PreviewChunk(chunk)) => {
                let payload = PreviewChunkPayload {
                    pcm_base64: base64_encode(&chunk),
                    byte_length: chunk.len(),
                };
                if let Err(error) = app.emit("asr://preview-chunk", payload) {
                    log::error!("failed to emit preview-chunk event: {error}");
                }
            }
            Ok(AudioEvent::PreviewEnd) => {
                if let Err(error) = app.emit("asr://preview-end", ()) {
                    log::error!("failed to emit preview-end event: {error}");
                }
            }
            Ok(AudioEvent::PcmReady(pcm)) => {
                let payload = PcmReadyPayload {
                    pcm_base64: base64_encode(&pcm),
                    byte_length: pcm.len(),
                };
                if let Err(error) = app.emit("asr://pcm-ready", payload) {
                    log::error!("failed to emit pcm-ready event: {error}");
                }
            }
            Ok(AudioEvent::VadSilence { rms, chunks }) => {
                let payload = VadPayload {
                    event_type: "silence",
                    rms,
                    consecutive_silence_chunks: chunks,
                };
                if let Err(error) = app.emit("asr://vad-silence", payload) {
                    log::error!("failed to emit vad-silence event: {error}");
                }
            }
            Err(broadcast::error::RecvError::Lagged(skipped)) => {
                log::warn!("audio event emitter skipped {skipped} events");
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }
}

fn rms_energy(bytes: &[u8]) -> f32 {
    let mut sum = 0.0_f32;
    let mut samples = 0_u32;

    for sample in bytes.chunks_exact(2) {
        let value = i16::from_le_bytes([sample[0], sample[1]]) as f32 / 32768.0;
        sum += value * value;
        samples += 1;
    }

    if samples == 0 {
        return 0.0;
    }

    (sum / samples as f32).sqrt()
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);

        output.push(TABLE[(b0 >> 2) as usize] as char);
        output.push(TABLE[(((b0 & 0b0000_0011) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            output.push(TABLE[(((b1 & 0b0000_1111) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            output.push('=');
        }
        if chunk.len() > 2 {
            output.push(TABLE[(b2 & 0b0011_1111) as usize] as char);
        } else {
            output.push('=');
        }
    }

    output
}
