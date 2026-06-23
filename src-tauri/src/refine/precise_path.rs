// Precise path refinement — calls an OpenAI-compatible chat completions API.

use super::{prompt, IntentType, RefinedInstruction};
use anyhow::{anyhow, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::{env, time::Duration};
use tokio::time::{timeout, Instant};

const DEFAULT_API_BASE: &str = "https://api.openai.com/v1";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const DEFAULT_DEEPSEEK_API_BASE: &str = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-v4-flash";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

pub struct PrecisePath {
    api_key: String,
    api_base: String,
    model: String,
    protocol: String,
    http_client: Client,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLlmConfig {
    pub api_key: Option<String>,
    pub api_base: Option<String>,
    pub model: Option<String>,
    pub protocol: Option<String>,
    pub provider: Option<String>,
}

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    max_tokens: u16,
    temperature: f32,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    content: Option<String>,
}

#[derive(Serialize)]
struct OpenAiResponsesRequest {
    model: String,
    instructions: String,
    input: String,
    max_output_tokens: u16,
}

#[derive(Deserialize)]
struct OpenAiResponsesResponse {
    output_text: Option<String>,
    output: Option<Vec<OpenAiResponseOutput>>,
}

#[derive(Deserialize)]
struct OpenAiResponseOutput {
    content: Option<Vec<OpenAiResponseContent>>,
}

#[derive(Deserialize)]
struct OpenAiResponseContent {
    text: Option<String>,
}

#[derive(Serialize)]
struct AnthropicRequest {
    model: String,
    system: String,
    messages: Vec<AnthropicMessage>,
    max_tokens: u16,
    temperature: f32,
}

#[derive(Serialize)]
struct AnthropicMessage {
    role: &'static str,
    content: String,
}

#[derive(Deserialize)]
struct AnthropicResponse {
    content: Vec<AnthropicResponseContent>,
}

#[derive(Deserialize)]
struct AnthropicResponseContent {
    text: Option<String>,
}

#[derive(Deserialize)]
struct LlmInstruction {
    goal: String,
    context: String,
    constraints: String,
    done_when: String,
    intent: IntentType,
    confidence: f32,
}

impl PrecisePath {
    pub fn new_from_config_or_env(runtime_config: Option<RuntimeLlmConfig>) -> Result<Self> {
        let runtime_config = runtime_config.unwrap_or_default();
        if let Some(api_key) = clean(runtime_config.api_key) {
            let api_base = clean(runtime_config.api_base)
                .or_else(|| clean_env("DEEPSEEK_API_BASE"))
                .unwrap_or_else(|| DEFAULT_DEEPSEEK_API_BASE.to_string());
            let model = clean(runtime_config.model)
                .or_else(|| clean_env("DEEPSEEK_MODEL"))
                .unwrap_or_else(|| DEFAULT_DEEPSEEK_MODEL.to_string());
            let protocol =
                clean(runtime_config.protocol).unwrap_or_else(|| "openaiChat".to_string());
            return Self::new(api_key, api_base, model, protocol);
        }

        let (api_key, api_base, default_model) = match clean_env("OPENAI_API_KEY") {
            Some(api_key) => (
                api_key,
                clean_env("OPENAI_API_BASE").unwrap_or_else(|| DEFAULT_API_BASE.to_string()),
                DEFAULT_MODEL,
            ),
            None => match clean_env("DEEPSEEK_API_KEY") {
                Some(api_key) => (
                    api_key,
                    clean_env("DEEPSEEK_API_BASE")
                        .unwrap_or_else(|| DEFAULT_DEEPSEEK_API_BASE.to_string()),
                    DEFAULT_DEEPSEEK_MODEL,
                ),
                None => {
                    return Err(anyhow!(
                        "请先在界面填写 LLM API Key，或设置 OPENAI_API_KEY / DEEPSEEK_API_KEY"
                    ));
                }
            },
        };
        let model = clean_env("OPENAI_MODEL")
            .or_else(|| clean_env("DEEPSEEK_MODEL"))
            .unwrap_or_else(|| default_model.to_string());
        Self::new(api_key, api_base, model, "openaiChat".to_string())
    }

    fn new(api_key: String, api_base: String, model: String, protocol: String) -> Result<Self> {
        let http_client = Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .context("failed to build LLM HTTP client")?;

        Ok(Self {
            api_key,
            api_base,
            model,
            protocol,
            http_client,
        })
    }

    pub async fn refine(
        &self,
        raw_input: &str,
        cleaned_input: &str,
        fast_processing_ms: u64,
    ) -> Result<RefinedInstruction> {
        let started_at = Instant::now();
        let instruction = timeout(REQUEST_TIMEOUT, self.refine_with_retry(cleaned_input))
            .await
            .map_err(|_| anyhow!("LLM refinement timed out after 8 seconds"))??;

        Ok(with_transcript_metadata(
            apply_local_intent_corrections(instruction, cleaned_input),
            raw_input,
            cleaned_input,
            fast_processing_ms + started_at.elapsed().as_millis() as u64,
        ))
    }

    async fn refine_with_retry(&self, cleaned_input: &str) -> Result<LlmInstruction> {
        let mut last_parse_error = None;

        for attempt in 0..2 {
            let content = self.request_refinement(cleaned_input).await?;
            match serde_json::from_str::<LlmInstruction>(content.trim()) {
                Ok(instruction) => {
                    return Ok(instruction);
                }
                Err(error) => {
                    last_parse_error = Some(error);
                    if attempt == 1 {
                        break;
                    }
                }
            }
        }

        if let Some(error) = last_parse_error {
            log::warn!("LLM returned non-JSON refinement response twice: {error}");
        }

        Ok(unknown_llm_instruction(cleaned_input))
    }

    async fn request_refinement(&self, cleaned_input: &str) -> Result<String> {
        match self.protocol.as_str() {
            "openaiResponses" => {
                self.request_openai_responses_refinement(cleaned_input)
                    .await
            }
            "anthropicMessages" => self.request_anthropic_refinement(cleaned_input).await,
            _ => self.request_chat_refinement(cleaned_input).await,
        }
    }

    async fn request_chat_refinement(&self, cleaned_input: &str) -> Result<String> {
        let url = format!("{}/chat/completions", self.api_base.trim_end_matches('/'));
        let request = ChatRequest {
            model: self.model.clone(),
            messages: vec![
                ChatMessage {
                    role: "system",
                    content: prompt::build_system_prompt().to_string(),
                },
                ChatMessage {
                    role: "user",
                    content: prompt::build_user_message(cleaned_input),
                },
            ],
            max_tokens: 800,
            temperature: 0.1,
            stream: false,
        };

        let response = timeout(
            REQUEST_TIMEOUT,
            self.http_client
                .post(url)
                .bearer_auth(&self.api_key)
                .json(&request)
                .send(),
        )
        .await
        .map_err(|_| anyhow!("LLM refinement timed out after 8 seconds"))?
        .context("failed to call LLM refinement endpoint")?;

        let status = response.status();
        if !status.is_success() {
            let body = timeout(REQUEST_TIMEOUT, response.text())
                .await
                .map_err(|_| anyhow!("LLM refinement error response timed out after 8 seconds"))?
                .unwrap_or_else(|error| format!("failed to read error body: {error}"));
            return Err(anyhow!(
                "LLM refinement endpoint returned HTTP {status}: {body}"
            ));
        }

        let response_text = timeout(REQUEST_TIMEOUT, response.text())
            .await
            .map_err(|_| anyhow!("LLM refinement response timed out after 8 seconds"))?
            .context("failed to read LLM chat response")?;

        let body = serde_json::from_str::<ChatResponse>(&response_text)
            .context("failed to parse LLM chat response")?;

        body.choices
            .iter()
            .find_map(|choice| choice.message.content.clone())
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| anyhow!("{}", empty_content_message(&body, &response_text)))
    }

    async fn request_openai_responses_refinement(&self, cleaned_input: &str) -> Result<String> {
        let url = format!("{}/responses", self.api_base.trim_end_matches('/'));
        let request = OpenAiResponsesRequest {
            model: self.model.clone(),
            instructions: prompt::build_system_prompt().to_string(),
            input: prompt::build_user_message(cleaned_input),
            max_output_tokens: 800,
        };

        let response = timeout(
            REQUEST_TIMEOUT,
            self.http_client
                .post(url)
                .bearer_auth(&self.api_key)
                .json(&request)
                .send(),
        )
        .await
        .map_err(|_| anyhow!("LLM refinement timed out after 8 seconds"))?
        .context("failed to call LLM refinement endpoint")?;

        let response_text = read_successful_response_text(response).await?;
        let body = serde_json::from_str::<OpenAiResponsesResponse>(&response_text)
            .context("failed to parse LLM responses response")?;

        body.output_text
            .or_else(|| {
                body.output.and_then(|output| {
                    output
                        .into_iter()
                        .filter_map(|item| item.content)
                        .flatten()
                        .filter_map(|content| content.text)
                        .find(|text| !text.trim().is_empty())
                })
            })
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| anyhow!("LLM refinement response did not include output text"))
    }

    async fn request_anthropic_refinement(&self, cleaned_input: &str) -> Result<String> {
        let url = format!("{}/v1/messages", self.api_base.trim_end_matches('/'));
        let request = AnthropicRequest {
            model: self.model.clone(),
            system: prompt::build_system_prompt().to_string(),
            messages: vec![AnthropicMessage {
                role: "user",
                content: prompt::build_user_message(cleaned_input),
            }],
            max_tokens: 800,
            temperature: 0.1,
        };

        let response = timeout(
            REQUEST_TIMEOUT,
            self.http_client
                .post(url)
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&request)
                .send(),
        )
        .await
        .map_err(|_| anyhow!("LLM refinement timed out after 8 seconds"))?
        .context("failed to call LLM refinement endpoint")?;

        let response_text = read_successful_response_text(response).await?;
        let body = serde_json::from_str::<AnthropicResponse>(&response_text)
            .context("failed to parse LLM anthropic response")?;

        body.content
            .into_iter()
            .filter_map(|content| content.text)
            .find(|text| !text.trim().is_empty())
            .ok_or_else(|| anyhow!("LLM refinement response did not include content"))
    }
}

async fn read_successful_response_text(response: reqwest::Response) -> Result<String> {
    let status = response.status();
    if !status.is_success() {
        let body = timeout(REQUEST_TIMEOUT, response.text())
            .await
            .map_err(|_| anyhow!("LLM refinement error response timed out after 8 seconds"))?
            .unwrap_or_else(|error| format!("failed to read error body: {error}"));
        return Err(anyhow!(
            "LLM refinement endpoint returned HTTP {status}: {body}"
        ));
    }

    timeout(REQUEST_TIMEOUT, response.text())
        .await
        .map_err(|_| anyhow!("LLM refinement response timed out after 8 seconds"))?
        .context("failed to read LLM response")
}

fn empty_content_message(response: &ChatResponse, raw_body: &str) -> String {
    let reasons = response
        .choices
        .iter()
        .filter_map(|choice| choice.finish_reason.as_deref())
        .collect::<Vec<_>>()
        .join(", ");
    let preview = raw_body.chars().take(500).collect::<String>();

    if reasons.is_empty() {
        format!(
            "LLM refinement response did not include content; choices={}; body={preview}",
            response.choices.len()
        )
    } else {
        format!(
            "LLM refinement response did not include content; choices={}; finish_reason={reasons}; body={preview}",
            response.choices.len()
        )
    }
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn clean_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn unknown_llm_instruction(cleaned_input: &str) -> LlmInstruction {
    LlmInstruction {
        goal: cleaned_input.to_string(),
        context: String::new(),
        constraints: String::new(),
        done_when: String::new(),
        intent: IntentType::Unknown,
        confidence: 0.0,
    }
}

fn apply_local_intent_corrections(
    mut instruction: LlmInstruction,
    cleaned_input: &str,
) -> LlmInstruction {
    normalize_copy_link_mishearing(&mut instruction.goal);
    normalize_copy_link_mishearing(&mut instruction.context);
    normalize_copy_link_mishearing(&mut instruction.constraints);
    normalize_copy_link_mishearing(&mut instruction.done_when);

    if matches!(instruction.intent, IntentType::Modify | IntentType::Unknown)
        && looks_like_document_request(cleaned_input)
    {
        instruction.intent = IntentType::Document;
        instruction.confidence = instruction.confidence.max(0.75);
    }

    if matches!(instruction.intent, IntentType::Document)
        && looks_like_ui_text_modify_request(cleaned_input)
    {
        instruction.intent = IntentType::Modify;
        instruction.confidence = instruction.confidence.max(0.75);
    }

    instruction
}

fn normalize_copy_link_mishearing(text: &mut String) {
    if text.contains("复制亮度") {
        *text = text.replace("复制亮度", "复制链路");
    }

    if text.contains("复制功能")
        && text.contains("亮度功能")
        && !looks_like_real_brightness_context(text)
    {
        *text = text.replace("亮度功能", "链路功能");
    }
}

fn looks_like_real_brightness_context(text: &str) -> bool {
    [
        "屏幕亮度",
        "系统亮度",
        "亮度调节",
        "调节亮度",
        "亮度滑块",
        "brightness",
    ]
    .iter()
    .any(|keyword| text.contains(keyword))
}

fn looks_like_document_request(text: &str) -> bool {
    let text = text.trim();
    ["注释", "文档", "README", "readme", "说明", "JSDoc", "jsdoc"]
        .iter()
        .any(|keyword| text.contains(keyword))
}

fn looks_like_ui_text_modify_request(text: &str) -> bool {
    let text = text.trim();
    let has_ui_target = [
        "按钮",
        "button",
        "标签",
        "label",
        "标题",
        "placeholder",
        "占位符",
        "toast",
        "提示",
        "菜单",
        "tab",
    ]
    .iter()
    .any(|keyword| text.contains(keyword));
    let has_text_change = ["文案", "文字", "文本", "改成", "修改", "更清楚"]
        .iter()
        .any(|keyword| text.contains(keyword));

    has_ui_target && has_text_change
}

fn with_transcript_metadata(
    instruction: LlmInstruction,
    raw_input: &str,
    cleaned_input: &str,
    processing_ms: u64,
) -> RefinedInstruction {
    RefinedInstruction {
        goal: instruction.goal,
        context: instruction.context,
        constraints: instruction.constraints,
        done_when: instruction.done_when,
        intent: instruction.intent,
        confidence: instruction.confidence,
        raw_input: raw_input.to_string(),
        cleaned_input: cleaned_input.to_string(),
        processing_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn llm_instruction(intent: IntentType) -> LlmInstruction {
        LlmInstruction {
            goal: "为接口补充注释".to_string(),
            context: "存在接口定义".to_string(),
            constraints: String::new(),
            done_when: "接口注释补充完成".to_string(),
            intent,
            confidence: 0.6,
        }
    }

    #[test]
    fn corrects_modify_comment_request_to_document() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Modify),
            "帮我给这个接口补一下注释",
        );

        assert!(matches!(corrected.intent, IntentType::Document));
        assert!(corrected.confidence >= 0.75);
    }

    #[test]
    fn keeps_regular_modify_request_as_modify() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Modify),
            "帮我把这个按钮改成蓝色",
        );

        assert!(matches!(corrected.intent, IntentType::Modify));
    }

    #[test]
    fn corrects_ui_copy_document_request_to_modify() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Document),
            "帮我修改复制按钮的文案，让它更清楚地说明会复制给 Codex",
        );

        assert!(matches!(corrected.intent, IntentType::Modify));
        assert!(corrected.confidence >= 0.75);
    }

    #[test]
    fn corrects_readme_request_to_document() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Unknown),
            "帮我给 README 补充一下本地启动步骤",
        );

        assert!(matches!(corrected.intent, IntentType::Document));
        assert!(corrected.confidence >= 0.75);
    }

    #[test]
    fn corrects_toast_text_document_request_to_modify() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Document),
            "把保存成功 toast 的提示文字改成更清楚的说法",
        );

        assert!(matches!(corrected.intent, IntentType::Modify));
        assert!(corrected.confidence >= 0.75);
    }

    #[test]
    fn corrects_copy_link_mishearing_in_instruction_fields() {
        let mut instruction = llm_instruction(IntentType::Modify);
        instruction.context = "项目包含 ASR 功能、复制功能和亮度功能".to_string();
        instruction.constraints = "不要破坏 ASR 和复制亮度功能".to_string();
        instruction.done_when = "按钮已添加，复制亮度功能仍然正常".to_string();

        let corrected = apply_local_intent_corrections(
            instruction,
            "新增一个使用最近识别文本重新精炼的按钮，不要破坏 ASR 和复制链路功能",
        );

        assert!(corrected.context.contains("复制功能和链路功能"));
        assert!(corrected.constraints.contains("复制链路功能"));
        assert!(corrected.done_when.contains("复制链路功能"));
    }

    #[test]
    fn keeps_real_brightness_context_unchanged() {
        let mut instruction = llm_instruction(IntentType::Modify);
        instruction.context = "项目包含复制功能和屏幕亮度功能".to_string();

        let corrected =
            apply_local_intent_corrections(instruction, "调整复制按钮旁边的屏幕亮度功能");

        assert!(corrected.context.contains("屏幕亮度功能"));
    }

    #[test]
    fn keeps_debug_request_as_debug() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Debug),
            "帮我看一下为什么 npm start 启动失败",
        );

        assert!(matches!(corrected.intent, IntentType::Debug));
    }

    #[test]
    fn keeps_regular_refactor_request_as_refactor() {
        let corrected = apply_local_intent_corrections(
            llm_instruction(IntentType::Refactor),
            "帮我把这个 hook 里面重复的状态更新整理一下",
        );

        assert!(matches!(corrected.intent, IntentType::Refactor));
    }
}
