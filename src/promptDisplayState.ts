import type { RefinedInstruction, TranscriptResult } from './types';

interface PromptDisplayStateInput {
  result?: TranscriptResult | null;
  refined?: RefinedInstruction | null;
  codexPrompt?: string;
  lastCodexPrompt?: string;
}

export interface PromptDisplayState {
  currentPrompt: string;
  displayPrompt: string;
  displaySource: 'current' | 'previous' | 'none';
  shouldShowPreviousResult: boolean;
  shouldShowUnclearMessage: boolean;
  shouldAllowCopy: boolean;
}

function hasRefinedContent(refined?: RefinedInstruction | null) {
  if (!refined) {
    return false;
  }

  return [
    refined.goal,
    refined.context,
    refined.constraints,
    refined.done_when,
  ].some((value) => value.trim());
}

export function getPromptDisplayState({
  result,
  refined,
  codexPrompt = '',
  lastCodexPrompt = '',
}: PromptDisplayStateInput): PromptDisplayState {
  const isLowConfidenceUnknown = refined?.intent === 'Unknown' && refined.confidence < 0.6;
  const currentPrompt = isLowConfidenceUnknown && !hasRefinedContent(refined) ? '' : codexPrompt;
  const displayPrompt = currentPrompt || lastCodexPrompt;
  const displaySource = currentPrompt
    ? 'current'
    : lastCodexPrompt
      ? 'previous'
      : 'none';

  return {
    currentPrompt,
    displayPrompt,
    displaySource,
    shouldShowPreviousResult: displaySource === 'previous',
    shouldShowUnclearMessage: Boolean(result && isLowConfidenceUnknown && !hasRefinedContent(refined)),
    shouldAllowCopy: displaySource === 'current',
  };
}
