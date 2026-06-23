// App root — wires VoiceButton and TranscriptPanel together.

import { invoke } from '@tauri-apps/api/core';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { getAsrTargetDiagnostic } from './asrDiagnostics.js';
import { VoiceButton } from './components/VoiceButton';
import { TranscriptPanel } from './components/TranscriptPanel';
import { UiIcon } from './components/UiIcon';
import { getShortcutIssueSummary, humanizeStatusMessage } from './errorMessages.js';
import { useAudio } from './hooks/useAudio';
import { normalizeShortcut, useGlobalShortcut } from './hooks/useGlobalShortcut';
import { useMouseShortcut } from './hooks/useMouseShortcut';
import { useRefine } from './hooks/useRefine';
import {
  CUSTOM_LLM_PRESET_ID,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_PROTOCOL,
  LLM_PRESETS,
  LlmProtocol,
  PROTOCOL_LABELS,
} from './llmPresets';
import {
  DEFAULT_LLM_API_BASE,
  canonicalizeApiBase,
  getLlmCompatibilityDiagnostic,
  getPresetIdForConfig,
  getPresetProvider,
} from './llmConfig';
import {
  DEFAULT_TRIGGER_KEY_CONFIG,
  loadTriggerKeyConfig,
  loadTriggerKeyEnabled,
  saveTriggerKeyConfig,
  saveTriggerKeyEnabled,
  TriggerKeyConfig,
} from './triggerKeyConfig';
import { TranscriptResult } from './types';
import {
  getDiagnosticFreshness,
  getNextSettingsSection,
  getSettingsIssueAction,
  getWorkflowStage,
} from './uiWorkflow.js';

const DEFAULT_HOTWORDS = [
  'Codex',
  'Python',
  'JavaScript',
  'Java',
  'Go',
  'Rust',
  'TypeScript',
  'Tauri',
  'React',
  'Vue',
  'Next.js',
  'Node.js',
  'Express',
  'FastAPI',
  'Tokio',
  'HTML',
  'CSS',
  'Tailwind',
  'WebSocket',
  'REST',
  'GraphQL',
  'HTTP',
  'JSON',
  'JWT',
  'OAuth',
  'async',
  'await',
  'Promise',
  'callback',
  'closure',
  'generic',
  'iterator',
  'lifetime',
  'component',
  'hook',
  'state',
  'props',
  'middleware',
  'API',
  'endpoint',
  'Docker',
  'Git',
  'GitHub',
  'npm',
  'pnpm',
  'Cargo',
  'cargo check',
  'npm run build',
  'Vite',
  'AudioWorklet',
  'PCM',
  'ASR',
  '数组',
  '闭包',
  '异步',
  '接口',
  '组件',
  '中间件',
  '泛型',
  '生命周期',
];

function parseHotwords(value: string) {
  const words = value
    .split(/[\n,，;；]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  return Array.from(new Set(words));
}

interface RuntimeAsrConfig {
  apiKey?: string;
  appKey?: string;
  accessKey?: string;
  resourceId?: string;
  endpoint?: string;
}

interface RuntimeLlmConfig {
  apiKey?: string;
  apiBase?: string;
  model?: string;
  protocol?: LlmProtocol;
  provider?: string;
}

interface DevConfig {
  asr?: RuntimeAsrConfig;
  llm?: RuntimeLlmConfig;
}

interface PersistedRuntimeConfig {
  asr?: RuntimeAsrConfig;
  llm?: RuntimeLlmConfig;
}

type DiagnosticStatus = 'ok' | 'warn' | 'error';
type SettingsSectionId = 'diagnostics' | 'shortcut' | 'asr' | 'llm' | 'hotwords';

interface DiagnosticItem {
  label: string;
  detail: string;
  status: DiagnosticStatus;
  suggestion?: string;
}

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);
const CAPTURE_PROMPT = '请按下要设置的键...';
const UNAVAILABLE_KEY_MESSAGE = '该按键不可用，请更换';
const DEFAULT_ASR_RESOURCE_ID = 'volc.seedasr.sauc.duration';
const DEFAULT_ASR_ENDPOINT = 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async';
const DRAWER_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getDrawerFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR))
    .filter((element) => element.getClientRects().length > 0);
}

function getShortcutDiagnosticSuggestion(source: 'keyboard' | 'mouse', message: string) {
  if (source === 'mouse' && message.includes('辅助功能')) {
    return '在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub，然后重新运行诊断。';
  }

  if (message.includes('不能为空') || message.includes('不可用')) {
    return '重新设置按住说话快捷键，确保不是空值或不可用按键。';
  }

  return '重新设置一次按住说话快捷键，再运行诊断确认是否恢复。';
}

function getLlmCompatibilitySuggestion(detail: string) {
  if (detail.includes('协议不是常用组合')) {
    return '优先切回当前提供商的预设协议；如果必须自定义，再确认服务端文档是否支持。';
  }

  if (detail.includes('模型不在已知预设中')) {
    return '先检查模型名拼写；如果只是想快速跑通，优先改回当前提供商的预设模型。';
  }

  if (detail.includes('需要手动确认')) {
    return '如果这不是刻意的自定义组合，优先切回同提供商预设，避免首轮精炼请求失败。';
  }

  return '';
}

const KEY_NAME_BY_CODE: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

interface CapturedKeyboardKey {
  value: string;
  triggerKeyCode: string;
  triggerKeyName: string;
}

function getKeyboardShortcutFromEvent(event: KeyboardEvent): CapturedKeyboardKey | null {
  const mainKey = getMainKeyFromEvent(event);
  if (!mainKey) {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(mainKey);

  const value = normalizeShortcut(parts.join('+'));
  if (!value || value === 'Escape') {
    return null;
  }

  return {
    value,
    triggerKeyCode: `keyboard:${value}`,
    triggerKeyName: getFriendlyShortcutName(event, value),
  };
}

function getMainKeyFromEvent(event: KeyboardEvent) {
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
  if (/^F([1-9]|1\d|2[0-4])$/.test(event.code)) return event.code;
  if (KEY_NAME_BY_CODE[event.code]) return KEY_NAME_BY_CODE[event.code];
  if (event.key.length === 1) return event.key.toUpperCase();

  return event.key;
}

function getFriendlyKeyName(event: KeyboardEvent, value: string) {
  if (/^Digit\d$/.test(event.code)) return `数字键${event.code.slice(5)}`;
  if (value === 'Space') return '空格';
  if (value === 'Enter') return '回车';
  if (value === 'Backspace') return '退格';
  if (value === 'Delete') return '删除';
  if (value === 'ArrowUp') return '方向键上';
  if (value === 'ArrowDown') return '方向键下';
  if (value === 'ArrowLeft') return '方向键左';
  if (value === 'ArrowRight') return '方向键右';

  return value;
}

function getFriendlyShortcutName(event: KeyboardEvent, value: string) {
  if (!hasModifier(event)) {
    return getFriendlyKeyName(event, value);
  }

  return value;
}

function getMouseTriggerKeyConfig(button: number): TriggerKeyConfig | null {
  if (button <= 2) {
    return null;
  }

  const triggerKeyName =
    button === 3 ? '鼠标侧键1' : button === 4 ? '鼠标侧键2' : `鼠标自定义键${button}`;

  return {
    source: 'mouse',
    value: `Mouse Button ${button}`,
    button,
    triggerKeyCode: `mouse:${button}`,
    triggerKeyName,
  };
}

function hasModifier(event: KeyboardEvent) {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSettingsSection, setOpenSettingsSection] = useState<SettingsSectionId>('diagnostics');
  const [showAsrSecret, setShowAsrSecret] = useState(false);
  const [showLegacySecrets, setShowLegacySecrets] = useState(false);
  const [showLlmSecret, setShowLlmSecret] = useState(false);
  const settingsTriggerRef = useRef<HTMLElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsDialogRef = useRef<HTMLElement | null>(null);
  const settingsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const {
    cleanedText,
    refined,
    refining,
    codexPrompt,
    lastCodexPrompt,
    promptHistory,
    persistPromptHistory,
    autoCopy,
    autoCopyStatus,
    setAutoCopy,
    setPromptHistoryPersistence,
    refineError,
    refineTranscript,
    clearCurrentRefinement,
    reusePromptFromHistory,
    clearPromptHistory,
    clearDisplayedPrompt,
  } = useRefine();
  const [manualRefineText, setManualRefineText] = useState('');
  const [manualTranscript, setManualTranscript] = useState<TranscriptResult | null>(null);
  const [promptRegenerationNotice, setPromptRegenerationNotice] = useState('');
  const handleRecordingStart = useCallback(() => {
    setManualTranscript(null);
    setPromptRegenerationNotice('');
    clearCurrentRefinement();
  }, [clearCurrentRefinement]);
  const {
    state,
    transcript,
    livePreviewText,
    audioLevel,
    errorMessage,
    startRecording,
    stopRecording,
  } = useAudio({
    onFinalTranscript: refineTranscript,
    onRecordingStart: handleRecordingStart,
    stopOnSilence: false,
  });

  useEffect(() => {
    if (!promptRegenerationNotice) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setPromptRegenerationNotice(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [promptRegenerationNotice]);

  useEffect(() => {
    if (!settingsOpen) {
      return undefined;
    }

    const focusTimer = window.setTimeout(() => {
      settingsCloseButtonRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = settingsDialogRef.current;
      if (!dialog) {
        return;
      }

      const focusableElements = getDrawerFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (activeElement === firstElement || !dialog.contains(activeElement)) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      const focusTarget = settingsTriggerRef.current ?? settingsButtonRef.current;
      window.setTimeout(() => {
        if (focusTarget?.isConnected) {
          focusTarget.focus();
        }
      }, 0);
    };
  }, [settingsOpen]);

  const [asrKey, setAsrKey] = useState('');
  const [asrAppKey, setAsrAppKey] = useState('');
  const [asrAccessKey, setAsrAccessKey] = useState('');
  const [asrResourceId, setAsrResourceId] = useState(DEFAULT_ASR_RESOURCE_ID);
  const [asrEndpoint, setAsrEndpoint] = useState(DEFAULT_ASR_ENDPOINT);
  const [asrKeyStatus, setAsrKeyStatus] = useState('');
  const [isSavingAsrKey, setIsSavingAsrKey] = useState(false);
  const [isClearingAsrConfig, setIsClearingAsrConfig] = useState(false);
  const [llmKey, setLlmKey] = useState('');
  const [llmPresetId, setLlmPresetId] = useState('deepseek-low');
  const [llmProvider, setLlmProvider] = useState(DEFAULT_LLM_PROVIDER);
  const [llmProtocol, setLlmProtocol] = useState<LlmProtocol>(DEFAULT_LLM_PROTOCOL);
  const [llmApiBase, setLlmApiBase] = useState(DEFAULT_LLM_API_BASE);
  const [llmModel, setLlmModel] = useState('deepseek-v4-flash');
  const [llmStatus, setLlmStatus] = useState('');
  const [isSavingLlmConfig, setIsSavingLlmConfig] = useState(false);
  const [isClearingLlmConfig, setIsClearingLlmConfig] = useState(false);
  const [hotwordText, setHotwordText] = useState('');
  const [hotwordStatus, setHotwordStatus] = useState('');
  const [isSavingHotwords, setIsSavingHotwords] = useState(false);
  const [globalShortcutEnabled, setGlobalShortcutEnabled] = useState(() => loadTriggerKeyEnabled());
  const [activeShortcut, setActiveShortcut] = useState<TriggerKeyConfig>(() => loadTriggerKeyConfig());
  const [isCapturingShortcut, setIsCapturingShortcut] = useState(false);
  const [shortcutCaptureHint, setShortcutCaptureHint] = useState('');
  const [shortcutCaptureValue, setShortcutCaptureValue] = useState(CAPTURE_PROMPT);
  const [diagnosticItems, setDiagnosticItems] = useState<DiagnosticItem[]>([]);
  const [diagnosticStatus, setDiagnosticStatus] = useState('');
  const [diagnosticRevision, setDiagnosticRevision] = useState(0);
  const [diagnosticSnapshotRevision, setDiagnosticSnapshotRevision] = useState(0);
  const captureResetTimerRef = useRef<number | null>(null);

  const handleGlobalShortcutPressed = useCallback(() => {
    void startRecording();
  }, [startRecording]);

  const toggleSettingsSection = useCallback((section: SettingsSectionId, open: boolean) => {
    setOpenSettingsSection((currentSection) => getNextSettingsSection(currentSection, section, open));
  }, []);

  const handleGlobalShortcutReleased = useCallback(() => {
    void stopRecording();
  }, [stopRecording]);

  const {
    status: globalShortcutStatus,
    errorMessage: globalShortcutError,
  } = useGlobalShortcut({
    enabled: globalShortcutEnabled && activeShortcut.source === 'keyboard',
    shortcut: activeShortcut.source === 'keyboard' ? activeShortcut.value : '',
    onPressed: handleGlobalShortcutPressed,
    onReleased: handleGlobalShortcutReleased,
  });

  const {
    status: mouseShortcutStatus,
    errorMessage: mouseShortcutError,
  } = useMouseShortcut({
    enabled: globalShortcutEnabled && activeShortcut.source === 'mouse',
    button: activeShortcut.source === 'mouse' ? activeShortcut.button : null,
    onPressed: handleGlobalShortcutPressed,
    onReleased: handleGlobalShortcutReleased,
  });

  const clearCaptureResetTimer = useCallback(() => {
    if (captureResetTimerRef.current === null) {
      return;
    }

    window.clearTimeout(captureResetTimerRef.current);
    captureResetTimerRef.current = null;
  }, []);

  const showTemporaryCaptureMessage = useCallback((message: string) => {
    clearCaptureResetTimer();
    setShortcutCaptureValue(message);
    setShortcutCaptureHint(message);
    captureResetTimerRef.current = window.setTimeout(() => {
      setShortcutCaptureValue(CAPTURE_PROMPT);
      setShortcutCaptureHint('等待按键...');
      captureResetTimerRef.current = null;
    }, 2000);
  }, [clearCaptureResetTimer]);

  const cancelShortcutCapture = useCallback(() => {
    clearCaptureResetTimer();
    setIsCapturingShortcut(false);
    setShortcutCaptureValue(CAPTURE_PROMPT);
    setShortcutCaptureHint('');
  }, [clearCaptureResetTimer]);

  const updateGlobalShortcutEnabled = useCallback((enabled: boolean) => {
    saveTriggerKeyEnabled(enabled);
    setGlobalShortcutEnabled(enabled);
  }, []);

  const applyTriggerKeyConfig = useCallback((config: TriggerKeyConfig) => {
    clearCaptureResetTimer();
    saveTriggerKeyConfig(config);
    setActiveShortcut(config);
    setIsCapturingShortcut(false);
    setShortcutCaptureValue(CAPTURE_PROMPT);
    setShortcutCaptureHint(`已设置：${config.triggerKeyName}`);
  }, [clearCaptureResetTimer]);

  const restoreDefaultTriggerKey = useCallback(() => {
    applyTriggerKeyConfig(DEFAULT_TRIGGER_KEY_CONFIG);
  }, [applyTriggerKeyConfig]);

  const applyKeyboardShortcut = useCallback((capturedKey: CapturedKeyboardKey) => {
    applyTriggerKeyConfig({
      source: 'keyboard',
      value: capturedKey.value,
      triggerKeyCode: capturedKey.triggerKeyCode,
      triggerKeyName: capturedKey.triggerKeyName,
    });
  }, [applyTriggerKeyConfig]);

  const applyMouseShortcut = useCallback((button: number) => {
    const config = getMouseTriggerKeyConfig(button);
    if (!config) {
      showTemporaryCaptureMessage(UNAVAILABLE_KEY_MESSAGE);
      return;
    }

    applyTriggerKeyConfig(config);
  }, [applyTriggerKeyConfig, showTemporaryCaptureMessage]);

  useEffect(() => {
    if (!isCapturingShortcut) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        cancelShortcutCapture();
        return;
      }

      if (MODIFIER_KEYS.has(event.key)) {
        showTemporaryCaptureMessage(UNAVAILABLE_KEY_MESSAGE);
        return;
      }

      const capturedKey = getKeyboardShortcutFromEvent(event);
      if (!capturedKey) {
        showTemporaryCaptureMessage(UNAVAILABLE_KEY_MESSAGE);
        return;
      }

      applyKeyboardShortcut(capturedKey);
    };

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const isShortcutInput = target?.id === 'global-shortcut';

      if (event.button <= 2) {
        if (!isShortcutInput) {
          cancelShortcutCapture();
        }
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyMouseShortcut(event.button);
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [
    applyKeyboardShortcut,
    applyMouseShortcut,
    cancelShortcutCapture,
    isCapturingShortcut,
    showTemporaryCaptureMessage,
  ]);

  useEffect(() => {
    let cancelled = false;

    const applyAsrConfig = async (config: RuntimeAsrConfig, status: string) => {
      const nextAsrKey = config.apiKey ?? '';
      const nextAsrAppKey = config.appKey ?? '';
      const nextAsrAccessKey = config.accessKey ?? '';
      const nextAsrResourceId = config.resourceId ?? asrResourceId;
      const nextAsrEndpoint = config.endpoint ?? asrEndpoint;

      setAsrKey(nextAsrKey);
      setAsrAppKey(nextAsrAppKey);
      setAsrAccessKey(nextAsrAccessKey);
      setAsrResourceId(nextAsrResourceId);
      setAsrEndpoint(nextAsrEndpoint);
      await invoke('set_asr_config', {
        config: {
          apiKey: nextAsrKey,
          appKey: nextAsrAppKey,
          accessKey: nextAsrAccessKey,
          resourceId: nextAsrResourceId,
          endpoint: nextAsrEndpoint,
        },
      });
      if (!cancelled) {
        setAsrKeyStatus(status);
      }
    };

    const applyLlmConfig = async (config: RuntimeLlmConfig, status: string) => {
      const nextLlmKey = config.apiKey ?? '';
      const nextLlmApiBase = canonicalizeApiBase(config.apiBase ?? llmApiBase);
      const nextLlmModel = config.model ?? llmModel;
      const nextLlmProtocol = config.protocol ?? llmProtocol;
      const nextLlmPresetId = getPresetIdForConfig(nextLlmApiBase, nextLlmModel, nextLlmProtocol);
      const nextLlmProvider = config.provider ?? getPresetProvider(nextLlmPresetId);

      setLlmKey(nextLlmKey);
      setLlmApiBase(nextLlmApiBase);
      setLlmModel(nextLlmModel);
      setLlmProtocol(nextLlmProtocol);
      setLlmPresetId(nextLlmPresetId);
      setLlmProvider(nextLlmProvider);
      await invoke('set_llm_config', {
        config: {
          apiKey: nextLlmKey,
          apiBase: nextLlmApiBase,
          model: nextLlmModel,
          protocol: nextLlmProtocol,
          provider: nextLlmProvider,
        },
      });
      if (!cancelled) {
        setLlmStatus(status);
      }
    };

    const loadRuntimeConfig = async () => {
      const getErrorMessage = (error: unknown) => (
        error instanceof Error ? error.message : String(error)
      );
      let savedConfig: PersistedRuntimeConfig = {};
      let devConfig: DevConfig | null = null;

      try {
        savedConfig = await invoke<PersistedRuntimeConfig>('get_persisted_runtime_config');
      } catch (error) {
        if (!cancelled) {
          const message = getErrorMessage(error);
          setAsrKeyStatus(`读取本地保存配置失败：${message}`);
          setLlmStatus(`读取本地保存配置失败：${message}`);
        }
      }

      try {
        devConfig = await invoke<DevConfig | null>('get_dev_config');
      } catch (error) {
        if (!cancelled) {
          const message = getErrorMessage(error);
          setAsrKeyStatus((current) => current || `读取开发配置失败：${message}`);
          setLlmStatus((current) => current || `读取开发配置失败：${message}`);
        }
      }

      if (cancelled) {
        return;
      }

      try {
        if (savedConfig.asr) {
          await applyAsrConfig(savedConfig.asr, '已从本地保存配置自动应用');
        } else if (devConfig?.asr) {
          await applyAsrConfig(devConfig.asr, '已从开发配置自动应用');
        }
      } catch (error) {
        if (!cancelled) {
          setAsrKeyStatus(getErrorMessage(error));
        }
      }

      try {
        if (savedConfig.llm) {
          await applyLlmConfig(savedConfig.llm, '已从本地保存配置自动应用');
        } else if (devConfig?.llm) {
          await applyLlmConfig(devConfig.llm, '已从开发配置自动应用');
        }
      } catch (error) {
        if (!cancelled) {
          setLlmStatus(getErrorMessage(error));
        }
      }
    };

    void loadRuntimeConfig();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveAsrKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingAsrKey(true);
    setAsrKeyStatus('');

    try {
      await invoke('set_asr_config', {
        config: {
          apiKey: asrKey,
          appKey: asrAppKey,
          accessKey: asrAccessKey,
          resourceId: asrResourceId,
          endpoint: asrEndpoint,
        },
      });
      await invoke('save_persisted_asr_config', {
        config: {
          apiKey: asrKey,
          appKey: asrAppKey,
          accessKey: asrAccessKey,
          resourceId: asrResourceId,
          endpoint: asrEndpoint,
        },
      });
      setAsrKeyStatus('豆包 ASR 配置已应用并保存');
    } catch (error) {
      setAsrKeyStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingAsrKey(false);
    }
  };

  const clearSavedAsrConfig = async () => {
    setIsClearingAsrConfig(true);
    setAsrKeyStatus('');

    try {
      await invoke('clear_persisted_asr_config');
      await invoke('set_asr_config', {
        config: {
          apiKey: '',
          appKey: '',
          accessKey: '',
          resourceId: DEFAULT_ASR_RESOURCE_ID,
          endpoint: DEFAULT_ASR_ENDPOINT,
        },
      });
      setAsrKey('');
      setAsrAppKey('');
      setAsrAccessKey('');
      setAsrResourceId(DEFAULT_ASR_RESOURCE_ID);
      setAsrEndpoint(DEFAULT_ASR_ENDPOINT);
      setDiagnosticItems([]);
      setDiagnosticStatus('');
      setDiagnosticSnapshotRevision(0);
      setAsrKeyStatus('已清除本机保存的 ASR 配置');
    } catch (error) {
      setAsrKeyStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClearingAsrConfig(false);
    }
  };

  const selectLlmPreset = (presetId: string) => {
    setLlmPresetId(presetId);

    const preset = LLM_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      setLlmProvider('自定义');
      setLlmProtocol(DEFAULT_LLM_PROTOCOL);
      return;
    }

    setLlmProvider(preset.provider);
    setLlmProtocol(preset.protocol);
    setLlmApiBase(canonicalizeApiBase(preset.apiBase));
    setLlmModel(preset.model);
  };

  const editLlmModel = (value: string) => {
    setLlmModel(value);
    setLlmPresetId(CUSTOM_LLM_PRESET_ID);
    setLlmProvider('自定义');
  };

  const editLlmApiBase = (value: string) => {
    setLlmApiBase(value);
    setLlmPresetId(CUSTOM_LLM_PRESET_ID);
    setLlmProvider('自定义');
  };

  const editLlmProtocol = (value: LlmProtocol) => {
    setLlmProtocol(value);
    setLlmPresetId(CUSTOM_LLM_PRESET_ID);
    setLlmProvider('自定义');
  };

  const saveLlmConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingLlmConfig(true);
    setLlmStatus('');

    try {
      const nextLlmApiBase = canonicalizeApiBase(llmApiBase);
      const nextLlmPresetId = getPresetIdForConfig(nextLlmApiBase, llmModel, llmProtocol);
      const nextLlmProvider = nextLlmPresetId === CUSTOM_LLM_PRESET_ID
        ? llmProvider
        : getPresetProvider(nextLlmPresetId);
      await invoke('set_llm_config', {
        config: {
          apiKey: llmKey,
          apiBase: nextLlmApiBase,
          model: llmModel,
          protocol: llmProtocol,
          provider: nextLlmProvider,
        },
      });
      await invoke('save_persisted_llm_config', {
        config: {
          apiKey: llmKey,
          apiBase: nextLlmApiBase,
          model: llmModel,
          protocol: llmProtocol,
          provider: nextLlmProvider,
        },
      });
      setLlmApiBase(nextLlmApiBase);
      setLlmPresetId(nextLlmPresetId);
      setLlmProvider(nextLlmProvider);
      setLlmStatus('LLM 精炼配置已应用并保存');
    } catch (error) {
      setLlmStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingLlmConfig(false);
    }
  };

  const clearSavedLlmConfig = async () => {
    const defaultPreset = LLM_PRESETS.find((preset) => preset.id === 'deepseek-low');
    const nextProvider = defaultPreset?.provider ?? DEFAULT_LLM_PROVIDER;
    const nextProtocol = defaultPreset?.protocol ?? DEFAULT_LLM_PROTOCOL;
    const nextApiBase = canonicalizeApiBase(defaultPreset?.apiBase ?? DEFAULT_LLM_API_BASE);
    const nextModel = defaultPreset?.model ?? 'deepseek-v4-flash';

    setIsClearingLlmConfig(true);
    setLlmStatus('');

    try {
      await invoke('clear_persisted_llm_config');
      await invoke('set_llm_config', {
        config: {
          apiKey: '',
          apiBase: nextApiBase,
          model: nextModel,
          protocol: nextProtocol,
          provider: nextProvider,
        },
      });
      setLlmKey('');
      setLlmPresetId(defaultPreset?.id ?? CUSTOM_LLM_PRESET_ID);
      setLlmProvider(nextProvider);
      setLlmProtocol(nextProtocol);
      setLlmApiBase(nextApiBase);
      setLlmModel(nextModel);
      setDiagnosticItems([]);
      setDiagnosticStatus('');
      setDiagnosticSnapshotRevision(0);
      setLlmStatus('已清除本机保存的 LLM 配置');
    } catch (error) {
      setLlmStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsClearingLlmConfig(false);
    }
  };

  const saveHotwords = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingHotwords(true);
    setHotwordStatus('');

    try {
      const words = parseHotwords(hotwordText);
      await invoke('set_hotwords', { words });
      setHotwordText(words.join('\n'));
      setHotwordStatus(`已应用 ${words.length} 个热词`);
    } catch (error) {
      setHotwordStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSavingHotwords(false);
    }
  };

  const restoreDefaultHotwords = () => {
    setHotwordText(DEFAULT_HOTWORDS.join('\n'));
    setHotwordStatus('已填入默认热词，点击应用后才会注入');
  };

  const currentTranscriptResult = transcript ?? manualTranscript;
  const latestRecognizedText = (transcript?.cleaned || transcript?.raw || '').trim();
  const currentRefineSourceText = (currentTranscriptResult?.cleaned || currentTranscriptResult?.raw || '').trim();
  const canReuseLatestRecognizedText = Boolean(
    latestRecognizedText && !/^\d+ bytes PCM captured$/.test(latestRecognizedText),
  );
  const canRefineCurrentText = Boolean(
    currentRefineSourceText && !/^\d+ bytes PCM captured$/.test(currentRefineSourceText),
  );
  const workflowStage = getWorkflowStage({
    recordingState: state,
    refining,
    hasResult: Boolean(codexPrompt || refined || currentTranscriptResult),
    hasError: Boolean(errorMessage || refineError),
  });

  const submitManualRefinement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = manualRefineText.trim();
    if (!text) {
      return;
    }

    setPromptRegenerationNotice('');
    setManualTranscript({
      raw: text,
      cleaned: text,
      refined: '',
    });
    await refineTranscript(text);
  };

  const refineLatestRecognizedText = async () => {
    if (!canReuseLatestRecognizedText) {
      return;
    }

    setPromptRegenerationNotice('');
    setManualRefineText(latestRecognizedText);
    setManualTranscript({
      raw: latestRecognizedText,
      cleaned: latestRecognizedText,
      refined: '',
    });
    await refineTranscript(latestRecognizedText);
  };

  const refineCurrentText = async () => {
    if (!canRefineCurrentText) {
      return;
    }

    setPromptRegenerationNotice('');
    setManualTranscript({
      raw: currentRefineSourceText,
      cleaned: currentRefineSourceText,
      refined: '',
    });
    await refineTranscript(currentRefineSourceText);
    setPromptRegenerationNotice('已重新生成 Prompt');
  };

  const activeShortcutStatus =
    activeShortcut.source === 'mouse' ? mouseShortcutStatus : globalShortcutStatus;
  const activeShortcutError =
    activeShortcut.source === 'mouse' ? mouseShortcutError : globalShortcutError;
  const activeShortcutLabel = activeShortcut.triggerKeyName;
  const humanizedShortcutError = activeShortcutError ? humanizeStatusMessage(activeShortcutError) : '';

  const globalShortcutStatusText = globalShortcutEnabled
    ? activeShortcutStatus === 'registered'
      ? `已启用：${activeShortcutLabel}`
      : activeShortcutStatus === 'failed'
        ? `注册失败：${humanizedShortcutError}`
        : '注册中...'
    : '已关闭';

  const hasModernAsrKey = Boolean(asrKey.trim());
  const hasLegacyAsrKeys = Boolean(asrAppKey.trim() && asrAccessKey.trim());
  const hasAsrCredentials = hasModernAsrKey || hasLegacyAsrKeys;
  const hasAsrTarget = Boolean(asrEndpoint.trim() && asrResourceId.trim());
  const hasLlmKey = Boolean(llmKey.trim());
  const hasLlmTarget = Boolean(llmApiBase.trim() && llmModel.trim());
  const hasRequiredSettings = hasAsrCredentials && hasAsrTarget && hasLlmKey && hasLlmTarget;
  const hasBlockingSettingsIssue = !hasAsrCredentials || !hasAsrTarget || !hasLlmKey || !hasLlmTarget || activeShortcutStatus === 'failed';
  const settingsSummaryStatus = hasBlockingSettingsIssue
    ? !hasAsrCredentials
      ? '缺少 ASR'
      : !hasLlmKey
        ? '缺少 LLM'
        : activeShortcutStatus === 'failed'
          ? getShortcutIssueSummary(activeShortcutError, activeShortcut.source)
          : '需要检查'
    : hasRequiredSettings
      ? '配置完整'
      : '需要检查';
  const settingsSummaryStatusClass = hasBlockingSettingsIssue ? 'warn' : 'ok';
  const settingsIssueAction = getSettingsIssueAction(
    hasAsrCredentials && hasAsrTarget,
    hasLlmKey && hasLlmTarget,
    activeShortcutStatus === 'failed',
  );
  const settingsIssueTargetSection: SettingsSectionId = settingsIssueAction.section;
  const voiceSetupHint = !hasAsrCredentials || !hasAsrTarget
    ? '先完成豆包 ASR 配置，才能把语音识别成文字。'
    : !hasLlmKey || !hasLlmTarget
      ? '先完成精炼 LLM 配置，才能生成 Codex-ready Prompt。'
      : activeShortcutStatus === 'failed'
        ? `按住说话快捷键不可用：${humanizedShortcutError}`
        : '';
  const clipboardAvailable = Boolean(navigator.clipboard?.writeText);

  useEffect(() => {
    setDiagnosticRevision((revision) => revision + 1);
  }, [
    asrKey,
    asrAppKey,
    asrAccessKey,
    asrResourceId,
    asrEndpoint,
    llmKey,
    llmApiBase,
    llmModel,
    llmProtocol,
    llmProvider,
    globalShortcutEnabled,
    activeShortcut,
    activeShortcutStatus,
    humanizedShortcutError,
    persistPromptHistory,
    clipboardAvailable,
  ]);

  const diagnosticFreshness = getDiagnosticFreshness(
    diagnosticItems.length > 0,
    diagnosticSnapshotRevision,
    diagnosticRevision,
  );
  const diagnosticsStale = diagnosticFreshness === 'stale';

  const openSettingsPanelSection = useCallback((section: SettingsSectionId) => {
    const activeElement = document.activeElement;
    settingsTriggerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    setSettingsOpen(true);
    setOpenSettingsSection(section);
  }, []);

  const openCurrentSettingsIssue = useCallback(() => {
    openSettingsPanelSection(settingsIssueTargetSection);
  }, [openSettingsPanelSection, settingsIssueTargetSection]);

  const runDiagnostics = () => {
    const hasClipboard = clipboardAvailable;
    const shortcutSourceLabel = activeShortcut.source === 'mouse' ? '鼠标触发' : '键盘触发';
    const shortcutRuntimeText = !globalShortcutEnabled
      ? '已关闭'
      : activeShortcutStatus === 'registered'
        ? '已注册'
        : activeShortcutStatus === 'failed'
          ? `注册失败：${humanizedShortcutError}`
          : '注册中';
    const shortcutStatus: DiagnosticStatus = !globalShortcutEnabled
      ? 'warn'
      : activeShortcutStatus === 'registered'
        ? 'ok'
        : activeShortcutStatus === 'failed'
          ? 'error'
          : 'warn';
    const asrTargetDiagnostic = getAsrTargetDiagnostic(asrEndpoint, asrResourceId);
    const llmCompatibility = getLlmCompatibilityDiagnostic(llmApiBase, llmModel, llmProtocol);

    setDiagnosticItems([
      {
        label: 'ASR 凭证',
        status: hasAsrCredentials ? 'ok' : 'error',
        detail: hasModernAsrKey
          ? '新版 API Key 已填写'
          : hasLegacyAsrKeys
            ? '旧版 App Key / Access Key 已填写'
            : '未填写豆包 ASR 凭证',
        suggestion: hasAsrCredentials ? '' : '打开豆包 ASR 小节，至少填写新版 API Key；如果仍使用旧版方案，再补 App Key / Access Key。',
      },
      {
        label: 'ASR 地址',
        status: asrTargetDiagnostic.status,
        detail: asrTargetDiagnostic.detail,
        suggestion: asrTargetDiagnostic.suggestion,
      },
      {
        label: 'LLM 凭证',
        status: hasLlmKey ? 'ok' : 'error',
        detail: hasLlmKey ? `${llmProvider} API Key 已填写` : '未填写 LLM API Key',
        suggestion: hasLlmKey ? '' : '打开精炼 LLM 小节，填写当前提供商的 API Key，然后重新运行诊断。',
      },
      {
        label: 'LLM 模型',
        status: hasLlmTarget ? 'ok' : 'error',
        detail: `${llmModel.trim() || 'Model 缺失'} · ${PROTOCOL_LABELS[llmProtocol]}`,
        suggestion: hasLlmTarget ? '' : '先把 API Base、Model 和协议补全，再运行一次诊断确认。',
      },
      {
        label: 'LLM 匹配',
        status: hasLlmTarget ? llmCompatibility.status : 'warn',
        detail: hasLlmTarget ? llmCompatibility.detail : '等待填写完整的 API Base 和 Model',
        suggestion: hasLlmTarget ? getLlmCompatibilitySuggestion(llmCompatibility.detail) : '先填完整 LLM 配置，再检查是否需要切回提供商预设。',
      },
      {
        label: '全局快捷键',
        status: shortcutStatus,
        detail: `${shortcutSourceLabel} · ${activeShortcut.triggerKeyName} · ${shortcutRuntimeText}`,
        suggestion: shortcutStatus === 'ok' || !globalShortcutEnabled
          ? ''
          : getShortcutDiagnosticSuggestion(activeShortcut.source, humanizedShortcutError),
      },
      {
        label: 'Prompt 历史',
        status: 'ok',
        detail: persistPromptHistory ? '保存到本机，最多保留 5 条' : '仅保留本次会话，不写入本机历史',
      },
      {
        label: '剪贴板',
        status: hasClipboard ? 'ok' : 'warn',
        detail: hasClipboard ? '剪贴板 API 可用' : '剪贴板 API 不可用或需要授权',
        suggestion: hasClipboard ? '' : '即使自动复制不可用，也可以先生成 Prompt，再用面板里的手动复制兜底。',
      },
    ]);
    setDiagnosticStatus(`诊断完成：${new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })}`);
    setDiagnosticSnapshotRevision(diagnosticRevision);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark">
            <span>VH</span>
            <i />
          </div>
          <div className="brand-copy">
            <div className="app-kicker">CODEX VOICE COMMAND CONSOLE</div>
            <h1 className="app-title">语枢 VoiceHub</h1>
            <p className="app-subtitle">把中文语音整理成可以直接交给 Codex 的开发 Prompt。</p>
          </div>
        </div>
        <div className="header-status">
          <span className={`system-status-dot system-status-${settingsSummaryStatusClass}`} />
          <div>
            <strong>{settingsSummaryStatus}</strong>
            <small>{activeShortcutStatus === 'registered' ? activeShortcutLabel : '屏幕按钮可用'}</small>
          </div>
          <button
            ref={settingsButtonRef}
            type="button"
            className="header-icon-button"
            onClick={openCurrentSettingsIssue}
            aria-label="打开配置"
            title="配置与诊断"
          >
            <UiIcon name="settings" />
          </button>
        </div>
      </header>

      <div className="workspace-grid">
        <main className="main-column">
          <section className="voice-area">
            <div className="voice-orbit-art" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="voice-meta">
              <div className="voice-status-pill">
                <span className={`system-status-dot system-status-${settingsSummaryStatusClass}`} />
                {settingsSummaryStatus}
              </div>
              <p className="voice-title">按住说话，<br />松开生成 Prompt</p>
              <p className="voice-hint">从语音到可执行开发指令，录音、识别、精炼、复制在一条链路中完成。</p>
              {hasBlockingSettingsIssue && voiceSetupHint && (
                <div className="voice-setup-hint">
                  <span>{voiceSetupHint}</span>
                  <button type="button" className="secondary-button" onClick={openCurrentSettingsIssue}>
                    {settingsIssueAction.label}
                  </button>
                </div>
              )}
              <div className="voice-options">
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={autoCopy}
                    onChange={(event) => setAutoCopy(event.target.checked)}
                  />
                  <span className="switch-track"><span /></span>
                  <span className="switch-label">
                    <UiIcon name="clipboard" size={16} />
                    精炼后自动复制
                  </span>
                </label>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={persistPromptHistory}
                    onChange={(event) => setPromptHistoryPersistence(event.target.checked)}
                  />
                  <span className="switch-track"><span /></span>
                  <span className="switch-label">
                    <UiIcon name="history" size={16} />
                    保存最近 Prompt
                  </span>
                </label>
              </div>
            </div>
            <VoiceButton
              state={state}
              workflowStage={workflowStage}
              audioLevel={audioLevel}
              onPressStart={startRecording}
              onPressEnd={stopRecording}
            />
          </section>

          <div className="result-area">
            <TranscriptPanel
              result={currentTranscriptResult}
              workflowStage={workflowStage}
              recordingState={state}
              livePreviewText={livePreviewText}
              errorMessage={errorMessage}
              cleanedText={cleanedText}
              refined={refined}
              refining={refining}
              codexPrompt={codexPrompt}
              lastCodexPrompt={lastCodexPrompt}
              promptHistory={promptHistory}
              autoCopy={autoCopy}
              autoCopyStatus={autoCopyStatus}
              refineError={refineError}
              regenerationNotice={promptRegenerationNotice}
              canRefineCurrentText={canRefineCurrentText}
              onRefineCurrentText={refineCurrentText}
              onReusePrompt={reusePromptFromHistory}
              onClearPromptHistory={clearPromptHistory}
              onClearDisplayedPrompt={clearDisplayedPrompt}
            />
          </div>
        </main>

        {settingsOpen && (
          <>
            <button
              type="button"
              className="drawer-backdrop"
              onClick={() => setSettingsOpen(false)}
              aria-label="关闭配置抽屉"
            />
            <aside
              ref={settingsDialogRef}
              className="side-rail"
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-drawer-title"
              tabIndex={-1}
            >
              <div className="drawer-header">
                <div>
                  <span className="section-kicker">CONTROL DECK</span>
                  <h2 id="settings-drawer-title">配置与诊断</h2>
                </div>
                <button
                  ref={settingsCloseButtonRef}
                  type="button"
                  className="header-icon-button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="关闭配置抽屉"
                >
                  <UiIcon name="close" />
                </button>
              </div>
          <section className="settings-panel">
            <div className="settings-summary">
              <span>系统控制台</span>
              <span
                className={`settings-status settings-status-${settingsSummaryStatusClass}`}
              >
                {settingsSummaryStatus}
              </span>
            </div>
            <div className="settings-content">
              <details
                className="settings-section"
                open={openSettingsSection === 'diagnostics'}
                onToggle={(event) => toggleSettingsSection('diagnostics', event.currentTarget.open)}
              >
                <summary className="settings-section-summary">系统诊断</summary>
                <section className="diagnostics-panel">
                  <div className="diagnostics-header">
                    <div>
                      <div className="diagnostics-title">系统诊断</div>
                      {diagnosticStatus && (
                        <div className={`diagnostics-status${diagnosticsStale ? ' diagnostics-status-stale' : ''}`}>
                          {diagnosticsStale ? `${diagnosticStatus} · 配置已修改` : diagnosticStatus}
                        </div>
                      )}
                    </div>
                    <button type="button" onClick={runDiagnostics} className="secondary-button">
                      {diagnosticsStale ? '重新运行诊断' : '运行诊断'}
                    </button>
                  </div>
                  <div className="health-card-grid">
                    <button type="button" onClick={() => setOpenSettingsSection('asr')} className="health-card">
                      <span className={`diagnostic-dot diagnostic-dot-${hasAsrCredentials && hasAsrTarget ? 'ok' : 'error'}`} />
                      <UiIcon name="mic" />
                      <strong>ASR</strong>
                      <small>{hasAsrCredentials && hasAsrTarget ? '正常' : '待配置'}</small>
                    </button>
                    <button type="button" onClick={() => setOpenSettingsSection('llm')} className="health-card">
                      <span className={`diagnostic-dot diagnostic-dot-${hasLlmKey && hasLlmTarget ? 'ok' : 'error'}`} />
                      <UiIcon name="terminal" />
                      <strong>LLM</strong>
                      <small>{hasLlmKey && hasLlmTarget ? '正常' : '待配置'}</small>
                    </button>
                    <button type="button" onClick={() => setOpenSettingsSection('shortcut')} className="health-card">
                      <span className={`diagnostic-dot diagnostic-dot-${activeShortcutStatus === 'failed' ? 'error' : 'ok'}`} />
                      <UiIcon name="activity" />
                      <strong>快捷键</strong>
                      <small>{activeShortcutStatus === 'failed' ? '异常' : '可使用'}</small>
                    </button>
                    <button type="button" onClick={runDiagnostics} className="health-card">
                      <span className={`diagnostic-dot diagnostic-dot-${clipboardAvailable ? 'ok' : 'warn'}`} />
                      <UiIcon name="clipboard" />
                      <strong>剪贴板</strong>
                      <small>{clipboardAvailable ? '正常' : '需授权'}</small>
                    </button>
                  </div>
                  {diagnosticsStale && (
                    <div className="diagnostics-stale-notice">
                      下面是上一次诊断结果。配置已经变更，请重新运行诊断后再按结果处理。
                    </div>
                  )}
                  {diagnosticItems.length > 0 && (
                    <div className="diagnostics-grid">
                      {diagnosticItems.map((item) => (
                        <div key={item.label} className="diagnostic-row">
                          <span className={`diagnostic-dot diagnostic-dot-${item.status}`} />
                          <div>
                            <div className="diagnostic-label">{item.label}</div>
                            <div className="diagnostic-detail">{item.detail}</div>
                            {item.suggestion && <div className="diagnostic-suggestion">建议：{item.suggestion}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <details className="diagnostic-test-plan">
                    <summary>推荐测试步骤</summary>
                    <ol>
                      <li>点击运行诊断，确认 ASR、LLM、快捷键没有红色项。</li>
                      <li>按住说话，确认出现实时识别文字。</li>
                      <li>松开后确认生成可复制给 Codex 的 Prompt。</li>
                      <li>编辑 Prompt 后点击复制，确认粘贴的是当前编辑后的文本。</li>
                    </ol>
                  </details>
                </section>
              </details>

              <details
                className="settings-section"
                open={openSettingsSection === 'shortcut'}
                onToggle={(event) => toggleSettingsSection('shortcut', event.currentTarget.open)}
              >
                <summary className="settings-section-summary">按住说话快捷键</summary>
                <form className="settings-form" onSubmit={(event) => event.preventDefault()}>
                  <label className="field-label" htmlFor="global-shortcut">
                    全局长按快捷键
                  </label>
                  <div className="form-hint">点击输入框后，按键盘键或鼠标侧键完成设置。</div>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={globalShortcutEnabled}
                      onChange={(event) => updateGlobalShortcutEnabled(event.target.checked)}
                    />
                    启用全局长按快捷键
                  </label>
                  <div className="shortcut-row">
                    <input
                      id="global-shortcut"
                      type="text"
                      readOnly
                      value={isCapturingShortcut ? shortcutCaptureValue : activeShortcut.triggerKeyName}
                      onFocus={() => {
                        clearCaptureResetTimer();
                        setIsCapturingShortcut(true);
                        setShortcutCaptureValue(CAPTURE_PROMPT);
                        setShortcutCaptureHint('等待按键...');
                      }}
                      placeholder="点击设置触发键"
                      className={`field-input shortcut-input ${isCapturingShortcut ? 'shortcut-input-capturing' : ''}`}
                    />
                    <button type="button" onClick={restoreDefaultTriggerKey} className="secondary-button">
                      恢复默认
                    </button>
                  </div>
                  <div className={`shortcut-status ${activeShortcutStatus === 'failed' ? 'shortcut-status-error' : ''}`}>
                    {globalShortcutStatusText}
                  </div>
                  {shortcutCaptureHint && <div className="form-hint">{shortcutCaptureHint}</div>}
                </form>
              </details>

              <details
                className="settings-section"
                open={openSettingsSection === 'asr'}
                onToggle={(event) => toggleSettingsSection('asr', event.currentTarget.open)}
              >
                <summary className="settings-section-summary">豆包 ASR</summary>
                <form className="settings-form" onSubmit={saveAsrKey}>
                  <div className="field-grid">
                    <div className="secret-field">
                      <input
                        type={showAsrSecret ? 'text' : 'password'}
                        value={asrKey}
                        onChange={(event) => setAsrKey(event.target.value)}
                        placeholder="新版 API Key"
                        className="field-input"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAsrSecret((visible) => !visible)}
                        aria-label={showAsrSecret ? '隐藏 ASR API Key' : '显示 ASR API Key'}
                      >
                        <UiIcon name={showAsrSecret ? 'preview' : 'key'} size={15} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={asrEndpoint}
                      onChange={(event) => setAsrEndpoint(event.target.value)}
                      placeholder="Endpoint"
                      className="field-input"
                    />
                    <input
                      type="text"
                      value={asrResourceId}
                      onChange={(event) => setAsrResourceId(event.target.value)}
                      placeholder="Resource ID"
                      className="field-input field-input-full"
                    />
                  </div>
                  <details className="nested-details">
                    <summary>旧版豆包密钥（通常不需要）</summary>
                    <div className="field-grid nested-field-grid">
                      <div className="secret-field">
                        <input
                          type={showLegacySecrets ? 'text' : 'password'}
                          value={asrAppKey}
                          onChange={(event) => setAsrAppKey(event.target.value)}
                          placeholder="旧版 App Key"
                          className="field-input"
                        />
                        <button
                          type="button"
                          onClick={() => setShowLegacySecrets((visible) => !visible)}
                          aria-label={showLegacySecrets ? '隐藏旧版密钥' : '显示旧版密钥'}
                        >
                          <UiIcon name={showLegacySecrets ? 'preview' : 'key'} size={15} />
                        </button>
                      </div>
                      <input
                        type={showLegacySecrets ? 'text' : 'password'}
                        value={asrAccessKey}
                        onChange={(event) => setAsrAccessKey(event.target.value)}
                        placeholder="旧版 Access Key / Token"
                        className="field-input"
                      />
                    </div>
                  </details>
                  <div className="form-actions">
                    <button
                      type="submit"
                      disabled={isSavingAsrKey || isClearingAsrConfig}
                      className="primary-button"
                    >
                      {isSavingAsrKey ? '应用中' : '应用 ASR 配置'}
                    </button>
                    <button
                      type="button"
                      onClick={clearSavedAsrConfig}
                      disabled={isSavingAsrKey || isClearingAsrConfig}
                      className="secondary-button"
                    >
                      {isClearingAsrConfig ? '清除中' : '清除保存'}
                    </button>
                  </div>
                  {asrKeyStatus && <div className="form-status">{humanizeStatusMessage(asrKeyStatus)}</div>}
                </form>
              </details>

              <details
                className="settings-section"
                open={openSettingsSection === 'llm'}
                onToggle={(event) => toggleSettingsSection('llm', event.currentTarget.open)}
              >
                <summary className="settings-section-summary">精炼 LLM</summary>
                <form className="settings-form" onSubmit={saveLlmConfig}>
                  <label className="field-label" htmlFor="llm-key">
                    精炼 LLM 配置
                  </label>
                  <div className="form-hint">API Key 保存到 macOS Keychain；Model 和 API Base 保存到本地配置。</div>
                  <div className="field-grid">
                    <select
                      value={llmPresetId}
                      onChange={(event) => selectLlmPreset(event.target.value)}
                      className="field-input field-input-full"
                    >
                      <option value={CUSTOM_LLM_PRESET_ID}>自定义 OpenAI-compatible</option>
                      <optgroup label="OpenAI">
                        {LLM_PRESETS.filter((preset) => preset.provider === 'OpenAI').map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="国内常用">
                        {LLM_PRESETS.filter((preset) => ['DeepSeek', 'Kimi / Moonshot', 'Qwen / DashScope', '智谱 GLM'].includes(preset.provider)).map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="海外常用">
                        {LLM_PRESETS.filter((preset) => ['Google Gemini', 'Anthropic Claude'].includes(preset.provider)).map((preset) => (
                          <option key={preset.id} value={preset.id}>{preset.label}</option>
                        ))}
                      </optgroup>
                    </select>
                    <div className="secret-field">
                      <input
                        id="llm-key"
                        type={showLlmSecret ? 'text' : 'password'}
                        value={llmKey}
                        onChange={(event) => setLlmKey(event.target.value)}
                        placeholder={`请输入 ${llmProvider} API Key`}
                        className="field-input"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLlmSecret((visible) => !visible)}
                        aria-label={showLlmSecret ? '隐藏 LLM API Key' : '显示 LLM API Key'}
                      >
                        <UiIcon name={showLlmSecret ? 'preview' : 'key'} size={15} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={llmModel}
                      onChange={(event) => editLlmModel(event.target.value)}
                      placeholder="Model，例如 deepseek-v4-flash"
                      className="field-input"
                    />
                    <select
                      value={llmProtocol}
                      onChange={(event) => editLlmProtocol(event.target.value as LlmProtocol)}
                      className="field-input"
                    >
                      {Object.entries(PROTOCOL_LABELS).map(([protocol, label]) => (
                        <option key={protocol} value={protocol}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={llmApiBase}
                      onChange={(event) => editLlmApiBase(event.target.value)}
                      placeholder="API Base，例如 https://api.deepseek.com/v1"
                      className="field-input field-input-full"
                    />
                  </div>
                  <div className="form-actions">
                    <button
                      type="submit"
                      disabled={isSavingLlmConfig || isClearingLlmConfig}
                      className="primary-button"
                    >
                      {isSavingLlmConfig ? '应用中' : '应用 LLM 配置'}
                    </button>
                    <button
                      type="button"
                      onClick={clearSavedLlmConfig}
                      disabled={isSavingLlmConfig || isClearingLlmConfig}
                      className="secondary-button"
                    >
                      {isClearingLlmConfig ? '清除中' : '清除保存'}
                    </button>
                  </div>
                  {llmStatus && <div className="form-status">{humanizeStatusMessage(llmStatus)}</div>}
                </form>
              </details>

              <details
                className="settings-section"
                open={openSettingsSection === 'hotwords'}
                onToggle={(event) => toggleSettingsSection('hotwords', event.currentTarget.open)}
              >
                <summary className="settings-section-summary">开发热词</summary>
                <form className="settings-form" onSubmit={saveHotwords}>
                  <label className="field-label" htmlFor="hotwords">
                    开发热词
                  </label>
                  <div className="form-hint">默认不注入热词，避免影响豆包 ASR；需要测试热词时再手动应用。</div>
                  <textarea
                    id="hotwords"
                    value={hotwordText}
                    onChange={(event) => setHotwordText(event.target.value)}
                    rows={5}
                    className="field-input field-textarea hotwords-textarea"
                  />
                  <div className="form-actions">
                    <button type="submit" disabled={isSavingHotwords} className="primary-button">
                      {isSavingHotwords ? '应用中' : '应用热词'}
                    </button>
                    <button type="button" onClick={restoreDefaultHotwords} className="secondary-button">
                      恢复默认
                    </button>
                  </div>
                  {hotwordStatus && <div className="form-status">{hotwordStatus}</div>}
                </form>
              </details>

              <details className="settings-section">
                <summary className="settings-section-summary">调试工具</summary>
                <form className="manual-refine-form" onSubmit={submitManualRefinement}>
                  <textarea
                    value={manualRefineText}
                    onChange={(event) => setManualRefineText(event.target.value)}
                    rows={3}
                    placeholder="输入一句中文开发指令，例如：帮我把复制按钮文案改清楚"
                    className="field-input field-textarea manual-refine-textarea"
                  />
                  <div className="manual-refine-actions">
                    <button
                      type="submit"
                      disabled={refining || !manualRefineText.trim()}
                      className="primary-button"
                    >
                      {refining ? '精炼中' : '精炼文本'}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={refining || !canReuseLatestRecognizedText}
                      onClick={refineLatestRecognizedText}
                    >
                      使用最近识别文本
                    </button>
                  </div>
                </form>
              </details>
            </div>
          </section>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
