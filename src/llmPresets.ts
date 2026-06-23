export type LlmProtocol = 'openaiChat' | 'openaiResponses' | 'anthropicMessages';

export interface LlmPreset {
  id: string;
  provider: string;
  label: string;
  apiBase: string;
  model: string;
  protocol: LlmProtocol;
}

export const CUSTOM_LLM_PRESET_ID = 'custom-openai-compatible';
export const DEFAULT_LLM_PROVIDER = 'DeepSeek';
export const DEFAULT_LLM_PROTOCOL: LlmProtocol = 'openaiChat';

// Model names are intentionally kept in one place so they can be checked against official provider docs.
export const LLM_PRESETS: LlmPreset[] = [
  {
    id: 'openai-low',
    provider: 'OpenAI',
    label: 'gpt-5.4-mini',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-5.4-mini',
    protocol: 'openaiResponses',
  },
  {
    id: 'openai-strong',
    provider: 'OpenAI',
    label: 'gpt-5.5',
    apiBase: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    protocol: 'openaiResponses',
  },
  {
    id: 'deepseek-low',
    provider: 'DeepSeek',
    label: 'deepseek-v4-flash',
    apiBase: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    protocol: 'openaiChat',
  },
  {
    id: 'deepseek-strong',
    provider: 'DeepSeek',
    label: 'deepseek-v4-pro',
    apiBase: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    protocol: 'openaiChat',
  },
  {
    id: 'kimi-low',
    provider: 'Kimi / Moonshot',
    label: 'moonshot-v1-8k',
    apiBase: 'https://api.moonshot.ai/v1',
    model: 'moonshot-v1-8k',
    protocol: 'openaiChat',
  },
  {
    id: 'kimi-strong',
    provider: 'Kimi / Moonshot',
    label: 'kimi-k2.6',
    apiBase: 'https://api.moonshot.ai/v1',
    model: 'kimi-k2.6',
    protocol: 'openaiChat',
  },
  {
    id: 'qwen-low',
    provider: 'Qwen / DashScope',
    label: 'qwen-flash',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    protocol: 'openaiChat',
  },
  {
    id: 'qwen-strong',
    provider: 'Qwen / DashScope',
    label: 'qwen3-max',
    apiBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-max',
    protocol: 'openaiChat',
  },
  {
    id: 'gemini-low',
    provider: 'Google Gemini',
    label: 'gemini-3.5-flash',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-3.5-flash',
    protocol: 'openaiChat',
  },
  {
    id: 'gemini-strong',
    provider: 'Google Gemini',
    label: 'gemini-3-pro-preview',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-3-pro-preview',
    protocol: 'openaiChat',
  },
  {
    id: 'claude-low',
    provider: 'Anthropic Claude',
    label: 'claude-haiku-4-5',
    apiBase: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    protocol: 'anthropicMessages',
  },
  {
    id: 'claude-strong',
    provider: 'Anthropic Claude',
    label: 'claude-opus-4-8',
    apiBase: 'https://api.anthropic.com',
    model: 'claude-opus-4-8',
    protocol: 'anthropicMessages',
  },
  {
    id: 'glm-low',
    provider: '智谱 GLM',
    label: 'glm-4.5-air',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5-air',
    protocol: 'openaiChat',
  },
  {
    id: 'glm-strong',
    provider: '智谱 GLM',
    label: 'glm-4.5',
    apiBase: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4.5',
    protocol: 'openaiChat',
  },
];

export const PROTOCOL_LABELS: Record<LlmProtocol, string> = {
  openaiChat: 'OpenAI Chat Completions',
  openaiResponses: 'OpenAI Responses',
  anthropicMessages: 'Anthropic Messages',
};
