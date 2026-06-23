import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef, useState } from 'react';

export type MouseShortcutStatus = 'idle' | 'registered' | 'disabled' | 'failed';

interface MouseShortcutPayload {
  button: number;
}

interface UseMouseShortcutOptions {
  enabled: boolean;
  button: number | null;
  onPressed: () => void;
  onReleased: () => void;
}

export function useMouseShortcut({
  enabled,
  button,
  onPressed,
  onReleased,
}: UseMouseShortcutOptions) {
  const [status, setStatus] = useState<MouseShortcutStatus>('idle');
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
    let cancelled = false;
    let pressedUnlisten: UnlistenFn | null = null;
    let releasedUnlisten: UnlistenFn | null = null;

    const disableMouseShortcut = async () => {
      activeRef.current = false;
      await invoke('set_mouse_shortcut_button', { button: null }).catch(() => undefined);
    };

    if (!enabled || button === null) {
      setStatus('disabled');
      setErrorMessage('');
      void disableMouseShortcut();
      return undefined;
    }

    if (button <= 2) {
      setStatus('failed');
      setErrorMessage('鼠标启动键只支持侧键或其他按键');
      void disableMouseShortcut();
      return undefined;
    }

    const registerMouseShortcut = async () => {
      try {
        pressedUnlisten = await listen<MouseShortcutPayload>('mouse-shortcut-pressed', (event) => {
          if (event.payload.button !== button || activeRef.current) {
            return;
          }
          activeRef.current = true;
          onPressedRef.current();
        });
        if (cancelled) {
          pressedUnlisten();
          return;
        }

        releasedUnlisten = await listen<MouseShortcutPayload>('mouse-shortcut-released', (event) => {
          if (event.payload.button !== button || !activeRef.current) {
            return;
          }
          activeRef.current = false;
          onReleasedRef.current();
        });
        if (cancelled) {
          pressedUnlisten?.();
          releasedUnlisten();
          return;
        }

        await invoke('set_mouse_shortcut_button', { button });
        if (cancelled) {
          void disableMouseShortcut();
          return;
        }

        setStatus('registered');
        setErrorMessage('');
      } catch (error) {
        pressedUnlisten?.();
        releasedUnlisten?.();
        void disableMouseShortcut();

        if (!cancelled) {
          setStatus('failed');
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      }
    };

    void registerMouseShortcut();

    return () => {
      cancelled = true;
      activeRef.current = false;
      pressedUnlisten?.();
      releasedUnlisten?.();
      void disableMouseShortcut();
    };
  }, [enabled, button]);

  return {
    status,
    errorMessage,
  };
}
