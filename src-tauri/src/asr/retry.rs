// Retry helpers — exponential backoff for 语枢 (VoiceHub) ASR reconnects.

use anyhow::{anyhow, Result};
use rand::Rng;
use std::{future::Future, time::Duration};
use tokio::time::sleep;

#[derive(Clone, Copy)]
pub struct RetryConfig {
    pub max_attempts: u32,
    pub base_delay_ms: u64,
    pub max_delay_ms: u64,
    pub jitter_ms: u64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 10,
            base_delay_ms: 1000,
            max_delay_ms: 30000,
            jitter_ms: 1000,
        }
    }
}

pub async fn run<F, Fut>(config: RetryConfig, mut operation: F) -> Result<()>
where
    F: FnMut(u32) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    for attempt in 1..=config.max_attempts {
        match operation(attempt).await {
            Ok(()) => return Ok(()),
            Err(error) if is_non_retriable(&error) => {
                log::error!("ASR non-retriable error on attempt {attempt}: {error:#}");
                return Err(error);
            }
            Err(error) if attempt == config.max_attempts => {
                log::error!("ASR attempt {attempt} failed: {error:#}");
                return Err(anyhow!(
                    "Connection failed after {} attempts",
                    config.max_attempts
                ));
            }
            Err(error) => {
                let delay = delay_for_attempt(config, attempt);
                log::info!(
                    "ASR attempt {attempt} failed: {error:#}; retrying in {}ms",
                    delay.as_millis()
                );
                sleep(delay).await;
            }
        }
    }

    Err(anyhow!(
        "Connection failed after {} attempts",
        config.max_attempts
    ))
}

fn is_non_retriable(error: &anyhow::Error) -> bool {
    let message = error.to_string();
    message.contains("豆包 ASR 认证失败")
        || message.contains("DOUBAO_ASR_KEY")
        || message.contains("ASR Key")
}

fn delay_for_attempt(config: RetryConfig, attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(30);
    let multiplier = 2_u64.saturating_pow(exponent);
    let backoff = config
        .base_delay_ms
        .saturating_mul(multiplier)
        .min(config.max_delay_ms);
    let jitter = rand::thread_rng().gen_range(0..=config.jitter_ms);
    Duration::from_millis(backoff.saturating_add(jitter))
}
