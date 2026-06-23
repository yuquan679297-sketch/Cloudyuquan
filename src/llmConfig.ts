import {
  CUSTOM_LLM_PRESET_ID,
  DEFAULT_LLM_PROVIDER,
  LLM_PRESETS,
  LlmProtocol,
  PROTOCOL_LABELS,
} from './llmPresets.js';

export const DEFAULT_LLM_API_BASE = 'https://api.deepseek.com/v1';

const VERSIONED_API_BASES = new Map([
  ['https://api.openai.com', 'https://api.openai.com/v1'],
  ['https://api.deepseek.com', 'https://api.deepseek.com/v1'],
  ['https://api.moonshot.ai', 'https://api.moonshot.ai/v1'],
]);

export function normalizeApiBase(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function canonicalizeApiBase(value: string) {
  const normalized = normalizeApiBase(value);
  return VERSIONED_API_BASES.get(normalized) ?? normalized;
}

export function getPresetProvider(presetId: string) {
  return LLM_PRESETS.find((preset) => preset.id === presetId)?.provider ?? DEFAULT_LLM_PROVIDER;
}

export function getPresetIdForConfig(apiBase: string, model: string, protocol: LlmProtocol) {
  const normalizedApiBase = canonicalizeApiBase(apiBase);
  return LLM_PRESETS.find((preset) => (
    canonicalizeApiBase(preset.apiBase) === normalizedApiBase
      && preset.model === model
      && preset.protocol === protocol
  ))?.id ?? CUSTOM_LLM_PRESET_ID;
}

export function getLlmCompatibilityDiagnostic(apiBase: string, model: string, protocol: LlmProtocol) {
  const normalizedApiBase = canonicalizeApiBase(apiBase);
  const trimmedModel = model.trim();
  const matchingPresetId = getPresetIdForConfig(normalizedApiBase, trimmedModel, protocol);

  if (matchingPresetId !== CUSTOM_LLM_PRESET_ID) {
    const preset = LLM_PRESETS.find((item) => item.id === matchingPresetId);
    return {
      status: 'ok' as const,
      detail: `${preset?.provider ?? DEFAULT_LLM_PROVIDER} 预设匹配 · ${PROTOCOL_LABELS[protocol]}`,
    };
  }

  const baseCandidates = LLM_PRESETS.filter((preset) => canonicalizeApiBase(preset.apiBase) === normalizedApiBase);
  if (baseCandidates.length === 0) {
    return {
      status: 'ok' as const,
      detail: `自定义 API Base · ${PROTOCOL_LABELS[protocol]}`,
    };
  }

  const provider = baseCandidates[0]?.provider ?? DEFAULT_LLM_PROVIDER;
  const hasModelMatch = baseCandidates.some((preset) => preset.model === trimmedModel);
  const hasProtocolMatch = baseCandidates.some((preset) => preset.protocol === protocol);

  if (hasModelMatch && !hasProtocolMatch) {
    return {
      status: 'warn' as const,
      detail: `${provider} API Base 已识别，但当前协议不是常用组合，请检查协议选择。`,
    };
  }

  if (!hasModelMatch && hasProtocolMatch) {
    return {
      status: 'warn' as const,
      detail: `${provider} API Base 已识别，但当前模型不在已知预设中，请检查模型名。`,
    };
  }

  return {
    status: 'warn' as const,
    detail: `${provider} API Base 已识别，但当前模型和协议组合需要手动确认。`,
  };
}
