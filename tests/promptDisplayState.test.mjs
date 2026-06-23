import test from 'node:test';
import assert from 'node:assert/strict';
import { getPromptDisplayState } from '../.tmp-tests/promptDisplayState.js';

function createRefinedInstruction(overrides = {}) {
  return {
    goal: '',
    context: '',
    constraints: '',
    done_when: '',
    intent: 'Unknown',
    confidence: 0.2,
    raw_input: '随便看看',
    cleaned_input: '随便看看',
    processing_ms: 120,
    ...overrides,
  };
}

test('getPromptDisplayState keeps a newly generated prompt copyable', () => {
  assert.deepEqual(
    getPromptDisplayState({
      result: { raw: '修按钮文案', cleaned: '修按钮文案', refined: '' },
      refined: createRefinedInstruction({
        goal: '把复制按钮文案改清楚',
        intent: 'Modify',
        confidence: 0.91,
      }),
      codexPrompt: 'Task: 把复制按钮文案改清楚',
      lastCodexPrompt: 'Task: 旧的 prompt',
    }),
    {
      currentPrompt: 'Task: 把复制按钮文案改清楚',
      displayPrompt: 'Task: 把复制按钮文案改清楚',
      displaySource: 'current',
      shouldShowPreviousResult: false,
      shouldShowUnclearMessage: false,
      shouldAllowCopy: true,
    },
  );
});

test('getPromptDisplayState falls back to the previous prompt as reference only when no new prompt is usable', () => {
  assert.deepEqual(
    getPromptDisplayState({
      result: { raw: '先这样吧', cleaned: '先这样吧', refined: '' },
      refined: createRefinedInstruction(),
      codexPrompt: '',
      lastCodexPrompt: 'Task: 上一条有效 prompt',
    }),
    {
      currentPrompt: '',
      displayPrompt: 'Task: 上一条有效 prompt',
      displaySource: 'previous',
      shouldShowPreviousResult: true,
      shouldShowUnclearMessage: true,
      shouldAllowCopy: false,
    },
  );
});

test('getPromptDisplayState treats a reused prompt as current even without a fresh transcript result', () => {
  assert.deepEqual(
    getPromptDisplayState({
      result: null,
      refined: null,
      codexPrompt: 'Task: 复用历史 prompt',
      lastCodexPrompt: 'Task: 更旧的 prompt',
    }),
    {
      currentPrompt: 'Task: 复用历史 prompt',
      displayPrompt: 'Task: 复用历史 prompt',
      displaySource: 'current',
      shouldShowPreviousResult: false,
      shouldShowUnclearMessage: false,
      shouldAllowCopy: true,
    },
  );
});
