// Doubao WebSocket client — streams PCM and emits ASR events for 语枢 (VoiceHub).

use super::HotwordEntry;
use anyhow::{anyhow, Context, Result};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    io::{Read, Write},
    sync::Arc,
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpStream,
    sync::{mpsc, Mutex},
    task::JoinHandle,
    time::timeout,
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Error as WsError, Message},
};

const PCM_CHUNK_BYTES: usize = 6400;
const CER_ESTIMATE: f32 = 0.053;
const HEADER_SIZE: u8 = 0x1;
const PROTOCOL_VERSION: u8 = 0x1;
const MESSAGE_TYPE_FULL_CLIENT_REQUEST: u8 = 0x1;
const MESSAGE_TYPE_AUDIO_ONLY_REQUEST: u8 = 0x2;
const MESSAGE_TYPE_FULL_SERVER_RESPONSE: u8 = 0x9;
const MESSAGE_TYPE_ERROR: u8 = 0xf;
const FLAG_NONE: u8 = 0x0;
const FLAG_SEQUENCE_POSITIVE: u8 = 0x1;
const FLAG_LAST_PACKAGE: u8 = 0x2;
const FLAG_SEQUENCE_NEGATIVE: u8 = 0x3;
const SERIALIZATION_NONE: u8 = 0x0;
const SERIALIZATION_JSON: u8 = 0x1;
const COMPRESSION_GZIP: u8 = 0x1;
const MAX_INJECTED_HOTWORDS: usize = 180;

#[derive(Clone)]
pub struct Config {
    pub endpoint: String,
    pub network_check_addr: String,
    credentials: Credentials,
    pub uid: String,
    pub model_name: String,
    pub sample_rate: u32,
    pub bits: u8,
    pub channel: u8,
    pub language: String,
    pub connect_timeout: Duration,
    pub send_timeout: Duration,
    pub response_timeout: Duration,
    pub network_timeout: Duration,
    pub full_recognition_timeout: Duration,
    pub chunk_delay: Duration,
}

#[derive(Clone)]
enum Credentials {
    ApiKey {
        api_key: String,
        resource_id: String,
    },
    AppAccess {
        app_key: String,
        access_key: String,
        resource_id: String,
    },
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAsrConfig {
    pub api_key: Option<String>,
    pub app_key: Option<String>,
    pub access_key: Option<String>,
    pub resource_id: Option<String>,
    pub endpoint: Option<String>,
}

impl Config {
    pub fn from_runtime_config_or_env(runtime_config: Option<RuntimeAsrConfig>) -> Result<Self> {
        let runtime_config = runtime_config.unwrap_or_default();
        let endpoint = clean(runtime_config.endpoint.clone())
            .or_else(|| env_value("DOUBAO_ASR_ENDPOINT"))
            .unwrap_or_else(|| {
                "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async".to_string()
            });
        let credentials = credentials_from_runtime_or_env(runtime_config)?;

        Ok(Self {
            endpoint,
            network_check_addr: "openspeech.bytedance.com:443".to_string(),
            credentials,
            uid: "voicehub-user".to_string(),
            model_name: "bigmodel".to_string(),
            sample_rate: 16000,
            bits: 16,
            channel: 1,
            language: "zh-CN".to_string(),
            connect_timeout: Duration::from_secs(5),
            send_timeout: Duration::from_secs(5),
            response_timeout: Duration::from_secs(30),
            network_timeout: Duration::from_secs(2),
            full_recognition_timeout: Duration::from_secs(30),
            chunk_delay: Duration::from_millis(20),
        })
    }
}

fn credentials_from_runtime_or_env(config: RuntimeAsrConfig) -> Result<Credentials> {
    let app_key = clean(config.app_key).or_else(|| env_value("DOUBAO_ASR_APP_KEY"));
    let access_key = clean(config.access_key).or_else(|| env_value("DOUBAO_ASR_ACCESS_KEY"));
    let resource_id = clean(config.resource_id)
        .or_else(|| env_value("DOUBAO_ASR_RESOURCE_ID"))
        .unwrap_or_else(default_resource_id);
    let has_advanced = app_key.is_some() || access_key.is_some();

    if has_advanced {
        let app_key = app_key.ok_or_else(|| anyhow!("高级配置缺少 App Key"))?;
        let access_key = access_key.ok_or_else(|| anyhow!("高级配置缺少 Access Key"))?;
        return Ok(Credentials::AppAccess {
            app_key,
            access_key,
            resource_id,
        });
    }

    let api_key = clean(config.api_key).or_else(|| env_value("DOUBAO_ASR_KEY"));
    match api_key {
        Some(api_key) => Ok(Credentials::ApiKey {
            api_key,
            resource_id,
        }),
        None => Err(anyhow!(
            "请先填写豆包 ASR 凭证，或设置 DOUBAO_ASR_KEY / DOUBAO_ASR_APP_KEY 环境变量"
        )),
    }
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn env_value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn default_resource_id() -> String {
    "volc.seedasr.sauc.duration".to_string()
}

fn request_id() -> String {
    let mut bytes = [0_u8; 16];
    for byte in &mut bytes {
        *byte = rand::random();
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
    )
}

#[derive(Clone)]
pub struct DoubaoAsrClient {
    config: Config,
    app: AppHandle,
    hotwords: Arc<Mutex<Vec<HotwordEntry>>>,
}

#[derive(Deserialize)]
struct AsrResponse {
    result: Option<Value>,
    is_final: Option<bool>,
}

#[derive(Clone, Serialize)]
struct PartialPayload {
    text: String,
    pass: &'static str,
}

#[derive(Clone, Serialize)]
struct FinalPayload {
    text: String,
    pass: &'static str,
    cer_estimate: f32,
    confidence: Option<f32>,
}

#[derive(Clone, Serialize)]
struct CompletePayload {
    is_final: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivePreviewPayload {
    text: String,
    pass: &'static str,
    is_final: bool,
}

pub enum LiveAudioMessage {
    Chunk(Vec<u8>),
    End,
}

#[derive(Clone, Copy)]
enum EmitMode {
    Final,
    LivePreview,
}

impl DoubaoAsrClient {
    pub fn new(config: Config, app: AppHandle, hotwords: Arc<Mutex<Vec<HotwordEntry>>>) -> Self {
        Self {
            config,
            app,
            hotwords,
        }
    }

    pub async fn network_available(&self) -> bool {
        matches!(
            timeout(
                self.config.network_timeout,
                TcpStream::connect(&self.config.network_check_addr)
            )
            .await,
            Ok(Ok(_))
        )
    }

    pub async fn recognize_once(&self, pcm: Vec<u8>) -> Result<()> {
        let request = self.connect_request()?;
        let connect_result = timeout(self.config.connect_timeout, connect_async(request))
            .await
            .context("Doubao ASR connect timed out")?;
        let (mut websocket, _) = match connect_result {
            Ok(connection) => connection,
            Err(WsError::Http(response))
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 =>
            {
                return Err(anyhow!("{}", auth_error_message(&response)));
            }
            Err(error) => return Err(anyhow!("Doubao ASR connect failed: {error}")),
        };
        log::info!("ASR websocket connected to Doubao");

        let handshake = self.opening_handshake().await;
        timeout(
            self.config.send_timeout,
            websocket.send(Message::Binary(full_client_request_frame(&handshake)?)),
        )
        .await
        .context("ASR opening handshake send timed out")?
        .context("ASR opening handshake send failed")?;
        log::info!("ASR opening handshake sent");

        match timeout(self.config.response_timeout, websocket.next()).await {
            Ok(Some(Ok(message))) => {
                log::info!("ASR opening handshake ACK received");
                self.handle_message(message)?;
            }
            Ok(Some(Err(error))) => return Err(anyhow!("ASR opening handshake failed: {error}")),
            Ok(None) => return Err(anyhow!("ASR websocket closed before handshake ACK")),
            Err(_) => return Err(anyhow!("ASR opening handshake ACK timed out")),
        }

        let (mut sink, mut stream) = websocket.split();
        let send_timeout = self.config.send_timeout;
        let chunk_delay = self.config.chunk_delay;
        let send_task: JoinHandle<Result<()>> = tokio::spawn(async move {
            let chunks: Vec<&[u8]> = pcm.chunks(PCM_CHUNK_BYTES).collect();
            for (index, chunk) in chunks.iter().enumerate() {
                let is_last = index + 1 == chunks.len();
                timeout(
                    send_timeout,
                    sink.send(Message::Binary(audio_request_frame(chunk, is_last)?)),
                )
                .await
                .context("ASR audio chunk send timed out")?
                .context("ASR audio chunk send failed")?;
                tokio::time::sleep(chunk_delay).await;
            }
            log::info!("ASR audio stream sent");
            Ok(())
        });
        tokio::pin!(send_task);

        let mut send_done = false;
        loop {
            tokio::select! {
                result = &mut send_task, if !send_done => {
                    send_done = true;
                    result.context("ASR send task join failed")??;
                }
                message = timeout(self.config.response_timeout, stream.next()) => {
                    let message = match message {
                        Ok(Some(Ok(message))) => message,
                        Ok(Some(Err(error))) => return Err(anyhow!("ASR websocket receive failed: {error}")),
                        Ok(None) => return Err(anyhow!("ASR websocket closed before completion")),
                        Err(_) => return Err(anyhow!("ASR websocket response timed out")),
                    };

                    if self.handle_message(message)? {
                        if !send_done {
                            send_task.abort();
                        }
                        return Ok(());
                    }
                }
            }
        }
    }

    pub async fn recognize_live_preview(
        &self,
        mut receiver: mpsc::Receiver<LiveAudioMessage>,
    ) -> Result<()> {
        let request = self.connect_request()?;
        let connect_result = timeout(self.config.connect_timeout, connect_async(request))
            .await
            .context("Doubao ASR live preview connect timed out")?;
        let (mut websocket, _) = match connect_result {
            Ok(connection) => connection,
            Err(WsError::Http(response))
                if response.status().as_u16() == 401 || response.status().as_u16() == 403 =>
            {
                return Err(anyhow!("{}", auth_error_message(&response)));
            }
            Err(error) => return Err(anyhow!("Doubao ASR live preview connect failed: {error}")),
        };
        log::info!("ASR live preview websocket connected to Doubao");

        let handshake = self.opening_handshake().await;
        timeout(
            self.config.send_timeout,
            websocket.send(Message::Binary(full_client_request_frame(&handshake)?)),
        )
        .await
        .context("ASR live preview opening handshake send timed out")?
        .context("ASR live preview opening handshake send failed")?;
        log::info!("ASR live preview opening handshake sent");

        match timeout(self.config.response_timeout, websocket.next()).await {
            Ok(Some(Ok(message))) => {
                log::info!("ASR live preview opening handshake ACK received");
                self.handle_message_with_mode(message, EmitMode::LivePreview)?;
            }
            Ok(Some(Err(error))) => {
                return Err(anyhow!(
                    "ASR live preview opening handshake failed: {error}"
                ))
            }
            Ok(None) => {
                return Err(anyhow!(
                    "ASR live preview websocket closed before handshake ACK"
                ))
            }
            Err(_) => return Err(anyhow!("ASR live preview opening handshake ACK timed out")),
        }

        let (mut sink, mut stream) = websocket.split();
        let send_timeout = self.config.send_timeout;
        let send_task: JoinHandle<Result<()>> = tokio::spawn(async move {
            let mut pending_chunk: Option<Vec<u8>> = None;
            while let Some(message) = receiver.recv().await {
                match message {
                    LiveAudioMessage::Chunk(chunk) => {
                        if let Some(previous_chunk) = pending_chunk.replace(chunk) {
                            timeout(
                                send_timeout,
                                sink.send(Message::Binary(audio_request_frame(
                                    &previous_chunk,
                                    false,
                                )?)),
                            )
                            .await
                            .context("ASR live preview audio chunk send timed out")?
                            .context("ASR live preview audio chunk send failed")?;
                        }
                    }
                    LiveAudioMessage::End => {
                        if let Some(last_chunk) = pending_chunk.take() {
                            timeout(
                                send_timeout,
                                sink.send(Message::Binary(audio_request_frame(&last_chunk, true)?)),
                            )
                            .await
                            .context("ASR live preview final audio chunk send timed out")?
                            .context("ASR live preview final audio chunk send failed")?;
                        }
                        log::info!("ASR live preview audio stream sent");
                        return Ok(());
                    }
                }
            }

            if let Some(last_chunk) = pending_chunk.take() {
                timeout(
                    send_timeout,
                    sink.send(Message::Binary(audio_request_frame(&last_chunk, true)?)),
                )
                .await
                .context("ASR live preview final audio chunk send timed out")?
                .context("ASR live preview final audio chunk send failed")?;
            }
            log::info!("ASR live preview audio stream sent");
            Ok(())
        });
        tokio::pin!(send_task);

        let mut send_done = false;
        loop {
            tokio::select! {
                result = &mut send_task, if !send_done => {
                    send_done = true;
                    result.context("ASR live preview send task join failed")??;
                }
                message = timeout(self.config.response_timeout, stream.next()) => {
                    let message = match message {
                        Ok(Some(Ok(message))) => message,
                        Ok(Some(Err(error))) => return Err(anyhow!("ASR live preview websocket receive failed: {error}")),
                        Ok(None) => return Ok(()),
                        Err(_) => return Err(anyhow!("ASR live preview websocket response timed out")),
                    };

                    if self.handle_message_with_mode(message, EmitMode::LivePreview)? {
                        if !send_done {
                            send_task.abort();
                        }
                        return Ok(());
                    }
                }
            }
        }
    }

    fn connect_request(&self) -> Result<tokio_tungstenite::tungstenite::http::Request<()>> {
        let mut request = self
            .config
            .endpoint
            .as_str()
            .into_client_request()
            .context("failed to create Doubao ASR websocket request")?;
        let request_id = request_id();
        match &self.config.credentials {
            Credentials::ApiKey {
                api_key,
                resource_id,
            } => {
                request.headers_mut().insert(
                    "X-Api-Key",
                    HeaderValue::from_str(api_key)
                        .context("failed to build Doubao ASR API key header")?,
                );
                request.headers_mut().insert(
                    "X-Api-Resource-Id",
                    HeaderValue::from_str(resource_id)
                        .context("failed to build Doubao ASR resource id header")?,
                );
            }
            Credentials::AppAccess {
                app_key,
                access_key,
                resource_id,
            } => {
                request.headers_mut().insert(
                    "X-Api-App-Key",
                    HeaderValue::from_str(app_key)
                        .context("failed to build Doubao ASR app key header")?,
                );
                request.headers_mut().insert(
                    "X-Api-Access-Key",
                    HeaderValue::from_str(access_key)
                        .context("failed to build Doubao ASR access key header")?,
                );
                request.headers_mut().insert(
                    "X-Api-Resource-Id",
                    HeaderValue::from_str(resource_id)
                        .context("failed to build Doubao ASR resource id header")?,
                );
            }
        }
        request.headers_mut().insert(
            "X-Api-Connect-Id",
            HeaderValue::from_str(&request_id)
                .context("failed to build Doubao ASR connect id header")?,
        );
        request.headers_mut().insert(
            "X-Api-Request-Id",
            HeaderValue::from_str(&request_id)
                .context("failed to build Doubao ASR request id header")?,
        );
        request
            .headers_mut()
            .insert("X-Api-Sequence", HeaderValue::from_static("-1"));
        request
            .headers_mut()
            .insert("Content-Type", HeaderValue::from_static("application/json"));
        Ok(request)
    }

    async fn opening_handshake(&self) -> serde_json::Value {
        let hotwords = injected_hotwords(self.hotwords.lock().await.clone());
        log::info!("ASR injecting {} hotword(s)", hotwords.len());
        let context = match serde_json::to_string(&json!({ "hotwords": hotwords })) {
            Ok(context) => context,
            Err(_) => "{\"hotwords\":[]}".to_string(),
        };
        json!({
            "user": {
                "uid": self.config.uid,
            },
            "audio": {
                "format": "pcm",
                "codec": "raw",
                "rate": self.config.sample_rate,
                "bits": self.config.bits,
                "channel": self.config.channel,
                "language": self.config.language,
            },
            "request": {
                "model_name": self.config.model_name,
                "enable_nonstream": true,
                "enable_ddc": true,
                "enable_itn": true,
                "end_window_size": 200,
                "vad_segment_duration": 3000,
                "first_package": false,
                "corpus": {
                    "context": context,
                },
            },
        })
    }

    fn handle_message(&self, message: Message) -> Result<bool> {
        self.handle_message_with_mode(message, EmitMode::Final)
    }

    fn handle_message_with_mode(&self, message: Message, mode: EmitMode) -> Result<bool> {
        match message {
            Message::Text(text) => self.handle_text(&text, false, mode),
            Message::Binary(bytes) => self.handle_binary(&bytes, mode),
            Message::Close(_) => Err(anyhow!("ASR websocket closed by remote")),
            _ => Ok(false),
        }
    }

    fn handle_binary(&self, bytes: &[u8], mode: EmitMode) -> Result<bool> {
        let frame = parse_server_frame(bytes)?;
        match frame.message_type {
            MESSAGE_TYPE_FULL_SERVER_RESPONSE => {
                let text = if frame.compression == COMPRESSION_GZIP {
                    gzip_decompress(&frame.payload)?
                } else {
                    String::from_utf8(frame.payload).context("ASR response is not UTF-8")?
                };
                self.handle_text(&text, frame.flags == FLAG_SEQUENCE_NEGATIVE, mode)
            }
            MESSAGE_TYPE_ERROR => Err(anyhow!(
                "Doubao ASR server error: {}",
                frame.error_message()
            )),
            other => {
                log::debug!("ASR ignored server frame type {other}");
                Ok(false)
            }
        }
    }

    fn handle_text(&self, text: &str, is_last_frame: bool, mode: EmitMode) -> Result<bool> {
        let response = match serde_json::from_str::<AsrResponse>(text) {
            Ok(response) => response,
            Err(error) => {
                log::debug!("ASR ignored non-result response: {error}; payload={text}");
                return Ok(false);
            }
        };

        if let Some(result) = response.result {
            let result_text = result
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if result_text.is_empty() {
                return Ok(false);
            }

            let is_definite = result_is_definite(&result);
            if matches!(mode, EmitMode::LivePreview) {
                self.app.emit(
                    "asr://live-preview",
                    LivePreviewPayload {
                        text: result_text,
                        pass: if is_definite { "second" } else { "first" },
                        is_final: is_definite,
                    },
                )?;
            } else if is_definite {
                log::info!("ASR second-pass final received");
                self.app.emit(
                    "asr://final",
                    FinalPayload {
                        text: result_text,
                        pass: "second",
                        cer_estimate: CER_ESTIMATE,
                        confidence: None,
                    },
                )?;
            } else {
                log::debug!("ASR first-pass partial received");
                self.app.emit(
                    "asr://partial",
                    PartialPayload {
                        text: result_text,
                        pass: "first",
                    },
                )?;
            }
        }

        if response.is_final.unwrap_or(false) || is_last_frame {
            if matches!(mode, EmitMode::LivePreview) {
                log::info!("ASR live preview complete received");
                return Ok(true);
            }
            log::info!("ASR complete received");
            self.app
                .emit("asr://complete", CompletePayload { is_final: true })?;
            return Ok(true);
        }

        Ok(false)
    }
}

fn injected_hotwords(mut hotwords: Vec<HotwordEntry>) -> Vec<String> {
    hotwords.sort_by(|left, right| right.weight.cmp(&left.weight));
    hotwords
        .into_iter()
        .take(MAX_INJECTED_HOTWORDS)
        .map(|entry| entry.word)
        .collect()
}

fn auth_error_message(
    response: &tokio_tungstenite::tungstenite::http::Response<Option<Vec<u8>>>,
) -> String {
    let mut message = format!(
        "豆包 ASR 认证失败：HTTP {}。请检查 ASR Key、Resource ID 和服务权限。",
        response.status()
    );

    for header in ["X-Api-Message", "X-Tt-Logid", "X-Api-Status-Code"] {
        if let Some(value) = response
            .headers()
            .get(header)
            .and_then(|value| value.to_str().ok())
        {
            message.push_str(&format!(" {header}: {value}."));
        }
    }

    message
}

struct ServerFrame {
    message_type: u8,
    flags: u8,
    compression: u8,
    payload: Vec<u8>,
}

impl ServerFrame {
    fn error_message(&self) -> String {
        String::from_utf8_lossy(&self.payload).to_string()
    }
}

fn full_client_request_frame(payload: &Value) -> Result<Vec<u8>> {
    let payload = gzip_compress(payload.to_string().as_bytes())?;
    Ok(frame(
        MESSAGE_TYPE_FULL_CLIENT_REQUEST,
        FLAG_NONE,
        SERIALIZATION_JSON,
        COMPRESSION_GZIP,
        &payload,
    ))
}

fn audio_request_frame(payload: &[u8], is_last: bool) -> Result<Vec<u8>> {
    let payload = gzip_compress(payload)?;
    Ok(frame(
        MESSAGE_TYPE_AUDIO_ONLY_REQUEST,
        if is_last {
            FLAG_LAST_PACKAGE
        } else {
            FLAG_NONE
        },
        SERIALIZATION_NONE,
        COMPRESSION_GZIP,
        &payload,
    ))
}

fn frame(
    message_type: u8,
    flags: u8,
    serialization: u8,
    compression: u8,
    payload: &[u8],
) -> Vec<u8> {
    let mut output = Vec::with_capacity(8 + payload.len());
    output.push((PROTOCOL_VERSION << 4) | HEADER_SIZE);
    output.push((message_type << 4) | flags);
    output.push((serialization << 4) | compression);
    output.push(0);
    output.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    output.extend_from_slice(payload);
    output
}

fn parse_server_frame(bytes: &[u8]) -> Result<ServerFrame> {
    if bytes.len() < 8 {
        return Err(anyhow!("ASR server frame too short"));
    }

    let header_size = ((bytes[0] & 0x0f) as usize) * 4;
    if header_size < 4 || bytes.len() < header_size + 4 {
        return Err(anyhow!("ASR server frame has invalid header size"));
    }

    let message_type = bytes[1] >> 4;
    let flags = bytes[1] & 0x0f;
    let compression = bytes[2] & 0x0f;
    let mut offset = header_size;

    match message_type {
        MESSAGE_TYPE_FULL_SERVER_RESPONSE => {
            if flags == FLAG_SEQUENCE_POSITIVE || flags == FLAG_SEQUENCE_NEGATIVE {
                if bytes.len() < offset + 4 {
                    return Err(anyhow!("ASR server response missing sequence"));
                }
                offset += 4;
            }

            let payload = read_payload(bytes, offset)?;
            Ok(ServerFrame {
                message_type,
                flags,
                compression,
                payload,
            })
        }
        MESSAGE_TYPE_ERROR => {
            if bytes.len() < offset + 8 {
                return Err(anyhow!("ASR server error frame too short"));
            }
            let code = u32::from_be_bytes(bytes[offset..offset + 4].try_into()?);
            let size_offset = offset + 4;
            let size = u32::from_be_bytes(bytes[size_offset..size_offset + 4].try_into()?) as usize;
            let payload_offset = size_offset + 4;
            if bytes.len() < payload_offset + size {
                return Err(anyhow!("ASR server error payload is truncated"));
            }
            let mut payload = format!("code={code}; ").into_bytes();
            payload.extend_from_slice(&bytes[payload_offset..payload_offset + size]);
            Ok(ServerFrame {
                message_type,
                flags,
                compression,
                payload,
            })
        }
        other => Err(anyhow!(
            "ASR server returned unsupported frame type {other}"
        )),
    }
}

fn read_payload(bytes: &[u8], offset: usize) -> Result<Vec<u8>> {
    if bytes.len() < offset + 4 {
        return Err(anyhow!("ASR server response missing payload size"));
    }
    let size = u32::from_be_bytes(bytes[offset..offset + 4].try_into()?) as usize;
    let payload_offset = offset + 4;
    if bytes.len() < payload_offset + size {
        return Err(anyhow!("ASR server response payload is truncated"));
    }
    Ok(bytes[payload_offset..payload_offset + size].to_vec())
}

fn gzip_compress(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(bytes)
        .context("failed to gzip-compress ASR payload")?;
    encoder
        .finish()
        .context("failed to finish ASR gzip payload")
}

fn gzip_decompress(bytes: &[u8]) -> Result<String> {
    let mut decoder = GzDecoder::new(bytes);
    let mut output = String::new();
    decoder
        .read_to_string(&mut output)
        .context("failed to gzip-decompress ASR response")?;
    Ok(output)
}

fn result_is_definite(result: &Value) -> bool {
    if result
        .get("definite")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return true;
    }

    result
        .get("utterances")
        .and_then(Value::as_array)
        .map(|utterances| {
            utterances.iter().any(|utterance| {
                utterance
                    .get("definite")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
}
