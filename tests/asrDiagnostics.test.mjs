import test from 'node:test';
import assert from 'node:assert/strict';
import { getAsrTargetDiagnostic } from '../.tmp-tests/asrDiagnostics.js';

test('getAsrTargetDiagnostic reports missing target fields as error', () => {
  assert.deepEqual(
    getAsrTargetDiagnostic('', ''),
    {
      status: 'error',
      detail: 'Endpoint 缺失 · Resource ID 缺失',
      suggestion: '确认 Endpoint 和 Resource ID 都已填写；如果没有特殊需求，保留默认值即可。',
    },
  );
});

test('getAsrTargetDiagnostic warns when endpoint is not websocket', () => {
  assert.deepEqual(
    getAsrTargetDiagnostic('https://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', 'volc.seedasr.sauc.duration'),
    {
      status: 'warn',
      detail: 'https://openspeech.bytedance.com/api/v3/sauc/bigmodel_async · volc.seedasr.sauc.duration · Endpoint 不是 WebSocket 地址',
      suggestion: '把 Endpoint 改成以 ws:// 或 wss:// 开头的 WebSocket 地址，再重新运行诊断。',
    },
  );
});

test('getAsrTargetDiagnostic accepts websocket endpoint', () => {
  assert.deepEqual(
    getAsrTargetDiagnostic('wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async', 'volc.seedasr.sauc.duration'),
    {
      status: 'ok',
      detail: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async · volc.seedasr.sauc.duration',
      suggestion: '',
    },
  );
});
