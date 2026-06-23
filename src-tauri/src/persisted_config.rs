// Runtime config persistence. Secrets live in macOS Keychain; non-secrets live
// in the app config directory.

use crate::{asr::RuntimeAsrConfig, refine::RuntimeLlmConfig};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const CONFIG_FILE: &str = "runtime-config.json";
const KEYCHAIN_SERVICE: &str = "VoiceHub";
const ASR_API_KEY_ACCOUNT: &str = "doubao-asr-api-key";
const ASR_APP_KEY_ACCOUNT: &str = "doubao-asr-app-key";
const ASR_ACCESS_KEY_ACCOUNT: &str = "doubao-asr-access-key";
const LLM_API_KEY_ACCOUNT: &str = "llm-api-key";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedRuntimeConfig {
    pub asr: Option<RuntimeAsrConfig>,
    pub llm: Option<RuntimeLlmConfig>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRuntimeConfig {
    asr: Option<StoredAsrConfig>,
    llm: Option<StoredLlmConfig>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAsrConfig {
    resource_id: Option<String>,
    endpoint: Option<String>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLlmConfig {
    api_base: Option<String>,
    model: Option<String>,
    protocol: Option<String>,
    provider: Option<String>,
}

#[tauri::command]
pub fn get_persisted_runtime_config(app: AppHandle) -> Result<PersistedRuntimeConfig, String> {
    read_persisted_runtime_config(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_persisted_asr_config(app: AppHandle, config: RuntimeAsrConfig) -> Result<(), String> {
    save_asr_config(&app, config).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_persisted_llm_config(app: AppHandle, config: RuntimeLlmConfig) -> Result<(), String> {
    save_llm_config(&app, config).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_persisted_asr_config(app: AppHandle) -> Result<(), String> {
    clear_asr_config(&app).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_persisted_llm_config(app: AppHandle) -> Result<(), String> {
    clear_llm_config(&app).map_err(|error| error.to_string())
}

fn read_persisted_runtime_config(app: &AppHandle) -> Result<PersistedRuntimeConfig> {
    let stored = read_stored_config(app)?;
    let asr = match stored.asr {
        Some(config) => Some(RuntimeAsrConfig {
            api_key: read_secret(ASR_API_KEY_ACCOUNT)?,
            app_key: read_secret(ASR_APP_KEY_ACCOUNT)?,
            access_key: read_secret(ASR_ACCESS_KEY_ACCOUNT)?,
            resource_id: config.resource_id,
            endpoint: config.endpoint,
        }),
        None => None,
    };
    let llm = match stored.llm {
        Some(config) => Some(RuntimeLlmConfig {
            api_key: read_secret(LLM_API_KEY_ACCOUNT)?,
            api_base: config.api_base,
            model: config.model,
            protocol: config.protocol,
            provider: config.provider,
        }),
        None => None,
    };

    Ok(PersistedRuntimeConfig { asr, llm })
}

fn save_asr_config(app: &AppHandle, config: RuntimeAsrConfig) -> Result<()> {
    write_secret(ASR_API_KEY_ACCOUNT, config.api_key.as_deref())?;
    write_secret(ASR_APP_KEY_ACCOUNT, config.app_key.as_deref())?;
    write_secret(ASR_ACCESS_KEY_ACCOUNT, config.access_key.as_deref())?;

    let mut stored = read_stored_config(app)?;
    stored.asr = Some(StoredAsrConfig {
        resource_id: clean(config.resource_id),
        endpoint: clean(config.endpoint),
    });
    write_stored_config(app, &stored)?;

    Ok(())
}

fn save_llm_config(app: &AppHandle, config: RuntimeLlmConfig) -> Result<()> {
    write_secret(LLM_API_KEY_ACCOUNT, config.api_key.as_deref())?;

    let mut stored = read_stored_config(app)?;
    stored.llm = Some(StoredLlmConfig {
        api_base: clean(config.api_base),
        model: clean(config.model),
        protocol: clean(config.protocol),
        provider: clean(config.provider),
    });
    write_stored_config(app, &stored)?;

    Ok(())
}

fn clear_asr_config(app: &AppHandle) -> Result<()> {
    write_secret(ASR_API_KEY_ACCOUNT, None)?;
    write_secret(ASR_APP_KEY_ACCOUNT, None)?;
    write_secret(ASR_ACCESS_KEY_ACCOUNT, None)?;

    let mut stored = read_stored_config(app)?;
    stored.asr = None;
    write_stored_config(app, &stored)?;

    Ok(())
}

fn clear_llm_config(app: &AppHandle) -> Result<()> {
    write_secret(LLM_API_KEY_ACCOUNT, None)?;

    let mut stored = read_stored_config(app)?;
    stored.llm = None;
    write_stored_config(app, &stored)?;

    Ok(())
}

fn read_stored_config(app: &AppHandle) -> Result<StoredRuntimeConfig> {
    let path = config_path(app)?;
    if !path.is_file() {
        return Ok(StoredRuntimeConfig::default());
    }

    let text =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str::<StoredRuntimeConfig>(&text)
        .with_context(|| format!("failed to parse {}", path.display()))
}

fn write_stored_config(app: &AppHandle, config: &StoredRuntimeConfig) -> Result<()> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let text = serde_json::to_string_pretty(config).context("failed to serialize config")?;
    fs::write(&path, text).with_context(|| format!("failed to write {}", path.display()))
}

fn config_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_config_dir()
        .context("failed to resolve app config directory")?
        .join(CONFIG_FILE))
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[cfg(target_os = "macos")]
fn read_secret(account: &str) -> Result<Option<String>> {
    use security_framework::passwords::get_generic_password;

    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    match get_generic_password(KEYCHAIN_SERVICE, account) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .with_context(|| format!("keychain entry {account} is not valid UTF-8")),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(error) => {
            Err(error).with_context(|| format!("failed to read keychain entry {account}"))
        }
    }
}

#[cfg(target_os = "macos")]
fn write_secret(account: &str, value: Option<&str>) -> Result<()> {
    use security_framework::passwords::{delete_generic_password, set_generic_password};

    const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

    let value = value.map(str::trim).filter(|value| !value.is_empty());
    match value {
        Some(value) => set_generic_password(KEYCHAIN_SERVICE, account, value.as_bytes())
            .with_context(|| format!("failed to write keychain entry {account}")),
        None => match delete_generic_password(KEYCHAIN_SERVICE, account) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
            Err(error) => {
                Err(error).with_context(|| format!("failed to delete keychain entry {account}"))
            }
        },
    }
}

#[cfg(not(target_os = "macos"))]
fn read_secret(_account: &str) -> Result<Option<String>> {
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
fn write_secret(_account: &str, value: Option<&str>) -> Result<()> {
    if value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        anyhow::bail!("Keychain persistence is only supported on macOS");
    }

    Ok(())
}
