// Codex-specific prompt templates for refined voice instructions.

use super::{IntentType, RefinedInstruction};

pub fn render_codex_prompt(instruction: &RefinedInstruction) -> String {
    if matches!(instruction.intent, IntentType::Unknown) && instruction.confidence < 0.6 {
        return String::new();
    }

    let mut lines = Vec::new();

    push_section(&mut lines, "Task", Some(instruction.goal.as_str()));
    push_section(&mut lines, "Context", Some(instruction.context.as_str()));
    push_section(
        &mut lines,
        "Constraints",
        Some(instruction.constraints.as_str()),
    );
    if !is_weak_done_when(&instruction.done_when) {
        push_section(
            &mut lines,
            "Done when",
            Some(instruction.done_when.as_str()),
        );
    }
    if instruction.confidence < 0.75 {
        push_section(
            &mut lines,
            "Original",
            Some(instruction.cleaned_input.as_str()),
        );
    }

    lines.join("\n")
}

fn push_section(lines: &mut Vec<String>, label: &str, value: Option<&str>) {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    lines.push(format!("{label}: {value}"));
}

fn is_weak_done_when(value: &str) -> bool {
    let value = value.trim();
    value.is_empty()
        || [
            "确认语音指令被接收",
            "语音指令被接收",
            "确认语音识别成功",
            "确认录音被接收",
        ]
        .iter()
        .any(|weak_value| value.contains(weak_value))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instruction(intent: IntentType) -> RefinedInstruction {
        RefinedInstruction {
            goal: "将 login() 函数改为 async 异步实现并添加错误处理".to_string(),
            context: "存在同步登录函数，可能使用 JavaScript 或 TypeScript".to_string(),
            constraints: "保留原有函数签名，使用 try/catch 捕获异常".to_string(),
            done_when: "函数声明包含 async 关键字，函数体包含 try/catch 块".to_string(),
            intent,
            confidence: 0.8,
            raw_input: "帮我把登录函数改成异步的，加上错误处理".to_string(),
            cleaned_input: "帮我把登录函数改成异步的，加上错误处理".to_string(),
            processing_ms: 1,
        }
    }

    #[test]
    fn renders_compact_task_card_for_modify() {
        let prompt = render_codex_prompt(&instruction(IntentType::Modify));

        assert_eq!(
            prompt,
            [
                "Task: 将 login() 函数改为 async 异步实现并添加错误处理",
                "Context: 存在同步登录函数，可能使用 JavaScript 或 TypeScript",
                "Constraints: 保留原有函数签名，使用 try/catch 捕获异常",
                "Done when: 函数声明包含 async 关键字，函数体包含 try/catch 块",
            ]
            .join("\n")
        );
        assert!(!prompt.contains("# Codex 任务"));
        assert!(!prompt.contains("Codex rules"));
        assert!(!prompt.contains("Behavior"));
    }

    #[test]
    fn omits_empty_structured_fields() {
        let mut instruction = instruction(IntentType::Modify);
        instruction.context = String::new();
        instruction.constraints = String::new();
        instruction.done_when = String::new();
        let prompt = render_codex_prompt(&instruction);

        assert_eq!(
            prompt,
            "Task: 将 login() 函数改为 async 异步实现并添加错误处理"
        );
        assert!(!prompt.contains("Context:"));
        assert!(!prompt.contains("Constraints:"));
        assert!(!prompt.contains("Done when:"));
    }

    #[test]
    fn suppresses_low_confidence_unknown_prompt() {
        let mut instruction = instruction(IntentType::Unknown);
        instruction.confidence = 0.5;
        let prompt = render_codex_prompt(&instruction);

        assert!(prompt.is_empty());
    }

    #[test]
    fn includes_original_for_low_confidence_executable_prompt() {
        let mut instruction = instruction(IntentType::Modify);
        instruction.confidence = 0.7;
        let prompt = render_codex_prompt(&instruction);

        assert!(prompt.contains("Original: 帮我把登录函数改成异步的，加上错误处理"));
    }

    #[test]
    fn omits_weak_voice_receipt_done_when() {
        let mut instruction = instruction(IntentType::Modify);
        instruction.done_when = "确认语音指令被接收".to_string();
        let prompt = render_codex_prompt(&instruction);

        assert!(!prompt.contains("确认语音指令被接收"));
        assert!(!prompt.contains("Done when:"));
    }

    #[test]
    fn does_not_add_intent_specific_generic_sections() {
        let prompt = render_codex_prompt(&instruction(IntentType::Test));

        assert!(!prompt.contains("Output"));
        assert!(!prompt.contains("Verification"));
        assert!(!prompt.contains("Safety check"));
        assert!(!prompt.contains("Test scope"));
    }

    #[test]
    fn renders_debug_task_without_old_wrapper() {
        let mut instruction = instruction(IntentType::Debug);
        instruction.goal = "排查 npm start 启动失败的原因".to_string();
        instruction.context = "本地开发服务启动失败".to_string();
        instruction.constraints = "不要改动无关文件".to_string();
        instruction.done_when = "找到失败原因并给出最小修复".to_string();
        let prompt = render_codex_prompt(&instruction);

        assert!(prompt.starts_with("Task: 排查 npm start 启动失败的原因"));
        assert!(prompt.contains("Done when: 找到失败原因并给出最小修复"));
        assert!(!prompt.contains("# Codex 任务"));
        assert!(!prompt.contains("Codex rules"));
    }

    #[test]
    fn omits_done_when_that_mentions_voice_receipt_inside_sentence() {
        let mut instruction = instruction(IntentType::Modify);
        instruction.done_when = "完成后确认语音识别成功并展示结果".to_string();
        let prompt = render_codex_prompt(&instruction);

        assert!(!prompt.contains("Done when:"));
        assert!(!prompt.contains("确认语音识别成功"));
    }

    #[test]
    fn renders_confident_unknown_when_llm_supplies_actionable_content() {
        let mut instruction = instruction(IntentType::Unknown);
        instruction.confidence = 0.65;
        let prompt = render_codex_prompt(&instruction);

        assert!(prompt.contains("Task: 将 login() 函数改为 async 异步实现并添加错误处理"));
    }

    #[test]
    fn includes_original_for_low_confidence_debug_prompt() {
        let mut instruction = instruction(IntentType::Debug);
        instruction.confidence = 0.72;
        instruction.cleaned_input = "帮我看一下为什么 npm start 启动失败".to_string();
        let prompt = render_codex_prompt(&instruction);

        assert!(prompt.contains("Original: 帮我看一下为什么 npm start 启动失败"));
    }
}
