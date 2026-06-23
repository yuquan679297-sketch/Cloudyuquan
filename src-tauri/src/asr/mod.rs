// ASR module — Doubao Seed-ASR WebSocket adapter for 语枢 (VoiceHub).

mod client;
mod retry;

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose, Engine as _};
pub use client::RuntimeAsrConfig;
use client::{Config, DoubaoAsrClient, LiveAudioMessage};
use retry::RetryConfig;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, OnceLock,
};
use tauri::{AppHandle, Emitter, Listener};
use tokio::{
    sync::{mpsc, Mutex},
    time::timeout,
};

static HOTWORDS: OnceLock<Arc<Mutex<Vec<HotwordEntry>>>> = OnceLock::new();
static ASR_CONFIG: OnceLock<Arc<Mutex<Option<RuntimeAsrConfig>>>> = OnceLock::new();
static LIVE_PREVIEW_SENDER: OnceLock<Arc<Mutex<Option<mpsc::Sender<LiveAudioMessage>>>>> =
    OnceLock::new();
static LISTENER_REGISTERED: AtomicBool = AtomicBool::new(false);
const DEFAULT_HOTWORD_WEIGHT: u8 = 7;

#[derive(Clone)]
pub(crate) struct HotwordEntry {
    pub word: String,
    pub weight: u8,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PcmReadyPayload {
    pcm_base64: String,
    byte_length: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PcmPreviewChunkPayload {
    pcm_base64: String,
    byte_length: usize,
}

#[derive(Clone, Serialize)]
struct AsrErrorPayload {
    message: String,
}

#[derive(Clone, Serialize)]
struct AsrFallbackPayload {
    message: String,
}

pub fn register_listener(app: AppHandle) {
    if LISTENER_REGISTERED.swap(true, Ordering::SeqCst) {
        return;
    }

    let hotwords_store = hotwords();
    let listener_app = app.clone();
    let pcm_hotwords = hotwords_store.clone();
    app.listen_any("asr://pcm-ready", move |event| {
        let app = listener_app.clone();
        let hotwords = pcm_hotwords.clone();
        let payload = event.payload().to_string();

        tokio::spawn(async move {
            log::info!("ASR received asr://pcm-ready event");
            if let Err(error) = handle_pcm_ready(app.clone(), hotwords, &payload).await {
                emit_asr_error(&app, error.to_string());
            }
        });
    });

    let preview_start_app = app.clone();
    app.listen_any("asr://preview-start", move |_| {
        let app = preview_start_app.clone();
        tokio::spawn(async move {
            reset_live_preview_sender().await;
            if let Err(error) = app.emit("asr://live-preview", LivePreviewText::empty()) {
                log::error!("failed to emit empty live preview: {error}");
            }
        });
    });

    let preview_chunk_app = app.clone();
    let preview_hotwords = hotwords_store.clone();
    app.listen_any("asr://preview-chunk", move |event| {
        let app = preview_chunk_app.clone();
        let hotwords = preview_hotwords.clone();
        let payload = event.payload().to_string();
        tokio::spawn(async move {
            if let Err(error) = handle_preview_chunk(app, hotwords, &payload).await {
                log::warn!("ASR live preview skipped chunk: {error:#}");
            }
        });
    });

    app.listen_any("asr://preview-end", move |_| {
        tokio::spawn(async move {
            finish_live_preview().await;
        });
    });

    log::info!("ASR listener registered for pcm-ready and live preview events");
}

#[tauri::command]
pub async fn init_asr(app: AppHandle) -> Result<String, String> {
    register_listener(app);
    Ok("asr module ready".to_string())
}

#[tauri::command]
pub async fn set_hotwords(words: Vec<String>) -> Result<(), String> {
    let hotwords_store = hotwords();
    let mut hotwords = hotwords_store.lock().await;
    *hotwords = normalize_hotwords(words);
    log::info!("ASR hotwords updated: {} item(s)", hotwords.len());
    Ok(())
}

#[tauri::command]
pub async fn set_asr_key(key: String) -> Result<(), String> {
    let trimmed = key.trim().to_string();
    if trimmed.is_empty() {
        return Err("豆包 ASR Key 不能为空".to_string());
    }

    let config_store = asr_config();
    let mut runtime_config = config_store.lock().await;
    *runtime_config = Some(RuntimeAsrConfig {
        api_key: Some(trimmed),
        ..RuntimeAsrConfig::default()
    });
    log::info!("ASR runtime key updated from UI");
    Ok(())
}

#[tauri::command]
pub async fn set_asr_config(config: RuntimeAsrConfig) -> Result<(), String> {
    let config_store = asr_config();
    let mut runtime_config = config_store.lock().await;
    *runtime_config = Some(config);
    log::info!("ASR runtime config updated from UI");
    Ok(())
}

async fn handle_pcm_ready(
    app: AppHandle,
    hotwords: Arc<Mutex<Vec<HotwordEntry>>>,
    payload: &str,
) -> Result<()> {
    let payload: PcmReadyPayload =
        serde_json::from_str(payload).context("failed to parse pcm-ready payload")?;
    log::info!(
        "ASR starting recognition for {} PCM byte(s)",
        payload.byte_length
    );

    let pcm = general_purpose::STANDARD
        .decode(payload.pcm_base64)
        .context("failed to decode pcm-ready base64 payload")?;
    if pcm.is_empty() {
        return Err(anyhow!("PCM payload is empty"));
    }

    let runtime_config = asr_config().lock().await.clone();
    let config = Config::from_runtime_config_or_env(runtime_config)?;
    let client = DoubaoAsrClient::new(config.clone(), app.clone(), hotwords);

    if !client.network_available().await {
        log::info!("ASR network unavailable, emitting fallback event");
        app.emit(
            "asr://fallback",
            AsrFallbackPayload {
                message: "offline mode".to_string(),
            },
        )
        .context("failed to emit asr fallback event")?;
        return Ok(());
    }

    let retry_config = RetryConfig::default();
    let recognition = retry::run(retry_config, |attempt| {
        let client = client.clone();
        let pcm = pcm.clone();
        async move {
            log::info!("ASR recognition attempt {attempt} started");
            client.recognize_once(pcm).await
        }
    });

    match timeout(config.full_recognition_timeout, recognition).await {
        Ok(Ok(())) => {
            log::info!("ASR recognition completed");
            Ok(())
        }
        Ok(Err(error)) => Err(error),
        Err(_) => Err(anyhow!("ASR recognition timed out after 30s")),
    }
}

async fn handle_preview_chunk(
    app: AppHandle,
    hotwords: Arc<Mutex<Vec<HotwordEntry>>>,
    payload: &str,
) -> Result<()> {
    let payload: PcmPreviewChunkPayload =
        serde_json::from_str(payload).context("failed to parse preview-chunk payload")?;
    let pcm = general_purpose::STANDARD
        .decode(payload.pcm_base64)
        .context("failed to decode preview-chunk base64 payload")?;
    if pcm.is_empty() {
        return Ok(());
    }

    let sender = ensure_live_preview_sender(app, hotwords).await?;
    if sender.send(LiveAudioMessage::Chunk(pcm)).await.is_err() {
        reset_live_preview_sender().await;
        return Err(anyhow!("live preview receiver is closed"));
    }
    log::debug!(
        "ASR live preview queued {} PCM byte(s)",
        payload.byte_length
    );
    Ok(())
}

async fn ensure_live_preview_sender(
    app: AppHandle,
    hotwords: Arc<Mutex<Vec<HotwordEntry>>>,
) -> Result<mpsc::Sender<LiveAudioMessage>> {
    let sender_store = live_preview_sender();
    let mut sender = sender_store.lock().await;
    if let Some(sender) = sender.as_ref() {
        return Ok(sender.clone());
    }

    let runtime_config = asr_config().lock().await.clone();
    let config = Config::from_runtime_config_or_env(runtime_config)?;
    let client = DoubaoAsrClient::new(config, app.clone(), hotwords);
    let (tx, rx) = mpsc::channel(32);
    *sender = Some(tx.clone());

    tokio::spawn(async move {
        if !client.network_available().await {
            log::info!("ASR live preview network unavailable");
            return;
        }

        if let Err(error) = client.recognize_live_preview(rx).await {
            log::warn!("ASR live preview stopped: {error:#}");
            let _ = app.emit(
                "asr://live-preview-error",
                AsrErrorPayload {
                    message: error.to_string(),
                },
            );
        }
    });

    Ok(tx)
}

async fn reset_live_preview_sender() {
    let sender_store = live_preview_sender();
    let mut sender = sender_store.lock().await;
    *sender = None;
}

async fn finish_live_preview() {
    let sender_store = live_preview_sender();
    let mut sender = sender_store.lock().await;
    if let Some(sender) = sender.take() {
        let _ = sender.send(LiveAudioMessage::End).await;
    }
}

fn emit_asr_error(app: &AppHandle, message: String) {
    log::error!("ASR error: {message}");
    if let Err(error) = app.emit("asr://error", AsrErrorPayload { message }) {
        log::error!("failed to emit asr error event: {error}");
    }
}

#[derive(Clone, Serialize)]
struct LivePreviewText {
    text: String,
    pass: &'static str,
    #[serde(rename = "isFinal")]
    is_final: bool,
}

impl LivePreviewText {
    fn empty() -> Self {
        Self {
            text: String::new(),
            pass: "start",
            is_final: false,
        }
    }
}

fn hotwords() -> Arc<Mutex<Vec<HotwordEntry>>> {
    HOTWORDS
        .get_or_init(|| Arc::new(Mutex::new(Vec::new())))
        .clone()
}

fn live_preview_sender() -> Arc<Mutex<Option<mpsc::Sender<LiveAudioMessage>>>> {
    LIVE_PREVIEW_SENDER
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone()
}

fn asr_config() -> Arc<Mutex<Option<RuntimeAsrConfig>>> {
    ASR_CONFIG
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone()
}

fn normalize_hotwords(words: Vec<String>) -> Vec<HotwordEntry> {
    let mut normalized = Vec::new();

    for word in words {
        let word = word.trim();
        if !word.is_empty()
            && !normalized
                .iter()
                .any(|existing: &HotwordEntry| existing.word == word)
        {
            normalized.push(HotwordEntry {
                word: word.to_string(),
                weight: DEFAULT_HOTWORD_WEIGHT,
            });
        }
    }

    normalized
}
