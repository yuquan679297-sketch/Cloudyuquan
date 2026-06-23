// Refine module — turns ASR transcripts into structured Codex instructions.

mod fast_path;
mod precise_path;
mod prompt;
mod templates;

use anyhow::{Context, Result};
use fast_path::FastPathCleaner;
use precise_path::PrecisePath;
pub use precise_path::RuntimeLlmConfig;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

static LLM_CONFIG: OnceLock<Arc<Mutex<Option<RuntimeLlmConfig>>>> = OnceLock::new();

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum IntentType {
    Create,
    Modify,
    Delete,
    Query,
    Debug,
    Refactor,
    Test,
    Document,
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RefinedInstruction {
    pub goal: String,
    pub context: String,
    pub constraints: String,
    pub done_when: String,
    pub intent: IntentType,
    pub confidence: f32,
    pub raw_input: String,
    pub cleaned_input: String,
    pub processing_ms: u64,
}

pub async fn run_pipeline(
    raw_transcript: &str,
    app_handle: &AppHandle,
) -> Result<RefinedInstruction> {
    let fast_result = FastPathCleaner::new().clean(raw_transcript);
    app_handle
        .emit("refine://fast-done", &fast_result.cleaned)
        .context("failed to emit fast refine result")?;

    let runtime_config = llm_config().lock().await.clone();
    let precise = PrecisePath::new_from_config_or_env(runtime_config)?;
    let refined = precise
        .refine(
            raw_transcript,
            &fast_result.cleaned,
            fast_result.processing_ms,
        )
        .await?;

    app_handle
        .emit("refine://precise-done", &refined)
        .context("failed to emit precise refine result")?;

    Ok(refined)
}

pub fn warm_up() {
    fast_path::warm_up_regexes();
}

#[tauri::command]
pub async fn init_refine() -> Result<String, String> {
    warm_up();
    Ok("refine module ready".to_string())
}

#[tauri::command]
pub async fn refine_transcript(
    raw_text: String,
    app_handle: AppHandle,
) -> Result<RefinedInstruction, String> {
    run_pipeline(&raw_text, &app_handle)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_codex_prompt(instruction: RefinedInstruction) -> Result<String, String> {
    Ok(templates::render_codex_prompt(&instruction))
}

#[tauri::command]
pub async fn set_llm_config(config: RuntimeLlmConfig) -> Result<(), String> {
    let config_store = llm_config();
    let mut runtime_config = config_store.lock().await;
    *runtime_config = Some(config);
    log::info!("LLM runtime config updated from UI");
    Ok(())
}

fn llm_config() -> Arc<Mutex<Option<RuntimeLlmConfig>>> {
    LLM_CONFIG
        .get_or_init(|| Arc::new(Mutex::new(None)))
        .clone()
}
