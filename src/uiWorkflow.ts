import type { RecordingState } from './types';

export type WorkflowStage =
  | 'idle'
  | 'recording'
  | 'recognizing'
  | 'refining'
  | 'complete'
  | 'error';

export type SettingsIssueSection = 'asr' | 'llm' | 'shortcut' | 'diagnostics';
export type DiagnosticFreshness = 'empty' | 'fresh' | 'stale';

interface WorkflowStageInput {
  recordingState: RecordingState;
  refining: boolean;
  hasResult: boolean;
  hasError: boolean;
}

export function getWorkflowStage({
  recordingState,
  refining,
  hasResult,
  hasError,
}: WorkflowStageInput): WorkflowStage {
  if (hasError || recordingState === 'error') {
    return 'error';
  }

  if (recordingState === 'recording') {
    return 'recording';
  }

  if (refining) {
    return 'refining';
  }

  if (recordingState === 'processing') {
    return 'recognizing';
  }

  if (hasResult || recordingState === 'done') {
    return 'complete';
  }

  return 'idle';
}

export function normalizeAudioRms(rms: number) {
  if (!Number.isFinite(rms) || rms <= 0.015) {
    return 0;
  }

  return Math.min(1, Math.max(0, (rms - 0.015) / 0.22));
}

export function getSettingsIssueAction(
  hasAsrSettings: boolean,
  hasLlmSettings: boolean,
  shortcutFailed: boolean,
): { section: SettingsIssueSection; label: string } {
  if (!hasAsrSettings) {
    return { section: 'asr', label: '配置 ASR' };
  }

  if (!hasLlmSettings) {
    return { section: 'llm', label: '配置 LLM' };
  }

  if (shortcutFailed) {
    return { section: 'shortcut', label: '修复快捷键' };
  }

  return { section: 'diagnostics', label: '查看诊断' };
}

export function getDiagnosticFreshness(
  hasDiagnosticResults: boolean,
  snapshotRevision: number,
  currentRevision: number,
): DiagnosticFreshness {
  if (!hasDiagnosticResults) {
    return 'empty';
  }

  return snapshotRevision === currentRevision ? 'fresh' : 'stale';
}

export function getNextSettingsSection<TSection extends string>(
  currentSection: TSection,
  toggledSection: TSection,
  isOpening: boolean,
): TSection {
  return isOpening ? toggledSection : currentSection;
}
