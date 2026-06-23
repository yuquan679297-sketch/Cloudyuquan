import { useCallback, useEffect, useRef, useState } from 'react';
import { humanizeError } from '../errorMessages.js';
import type { AutoCopyStatus } from '../hooks/useRefine';
import { getPromptDisplayState } from '../promptDisplayState.js';
import type { PromptHistoryItem, RecordingState, RefinedInstruction, TranscriptResult } from '../types';
import type { WorkflowStage } from '../uiWorkflow';
import { PromptMarkdown } from './PromptMarkdown';
import { UiIcon } from './UiIcon';

type CopyState = 'idle' | 'copied' | 'failed';
type ResultView = 'refined' | 'raw';
type PromptMode = 'preview' | 'edit';

function getPromptPreview(prompt: string) {
  const lines = prompt.split('\n').map((line) => line.trim()).filter(Boolean);
  const taskLine = lines.find((line) => line.startsWith('Task:') || line.startsWith('**Task**:'));
  const goalLine = lines.find((line) => line.startsWith('Goal:') || line.startsWith('**Goal**:'));

  if (taskLine) {
    return taskLine.replace('**Task**:', '').replace('Task:', '').trim();
  }
  if (goalLine) {
    return goalLine.replace('**Goal**:', '').replace('Goal:', '').trim();
  }
  return lines.find((line) => !line.startsWith('#') && !line.startsWith('**Codex rules**')) ?? prompt;
}

function getIntentLabel(intent: PromptHistoryItem['intent']) {
  const labels: Record<PromptHistoryItem['intent'], string> = {
    Create: '创建',
    Modify: '修改',
    Delete: '删除',
    Query: '查询',
    Debug: '调试',
    Refactor: '重构',
    Test: '测试',
    Document: '文档',
    Unknown: '未识别',
  };
  return labels[intent];
}

interface Props {
  result: TranscriptResult | null;
  workflowStage: WorkflowStage;
  recordingState?: RecordingState;
  livePreviewText?: string;
  errorMessage?: string | null;
  cleanedText?: string;
  refined?: RefinedInstruction | null;
  refining?: boolean;
  codexPrompt?: string;
  lastCodexPrompt?: string;
  promptHistory?: PromptHistoryItem[];
  autoCopy?: boolean;
  autoCopyStatus?: AutoCopyStatus;
  refineError?: string | null;
  regenerationNotice?: string;
  canRefineCurrentText?: boolean;
  onRefineCurrentText?: () => void | Promise<void>;
  onReusePrompt?: (prompt: string) => void;
  onClearPromptHistory?: () => void;
  onClearDisplayedPrompt?: () => void;
}

export function TranscriptPanel({
  result,
  workflowStage,
  recordingState,
  livePreviewText,
  errorMessage,
  cleanedText,
  refined,
  refining,
  codexPrompt,
  lastCodexPrompt,
  promptHistory = [],
  autoCopy,
  autoCopyStatus,
  refineError,
  regenerationNotice,
  canRefineCurrentText,
  onRefineCurrentText,
  onReusePrompt,
  onClearPromptHistory,
  onClearDisplayedPrompt,
}: Props) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [activeView, setActiveView] = useState<ResultView>('refined');
  const [promptMode, setPromptMode] = useState<PromptMode>('preview');
  const [editablePrompt, setEditablePrompt] = useState('');
  const [promptEdited, setPromptEdited] = useState(false);
  const [clearedPrompt, setClearedPrompt] = useState('');
  const [showClearUndo, setShowClearUndo] = useState(false);
  const [historyCopyState, setHistoryCopyState] = useState<{ id: string; state: CopyState } | null>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement | null>(null);
  const {
    displayPrompt,
    shouldShowPreviousResult,
    shouldShowUnclearMessage,
    shouldAllowCopy,
  } = getPromptDisplayState({ result, refined, codexPrompt, lastCodexPrompt });
  const hasLivePreview = Boolean(livePreviewText?.trim());
  const rawText = result?.raw?.trim() || livePreviewText?.trim() || '';
  const hasPromptToCopy = shouldAllowCopy && Boolean(editablePrompt.trim());
  const progressSteps = [
    { id: 'recording', label: '录音' },
    { id: 'recognizing', label: '识别' },
    { id: 'refining', label: '精炼' },
    { id: 'complete', label: '完成' },
  ] as const;
  const activeStepIndex = workflowStage === 'idle'
    ? -1
    : progressSteps.findIndex((step) => step.id === workflowStage);

  useEffect(() => {
    if (copyState === 'idle') {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setCopyState('idle'), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [copyState]);

  useEffect(() => {
    if (!historyCopyState) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setHistoryCopyState(null), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [historyCopyState]);

  useEffect(() => {
    setEditablePrompt(displayPrompt);
    setPromptEdited(false);
    setPromptMode('preview');
    if (displayPrompt) {
      setShowClearUndo(false);
    }
  }, [displayPrompt]);

  useEffect(() => {
    if (!showClearUndo) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      setShowClearUndo(false);
      setClearedPrompt('');
    }, 5000);
    return () => window.clearTimeout(timeoutId);
  }, [showClearUndo]);

  const handleCopy = useCallback(async () => {
    const prompt = editablePrompt.trim();
    if (!prompt) {
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }, [editablePrompt]);

  const handleClearPrompt = useCallback(() => {
    if (!displayPrompt || !onClearDisplayedPrompt) {
      return;
    }
    setClearedPrompt(displayPrompt);
    setShowClearUndo(true);
    setCopyState('idle');
    setPromptEdited(false);
    onClearDisplayedPrompt();
  }, [displayPrompt, onClearDisplayedPrompt]);

  const handleRestoreClearedPrompt = useCallback(() => {
    if (!clearedPrompt || !onReusePrompt) {
      return;
    }
    onReusePrompt(clearedPrompt);
    setShowClearUndo(false);
    setClearedPrompt('');
  }, [clearedPrompt, onReusePrompt]);

  const handleCopyHistoryPrompt = useCallback(async (item: PromptHistoryItem) => {
    try {
      await navigator.clipboard.writeText(item.prompt);
      setHistoryCopyState({ id: item.id, state: 'copied' });
    } catch {
      setHistoryCopyState({ id: item.id, state: 'failed' });
    }
  }, []);

  const copyButtonLabel = copyState === 'copied'
    ? '已复制'
    : copyState === 'failed'
      ? '复制失败'
      : shouldShowPreviousResult
        ? '上一条结果'
        : '复制 Prompt';
  const autoCopyLabel = shouldShowPreviousResult
    ? '当前保留上一条结果'
    : autoCopyStatus === 'copied'
      ? '已自动复制'
      : autoCopyStatus === 'failed'
        ? '自动复制失败'
        : autoCopy
          ? '自动复制已开启'
          : '自动复制关闭';
  const shouldShowManualCopy = copyState === 'failed' && hasPromptToCopy;

  return (
    <div className="transcript-panel">
      <div className="result-toolbar">
        <div>
          <div className="section-kicker">OUTPUT CONSOLE</div>
          <h2>Prompt 工作区</h2>
        </div>
        <div className="result-view-tabs" role="tablist" aria-label="结果视图">
          <button
            type="button"
            className={activeView === 'refined' ? 'is-active' : ''}
            onClick={() => setActiveView('refined')}
            role="tab"
            aria-selected={activeView === 'refined'}
          >
            精炼结果
          </button>
          <button
            type="button"
            className={activeView === 'raw' ? 'is-active' : ''}
            onClick={() => setActiveView('raw')}
            role="tab"
            aria-selected={activeView === 'raw'}
            disabled={!rawText && !hasLivePreview}
          >
            原始识别
          </button>
        </div>
      </div>

      <div className={`workflow-progress workflow-progress-${workflowStage}`}>
        {progressSteps.map((step, index) => {
          const state = workflowStage === 'error'
            ? 'error'
            : index < activeStepIndex
              ? 'done'
              : index === activeStepIndex
                ? 'active'
                : 'idle';
          return (
            <div key={step.id} className={`workflow-step workflow-step-${state}`}>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
            </div>
          );
        })}
      </div>

      {errorMessage && (
        <div className="prompt-error-panel" role="alert">
          <div className="prompt-error-summary">{humanizeError(errorMessage)}</div>
          <details>
            <summary>技术详情</summary>
            <div className="prompt-error-detail">{errorMessage}</div>
          </details>
        </div>
      )}

      {hasLivePreview && recordingState !== 'done' && (
        <div className="live-preview-panel">
          <span className="live-preview-dot" />
          <strong>{recordingState === 'recording' ? '实时识别' : '等待最终识别'}</strong>
          <span>{livePreviewText}</span>
        </div>
      )}

      {shouldShowUnclearMessage && (
        <div className="prompt-warning-panel">这句不像可执行的开发指令，请重新录一条更具体的任务。</div>
      )}

      {activeView === 'refined' && displayPrompt && (
        <section className="prompt-result-panel">
          <div className="prompt-result-header">
            <div className="prompt-result-title">
              <span className="prompt-card-signal" />
              <div>
                <strong>Codex-ready Prompt</strong>
                <span>{autoCopyLabel}</span>
              </div>
            </div>
            <div className="prompt-card-actions">
              <div className="prompt-mode-switch" aria-label="Prompt 显示模式">
                <button
                  type="button"
                  className={promptMode === 'preview' ? 'is-active' : ''}
                  onClick={() => setPromptMode('preview')}
                  aria-label="预览 Prompt"
                  title="预览"
                >
                  <UiIcon name="preview" size={16} />
                </button>
                <button
                  type="button"
                  className={promptMode === 'edit' ? 'is-active' : ''}
                  onClick={() => setPromptMode('edit')}
                  aria-label="编辑 Prompt"
                  title="编辑"
                >
                  <UiIcon name="edit" size={16} />
                </button>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                disabled={!hasPromptToCopy}
                className={`copy-primary-button copy-primary-button-${copyState}`}
              >
                <UiIcon name="clipboard" size={16} />
                {copyButtonLabel}
              </button>
            </div>
          </div>

          {shouldShowPreviousResult && (
            <div className="previous-result-label">
              {refining ? '正在生成新结果，当前先保留上一条 Prompt' : '本次未生成新 Prompt，以下是上一条结果'}
            </div>
          )}

          <div className="prompt-code-surface">
            <div className="code-surface-gutter" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            {promptMode === 'preview' ? (
              <PromptMarkdown content={editablePrompt} />
            ) : (
              <textarea
                value={editablePrompt}
                readOnly={!shouldAllowCopy}
                onChange={(event) => {
                  setEditablePrompt(event.target.value);
                  setPromptEdited(event.target.value !== displayPrompt);
                  setCopyState('idle');
                }}
                rows={12}
                className="prompt-textarea"
                aria-label="编辑 Prompt"
              />
            )}
          </div>

          <div className="prompt-result-footer">
            <div className="prompt-feedback-line">
              {copyState === 'copied' && <span className="is-success">已复制当前 Prompt，可以切到 Codex 粘贴。</span>}
              {copyState === 'failed' && <span className="is-error">复制失败，请使用手动复制兜底。</span>}
              {promptEdited && copyState === 'idle' && <span>已编辑，复制将使用当前文本。</span>}
              {regenerationNotice && !refining && <span>{regenerationNotice}</span>}
            </div>
            <div className="prompt-result-actions">
              <button
                type="button"
                onClick={onRefineCurrentText}
                disabled={refining || !canRefineCurrentText || !onRefineCurrentText}
                className="secondary-button compact-button"
              >
                {refining ? '精炼中' : '重新精炼'}
              </button>
              <button
                type="button"
                onClick={handleClearPrompt}
                disabled={!displayPrompt || !onClearDisplayedPrompt}
                className="secondary-button compact-button"
              >
                清除
              </button>
            </div>
          </div>

          {shouldShowManualCopy && (
            <div className="manual-copy-fallback">
              <div className="manual-copy-header">
                <span>手动复制兜底</span>
                <button
                  type="button"
                  onClick={() => {
                    manualCopyRef.current?.focus();
                    manualCopyRef.current?.select();
                  }}
                  className="secondary-button compact-button"
                >
                  选中全文
                </button>
              </div>
              <textarea
                ref={manualCopyRef}
                readOnly
                value={editablePrompt}
                rows={5}
                className="manual-copy-textarea"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}
        </section>
      )}

      {activeView === 'raw' && (
        <section className="raw-result-panel">
          <div className="raw-result-heading">
            <span>ASR TRANSCRIPT</span>
            <strong>{recordingState === 'recording' ? '实时输入' : '最终识别'}</strong>
          </div>
          <pre>{rawText || '还没有识别到语音内容。'}</pre>
          {result && (
            <details className="transcript-details">
              <summary>清理后文本与精炼详情</summary>
              <div className="transcript-details-body">
                <div><strong>清理后文本：</strong>{cleanedText || result.cleaned || '无'}</div>
                <div>
                  <strong>精炼状态：</strong>
                  {refining ? '精炼中' : refineError ? humanizeError(refineError) : '已完成'}
                </div>
                {refineError && <div className="error-inline">{refineError}</div>}
                {refined && (
                  <div className="refined-detail-grid">
                    <div><strong>任务目标：</strong>{refined.goal}</div>
                    <div><strong>补充背景：</strong>{refined.context}</div>
                    <div><strong>限制条件：</strong>{refined.constraints}</div>
                    <div><strong>完成标准：</strong>{refined.done_when}</div>
                    <div><strong>意图类型：</strong>{refined.intent}（{Math.round(refined.confidence * 100)}%）</div>
                  </div>
                )}
              </div>
            </details>
          )}
        </section>
      )}

      {activeView === 'refined' && !displayPrompt && (
        <div className="result-empty-state">
          <div className="empty-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
            <UiIcon name="terminal" size={30} />
          </div>
          <strong>等待语音指令</strong>
          <p>按住上方按钮说出开发任务，生成后的 Prompt 会在这里展开。</p>
        </div>
      )}

      {showClearUndo && (
        <div className="prompt-undo-panel">
          <span>已清除 Prompt。</span>
          <button
            type="button"
            onClick={handleRestoreClearedPrompt}
            disabled={!onReusePrompt}
            className="secondary-button compact-button"
          >
            恢复
          </button>
        </div>
      )}

      {promptHistory.length > 0 && (
        <details className="prompt-history-panel">
          <summary className="prompt-history-header">
            <span className="prompt-history-title-group">
              <UiIcon name="history" size={17} />
              <strong>最近 Prompts</strong>
              <span>{promptHistory.length}</span>
            </span>
            <span className="prompt-history-chevron"><UiIcon name="chevron" size={16} /></span>
          </summary>
          <div className="prompt-history-content">
            <div className="prompt-history-actions-top">
              <span>最多保留最近 5 条</span>
              <button
                type="button"
                onClick={onClearPromptHistory}
                disabled={!onClearPromptHistory}
                className="ghost-button"
              >
                清空历史
              </button>
            </div>
            <div className="prompt-history-list">
              {promptHistory.map((item) => {
                const preview = item.preview || getPromptPreview(item.prompt);
                const itemCopyState = historyCopyState?.id === item.id ? historyCopyState.state : 'idle';
                return (
                  <article key={item.id} className="prompt-history-item">
                    <div className="prompt-history-main">
                      <div className="prompt-history-meta">
                        <span>{getIntentLabel(item.intent)}</span>
                        <time>{new Date(item.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}</time>
                      </div>
                      <div className="prompt-history-preview" title={preview}>{preview}</div>
                    </div>
                    <div className="prompt-history-actions">
                      <button
                        type="button"
                        onClick={() => handleCopyHistoryPrompt(item)}
                        className="secondary-button compact-button"
                      >
                        {itemCopyState === 'copied' ? '已复制' : itemCopyState === 'failed' ? '失败' : '复制'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onReusePrompt?.(item.prompt)}
                        disabled={!onReusePrompt}
                        className="secondary-button compact-button"
                      >
                        复用
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
