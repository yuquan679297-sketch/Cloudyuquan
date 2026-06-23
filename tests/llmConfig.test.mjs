import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LLM_API_BASE,
  canonicalizeApiBase,
  getLlmCompatibilityDiagnostic,
  getPresetIdForConfig,
  normalizeApiBase,
} from '../.tmp-tests/llmConfig.js';

test('normalizeApiBase trims whitespace and trailing slashes', () => {
  assert.equal(normalizeApiBase(' https://api.deepseek.com/v1/  '), 'https://api.deepseek.com/v1');
});

test('canonicalizeApiBase upgrades known legacy DeepSeek base', () => {
  assert.equal(canonicalizeApiBase('https://api.deepseek.com'), DEFAULT_LLM_API_BASE);
  assert.equal(canonicalizeApiBase('https://api.deepseek.com/'), DEFAULT_LLM_API_BASE);
});

test('getPresetIdForConfig matches DeepSeek preset for legacy and canonical base', () => {
  assert.equal(
    getPresetIdForConfig('https://api.deepseek.com', 'deepseek-v4-flash', 'openaiChat'),
    'deepseek-low',
  );
  assert.equal(
    getPresetIdForConfig('https://api.deepseek.com/v1', 'deepseek-v4-pro', 'openaiChat'),
    'deepseek-strong',
  );
});

test('getLlmCompatibilityDiagnostic distinguishes preset match, provider mismatch, and custom base', () => {
  assert.deepEqual(
    getLlmCompatibilityDiagnostic('https://api.deepseek.com', 'deepseek-v4-flash', 'openaiChat'),
    {
      status: 'ok',
      detail: 'DeepSeek 预设匹配 · OpenAI Chat Completions',
    },
  );

  assert.deepEqual(
    getLlmCompatibilityDiagnostic('https://api.deepseek.com/v1', 'deepseek-v4-flash', 'anthropicMessages'),
    {
      status: 'warn',
      detail: 'DeepSeek API Base 已识别，但当前协议不是常用组合，请检查协议选择。',
    },
  );

  assert.deepEqual(
    getLlmCompatibilityDiagnostic('https://example.com/v1', 'custom-model', 'openaiChat'),
    {
      status: 'ok',
      detail: '自定义 API Base · OpenAI Chat Completions',
    },
  );
});
