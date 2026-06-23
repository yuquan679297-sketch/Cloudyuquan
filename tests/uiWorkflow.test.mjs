import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDiagnosticFreshness,
  getNextSettingsSection,
  getSettingsIssueAction,
  getWorkflowStage,
  normalizeAudioRms,
} from '../.tmp-tests/uiWorkflow.js';

test('getWorkflowStage prioritizes errors and active work', () => {
  assert.equal(getWorkflowStage({
    recordingState: 'recording',
    refining: false,
    hasResult: false,
    hasError: true,
  }), 'error');
  assert.equal(getWorkflowStage({
    recordingState: 'recording',
    refining: false,
    hasResult: false,
    hasError: false,
  }), 'recording');
  assert.equal(getWorkflowStage({
    recordingState: 'done',
    refining: true,
    hasResult: true,
    hasError: false,
  }), 'refining');
  assert.equal(getWorkflowStage({
    recordingState: 'processing',
    refining: false,
    hasResult: false,
    hasError: false,
  }), 'recognizing');
});

test('getWorkflowStage resolves idle and complete states', () => {
  assert.equal(getWorkflowStage({
    recordingState: 'idle',
    refining: false,
    hasResult: false,
    hasError: false,
  }), 'idle');
  assert.equal(getWorkflowStage({
    recordingState: 'done',
    refining: false,
    hasResult: true,
    hasError: false,
  }), 'complete');
});

test('normalizeAudioRms clamps noise floor and loud input', () => {
  assert.equal(normalizeAudioRms(0), 0);
  assert.equal(normalizeAudioRms(0.015), 0);
  assert.equal(normalizeAudioRms(Number.NaN), 0);
  assert.equal(normalizeAudioRms(1), 1);
  assert.ok(normalizeAudioRms(0.1) > 0);
  assert.ok(normalizeAudioRms(0.1) < 1);
});

test('getSettingsIssueAction chooses one precise settings action', () => {
  assert.deepEqual(getSettingsIssueAction(false, false, false), {
    section: 'asr',
    label: '配置 ASR',
  });
  assert.deepEqual(getSettingsIssueAction(true, false, false), {
    section: 'llm',
    label: '配置 LLM',
  });
  assert.deepEqual(getSettingsIssueAction(true, true, true), {
    section: 'shortcut',
    label: '修复快捷键',
  });
  assert.deepEqual(getSettingsIssueAction(true, true, false), {
    section: 'diagnostics',
    label: '查看诊断',
  });
});

test('getDiagnosticFreshness marks old diagnostic snapshots as stale', () => {
  assert.equal(getDiagnosticFreshness(false, 1, 2), 'empty');
  assert.equal(getDiagnosticFreshness(true, 2, 2), 'fresh');
  assert.equal(getDiagnosticFreshness(true, 1, 2), 'stale');
});

test('getNextSettingsSection keeps one drawer section open', () => {
  assert.equal(getNextSettingsSection('diagnostics', 'asr', true), 'asr');
  assert.equal(getNextSettingsSection('asr', 'asr', false), 'asr');
  assert.equal(getNextSettingsSection('llm', 'shortcut', false), 'llm');
});
