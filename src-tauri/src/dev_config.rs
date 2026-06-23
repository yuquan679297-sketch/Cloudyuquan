// Development-only local config loader. Never commit .voicehub.dev.json.

use crate::{asr::RuntimeAsrConfig, refine::RuntimeLlmConfig};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{env, fs, path::PathBuf};

const DEV_CONFIG_FILE: &str = ".voicehub.dev.json";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevConfig {
    pub asr: Option<RuntimeAsrConfig>,
    pub llm: Option<RuntimeLlmConfig>,
}

#[tauri::command]
pub fn get_dev_config() -> Result<Option<DevConfig>, String> {
    read_dev_config().map_err(|error| error.to_string())
}

fn read_dev_config() -> Result<Option<DevConfig>> {
    let Some(path) = find_dev_config()? else {
        return Ok(None);
    };

    let text =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    let config = serde_json::from_str::<DevConfig>(&text)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    log::info!("loaded development config from {}", path.display());

    Ok(Some(config))
}

fn find_dev_config() -> Result<Option<PathBuf>> {
    let current_dir = env::current_dir().context("failed to read current directory")?;
    let candidates = [
        current_dir.join(DEV_CONFIG_FILE),
        current_dir.join("..").join(DEV_CONFIG_FILE),
    ];

    Ok(candidates.into_iter().find(|path| path.is_file()))
}
