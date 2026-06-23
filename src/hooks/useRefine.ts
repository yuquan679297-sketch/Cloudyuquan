// useRefine — runs the W-05 transcript refinement pipeline and tracks its events.

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredBoolean, getStoredString, removeStoredValue, setStoredString } from '../browserStorage.js';
import { PromptHistoryItem, RefinedInstruction } from '../types';

export type AutoCopyStatus = 'idle' | 'copied' | 'failed';

const PROMPT_HISTORY_LIMIT = 5;
const PROMPT_HISTORY_STORAGE_KEY = 'voicehub.promptHistory.v1';
const PROMPT_HISTORY_PERSISTENCE_KEY = 'voicehub.promptHistory.persist.v1';

function hasInstructionContent(instruction: RefinedInstruction) {
  return [
    instruction.goal,
    instruction.context,
    instruction.constraints,
    instruction.done_when,
  ].some((value) => value.trim());
}

function canUseCodexPrompt(instruction: RefinedInstruction) {
  return !(instruction.intent === 'Unknown' && instruction.confidence < 0.6 && !hasInstructionContent(instruction));
}

function loadPromptHistoryPersistence() {
  return getStoredBoolean(PROMPT_HISTORY_PERSISTENCE_KEY, false);
}

function isPromptHistoryItem(value: unknown): value is PromptHistoryItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<PromptHistoryItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.prompt === 'string' &&
    typeof item.intent === 'string' &&
    typeof item.createdAt === 'number' &&
    (item.preview === undefined || typeof item.preview === 'string')
  );
}

function loadPersistedPromptHistory() {
  const storedValue = getStoredString(PROMPT_HISTORY_STORAGE_KEY);
  if (!storedValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(storedValue) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isPromptHistoryItem).slice(0, PROMPT_HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function savePromptHistoryPreference(enabled: boolean) {
  setStoredString(PROMPT_HISTORY_PERSISTENCE_KEY, enabled ? 'true' : 'false');
}

function savePersistedPromptHistory(history: PromptHistoryItem[]) {
  setStoredString(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, PROMPT_HISTORY_LIMIT)));
}

function clearPersistedPromptHistory() {
  removeStoredValue(PROMPT_HISTORY_STORAGE_KEY);
}

export function useRefine() {
  const initialPersistPromptHistory = loadPromptHistoryPersistence();
  const [cleanedText, setCleanedText] = useState('');
  const [refined, setRefined] = useState<RefinedInstruction | null>(null);
  const [refining, setRefining] = useState(false);
  const [codexPrompt, setCodexPrompt] = useState('');
  const [lastCodexPrompt, setLastCodexPrompt] = useState('');
  const [promptHistory, setPromptHistory] = useState<PromptHistoryItem[]>(
    initialPersistPromptHistory ? loadPersistedPromptHistory : [],
  );
  const [persistPromptHistory, setPersistPromptHistory] = useState(initialPersistPromptHistory);
  const [autoCopy, setAutoCopy] = useState(false);
  const [autoCopyStatus, setAutoCopyStatus] = useState<AutoCopyStatus>('idle');
  const [refineError, setRefineError] = useState<string | null>(null);
  const autoCopyRef = useRef(false);

  useEffect(() => {
    autoCopyRef.current = autoCopy;
    if (!autoCopy) {
      setAutoCopyStatus('idle');
    }
  }, [autoCopy]);

  useEffect(() => {
    savePromptHistoryPreference(persistPromptHistory);
    if (persistPromptHistory) {
      savePersistedPromptHistory(promptHistory);
    } else {
      clearPersistedPromptHistory();
    }
  }, [persistPromptHistory, promptHistory]);

  useEffect(() => {
    let fastUnlisten: UnlistenFn | null = null;
    let preciseUnlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<string>('refine://fast-done', (event) => {
      setCleanedText(event.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        fastUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setRefineError(error instanceof Error ? error.message : 'Failed to listen for fast refine events');
    });

    listen<RefinedInstruction>('refine://precise-done', async (event) => {
      setRefined(event.payload);
      setRefining(false);
      setRefineError(null);
      try {
        const prompt = await invoke<string>('get_codex_prompt', {
          instruction: event.payload,
        });
        const usablePrompt = canUseCodexPrompt(event.payload) ? prompt : '';
        setCodexPrompt(usablePrompt);
        if (usablePrompt) {
          setLastCodexPrompt(usablePrompt);
          setPromptHistory((history) => {
            const existing = history.find((item) => item.prompt === usablePrompt);
            const preview = event.payload.goal.trim() || event.payload.cleaned_input.trim();
            const nextItem = existing
              ? { ...existing, preview, intent: event.payload.intent, createdAt: Date.now() }
              : {
                  id: `${Date.now()}`,
                  prompt: usablePrompt,
                  preview,
                  intent: event.payload.intent,
                  createdAt: Date.now(),
                };

            return [
              nextItem,
              ...history.filter((item) => item.prompt !== usablePrompt),
            ].slice(0, PROMPT_HISTORY_LIMIT);
          });
          if (autoCopyRef.current) {
            navigator.clipboard
              .writeText(usablePrompt)
              .then(() => setAutoCopyStatus('copied'))
              .catch(() => setAutoCopyStatus('failed'));
          }
        }
      } catch (error) {
        setRefineError(error instanceof Error ? error.message : String(error));
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        preciseUnlisten = unlisten;
      }
    }).catch((error: unknown) => {
      setRefineError(error instanceof Error ? error.message : 'Failed to listen for precise refine events');
    });

    return () => {
      cancelled = true;
      fastUnlisten?.();
      preciseUnlisten?.();
    };
  }, []);

  const refineTranscript = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text) {
      return;
    }

    setRefining(true);
    setCleanedText('');
    setRefined(null);
    setCodexPrompt('');
    setAutoCopyStatus('idle');
    setRefineError(null);

    try {
      await invoke<RefinedInstruction>('refine_transcript', { rawText: text });
    } catch (error) {
      setRefining(false);
      setRefineError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const clearCurrentRefinement = useCallback(() => {
    setCleanedText('');
    setRefined(null);
    setCodexPrompt('');
    setAutoCopyStatus('idle');
    setRefineError(null);
  }, []);

  const reusePromptFromHistory = useCallback((prompt: string) => {
    if (!prompt) {
      return;
    }

    setCodexPrompt(prompt);
    setLastCodexPrompt(prompt);
    setAutoCopyStatus('idle');
  }, []);

  const clearPromptHistory = useCallback(() => {
    setPromptHistory([]);
  }, []);

  const setPromptHistoryPersistence = useCallback((enabled: boolean) => {
    setPersistPromptHistory(enabled);
  }, []);

  const clearDisplayedPrompt = useCallback(() => {
    setCodexPrompt('');
    setLastCodexPrompt('');
    setAutoCopyStatus('idle');
  }, []);

  return {
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
  };
}
