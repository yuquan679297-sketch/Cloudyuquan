import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { useEffect, useRef, useState } from 'react';

export type GlobalShortcutStatus = 'idle' | 'registered' | 'disabled' | 'failed';

interface UseGlobalShortcutOptions {
  enabled: boolean;
  shortcut: string;
  onPressed: () => void;
  onReleased: () => void;
}

export function normalizeShortcut(value: string) {
  return value
    .split('+')
    .map((part) => normalizeShortcutPart(part.trim()))
    .filter(Boolean)
    .join('+');
}

function normalizeShortcutPart(part: string) {
  const lower = part.toLowerCase();

  if (lower === 'option' || lower === 'alt') return 'Alt';
  if (lower === 'cmd' || lower === 'command' || lower === 'meta') return 'Command';
  if (lower === 'cmdorctrl' || lower === 'cmdorcontrol' || lower === 'commandorcontrol') {
    return 'CommandOrControl';
  }
  if (lower === 'ctrl' || lower === 'control') return 'Control';
  if (lower === 'shift') return 'Shift';
  if (lower === 'space') return 'Space';
  if (lower === 'return' || lower === 'enter') return 'Enter';
  if (lower === 'esc' || lower === 'escape') return 'Escape';
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();

  return part.length === 1 ? part.toUpperCase() : part;
}

export function useGlobalShortcut({
  enabled,
  shortcut,
  onPressed,
  onReleased,
}: UseGlobalShortcutOptions) {
  const [status, setStatus] = useState<GlobalShortcutStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const onPressedRef = useRef(onPressed);
  const onReleasedRef = useRef(onReleased);
  const activeRef = useRef(false);

  useEffect(() => {
    onPressedRef.current = onPressed;
  }, [onPressed]);

  useEffect(() => {
    onReleasedRef.current = onReleased;
  }, [onReleased]);

  useEffect(() => {
    const normalizedShortcut = normalizeShortcut(shortcut);
    let cancelled = false;

    if (!enabled) {
      activeRef.current = false;
      setStatus('disabled');
      setErrorMessage('');
      return undefined;
    }

    if (!normalizedShortcut) {
      setStatus('failed');
      setErrorMessage('快捷键不能为空');
      return undefined;
    }

    const registerShortcut = async () => {
      try {
        await unregister(normalizedShortcut).catch(() => undefined);
        await register(normalizedShortcut, (event) => {
          if (event.state === 'Pressed') {
            if (activeRef.current) {
              return;
            }
            activeRef.current = true;
            onPressedRef.current();
            return;
          }

          if (!activeRef.current) {
            return;
          }
          activeRef.current = false;
          onReleasedRef.current();
        });

        if (!cancelled) {
          setStatus('registered');
          setErrorMessage('');
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('failed');
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void registerShortcut();

    return () => {
      cancelled = true;
      activeRef.current = false;
      void unregister(normalizedShortcut).catch(() => undefined);
    };
  }, [enabled, shortcut]);

  return {
    normalizedShortcut: normalizeShortcut(shortcut),
    status,
    errorMessage,
  };
}
