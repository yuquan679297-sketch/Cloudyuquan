import { getStoredBoolean, getStoredString, setStoredString } from './browserStorage.js';

export type TriggerKeyConfig = KeyboardTriggerKeyConfig | MouseTriggerKeyConfig;

export interface KeyboardTriggerKeyConfig {
  source: 'keyboard';
  value: string;
  triggerKeyCode: string;
  triggerKeyName: string;
}

export interface MouseTriggerKeyConfig {
  source: 'mouse';
  value: string;
  button: number;
  triggerKeyCode: string;
  triggerKeyName: string;
}

export const TRIGGER_KEY_STORAGE_KEY = 'voicehub.triggerKey.v1';
export const TRIGGER_KEY_ENABLED_STORAGE_KEY = 'voicehub.triggerKey.enabled.v1';
export const DEFAULT_TRIGGER_KEY_ENABLED = true;

export const DEFAULT_TRIGGER_KEY_CONFIG: TriggerKeyConfig = {
  source: 'keyboard',
  value: 'F9',
  triggerKeyCode: 'keyboard:F9',
  triggerKeyName: 'F9',
};

export function loadTriggerKeyConfig(): TriggerKeyConfig {
  const storedValue = getStoredString(TRIGGER_KEY_STORAGE_KEY);
  if (!storedValue) {
    return DEFAULT_TRIGGER_KEY_CONFIG;
  }

  try {
    const parsed = JSON.parse(storedValue) as unknown;
    return isTriggerKeyConfig(parsed) ? parsed : DEFAULT_TRIGGER_KEY_CONFIG;
  } catch {
    return DEFAULT_TRIGGER_KEY_CONFIG;
  }
}

export function saveTriggerKeyConfig(config: TriggerKeyConfig) {
  setStoredString(TRIGGER_KEY_STORAGE_KEY, JSON.stringify(config));
}

export function loadTriggerKeyEnabled(): boolean {
  return getStoredBoolean(TRIGGER_KEY_ENABLED_STORAGE_KEY, DEFAULT_TRIGGER_KEY_ENABLED);
}

export function saveTriggerKeyEnabled(enabled: boolean) {
  setStoredString(TRIGGER_KEY_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
}

export function isTriggerKeyConfig(value: unknown): value is TriggerKeyConfig {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const config = value as Partial<TriggerKeyConfig>;
  if (
    typeof config.value !== 'string' ||
    typeof config.triggerKeyCode !== 'string' ||
    typeof config.triggerKeyName !== 'string'
  ) {
    return false;
  }

  if (config.source === 'keyboard') {
    return true;
  }

  return (
    config.source === 'mouse' &&
    typeof config.button === 'number' &&
    config.button > 2
  );
}
