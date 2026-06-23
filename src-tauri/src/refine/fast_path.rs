// Fast path refinement — pure local string cleanup with no network calls.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;
use std::time::Instant;

static CORRECTION_PATTERNS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    [
        (r"(\d+)\s*个", "$1个"),
        (r"改一下|改改", "修改"),
        (r"搞一个|整一个", "创建"),
        (r"看一下|看看", "查看"),
        (r"跑起来|能跑", "正常运行"),
        (r"(?i)复制给\s*(cos|codec)\s*按钮", "复制给 Codex 按钮"),
        (r"(?i)复制给\s*(cos|codec)", "复制给 Codex"),
    ]
    .into_iter()
    .filter_map(|(pattern, replacement)| Regex::new(pattern).ok().map(|regex| (regex, replacement)))
    .collect()
});

static START_FILLER_PATTERN: Lazy<Option<Regex>> =
    Lazy::new(|| Regex::new(r"^(嗯+|啊+|呃+|哦+|然后|就是|请|麻烦|能不能)[，,\s]*").ok());
static END_PARTICLE_PATTERN: Lazy<Option<Regex>> =
    Lazy::new(|| Regex::new(r"[吧呢啊哦]+[。！!？?]*$").ok());
static REPEATED_PHRASE_PATTERN: Lazy<Option<Regex>> = Lazy::new(|| Regex::new(r"(.{2,8})\1+").ok());
static SPACING_PATTERN: Lazy<Option<Regex>> = Lazy::new(|| Regex::new(r"\s+").ok());

pub struct FastPathCleaner {
    filler_words: Vec<&'static str>,
}

#[derive(Serialize, Debug, Clone)]
pub struct FastPathResult {
    pub cleaned: String,
    pub removed_tokens: u32,
    pub processing_ms: u64,
}

impl FastPathCleaner {
    pub fn new() -> Self {
        Self {
            filler_words: vec![
                "嗯",
                "啊",
                "呃",
                "哦",
                "就是",
                "然后",
                "请",
                "麻烦",
                "能不能",
            ],
        }
    }

    pub fn clean(&self, raw: &str) -> FastPathResult {
        let started_at = Instant::now();
        let mut removed_tokens = 0;
        let mut cleaned = raw.trim().to_string();

        let before = cleaned.clone();
        cleaned = strip_start_fillers(&cleaned);
        removed_tokens += count_removed_tokens(&before, &cleaned, &self.filler_words);

        cleaned = normalize_casual_verbs(&cleaned);
        cleaned = deduplicate_repeated_phrases(&cleaned);

        let before = cleaned.clone();
        cleaned = strip_end_particles(&cleaned);
        if before != cleaned {
            removed_tokens += 1;
        }

        cleaned = normalize_spacing(&cleaned);

        FastPathResult {
            cleaned,
            removed_tokens,
            processing_ms: started_at.elapsed().as_millis() as u64,
        }
    }
}

pub fn warm_up_regexes() {
    Lazy::force(&CORRECTION_PATTERNS);
    Lazy::force(&START_FILLER_PATTERN);
    Lazy::force(&END_PARTICLE_PATTERN);
    Lazy::force(&REPEATED_PHRASE_PATTERN);
    Lazy::force(&SPACING_PATTERN);
}

fn strip_start_fillers(text: &str) -> String {
    let mut output = text.to_string();

    loop {
        let Some(pattern) = START_FILLER_PATTERN.as_ref() else {
            return output;
        };
        let next = pattern.replace(&output, "").trim_start().to_string();
        if next == output {
            return output;
        }
        output = next;
    }
}

fn normalize_casual_verbs(text: &str) -> String {
    let mut output = text.to_string();
    for (pattern, replacement) in CORRECTION_PATTERNS.iter() {
        output = pattern.replace_all(&output, *replacement).to_string();
    }
    output
}

fn deduplicate_repeated_phrases(text: &str) -> String {
    let Some(pattern) = REPEATED_PHRASE_PATTERN.as_ref() else {
        return text.to_string();
    };

    pattern.replace_all(text, "$1").to_string()
}

fn strip_end_particles(text: &str) -> String {
    let Some(pattern) = END_PARTICLE_PATTERN.as_ref() else {
        return text.to_string();
    };

    pattern.replace(text, "").trim().to_string()
}

fn normalize_spacing(text: &str) -> String {
    let Some(pattern) = SPACING_PATTERN.as_ref() else {
        return text.trim().to_string();
    };

    pattern.replace_all(text.trim(), " ").to_string()
}

fn count_removed_tokens(before: &str, after: &str, filler_words: &[&'static str]) -> u32 {
    if before == after {
        return 0;
    }

    filler_words
        .iter()
        .filter(|word| before.starts_with(**word) && !after.starts_with(**word))
        .count() as u32
}

#[cfg(test)]
mod tests {
    use super::FastPathCleaner;

    #[test]
    fn corrects_copy_to_cos_button_to_codex_button() {
        let cleaner = FastPathCleaner::new();
        let result = cleaner.clean("修改复制给 cos 按钮的颜色，把背景改成红色。");

        assert_eq!(
            result.cleaned,
            "修改复制给 Codex 按钮的颜色，把背景改成红色。"
        );
    }

    #[test]
    fn corrects_copy_to_codec_button_to_codex_button() {
        let cleaner = FastPathCleaner::new();
        let result = cleaner.clean("将复制给 Codec 按钮的背景颜色改为红色");

        assert_eq!(result.cleaned, "将复制给 Codex 按钮的背景颜色改为红色");
    }
}
