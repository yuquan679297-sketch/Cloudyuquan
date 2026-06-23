// VoiceButton — Walky-Talky style mic button.
// Press and hold to record, release to submit.
// Shows pulsing animation while recording.

import { CSSProperties, PointerEvent, useRef } from 'react';
import { RecordingState } from '../types';
import type { WorkflowStage } from '../uiWorkflow';
import { UiIcon } from './UiIcon';

interface Props {
  state: RecordingState;
  workflowStage: WorkflowStage;
  audioLevel: number;
  onPressStart: () => void;
  onPressEnd: () => void;
}

const STAGE_COPY: Record<WorkflowStage, { label: string; helper: string }> = {
  idle: { label: '按住说话', helper: '释放后自动识别并精炼' },
  recording: { label: '正在聆听', helper: '松开结束录音' },
  recognizing: { label: '正在识别', helper: '解析实时语音内容' },
  refining: { label: '正在精炼', helper: '整理成 Codex-ready Prompt' },
  complete: { label: '生成完成', helper: '检查结果后即可复制' },
  error: { label: '需要检查', helper: '打开诊断查看解决建议' },
};

export function VoiceButton({
  state,
  workflowStage,
  audioLevel,
  onPressStart,
  onPressEnd,
}: Props) {
  const isRecording = state === 'recording';
  const isProcessing = state === 'processing';
  const activePointerIdRef = useRef<number | null>(null);
  const stageCopy = STAGE_COPY[workflowStage];
  const normalizedLevel = Math.max(0, Math.min(1, audioLevel));
  const ringStyle = {
    '--audio-arc': `${normalizedLevel * 300}deg`,
    '--audio-glow': `${8 + normalizedLevel * 16}px`,
    '--audio-scale': 1 + normalizedLevel * 0.035,
    '--bar-scale': 0.65 + normalizedLevel * 1.5,
  } as CSSProperties;

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (isProcessing || activePointerIdRef.current !== null) {
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    onPressStart();
  };

  const handlePointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    activePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    event.preventDefault();
    onPressEnd();
  };

  return (
    <div className={`voice-control voice-control-${state}`} style={ringStyle}>
      <button
        type="button"
        className="voice-button"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        disabled={isProcessing}
        aria-label={isRecording ? '正在录音，松开结束' : isProcessing ? '正在生成 Prompt' : '按住说话'}
      >
        <span className="voice-button-orbit voice-button-orbit-outer" aria-hidden="true" />
        <span className="voice-button-orbit voice-button-orbit-inner" aria-hidden="true" />
        <span className="voice-button-level" aria-hidden="true" />
        <span className="voice-button-glyph" aria-hidden="true">
          {isProcessing ? (
            <span className="voice-spinner" />
          ) : (
            <UiIcon name="mic" size={34} />
          )}
        </span>
      </button>
      <div className="voice-button-status">
        <span>{stageCopy.label}</span>
        <small>{stageCopy.helper}</small>
      </div>
      <div className="voice-level-bars" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
    </div>
  );
}
