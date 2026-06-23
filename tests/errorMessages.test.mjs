import test from 'node:test';
import assert from 'node:assert/strict';
import { getShortcutIssueSummary, humanizeError, humanizeStatusMessage } from '../.tmp-tests/errorMessages.js';

test('humanizeError explains microphone permission failures with macOS path', () => {
  assert.equal(
    humanizeError('Microphone setup failed'),
    '无法使用麦克风，请在 macOS 系统设置的“隐私与安全性 -> 麦克风”中允许 VoiceHub。',
  );
});

test('humanizeError explains mouse accessibility failures with macOS path', () => {
  assert.equal(
    humanizeError('鼠标快捷键监听启动失败，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub'),
    '鼠标侧键不可用，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub。',
  );
});

test('humanizeError explains websocket failures as local ASR issues', () => {
  assert.equal(
    humanizeError('WebSocket connection timed out'),
    '本地音频连接失败，请重新打开 App 后再试；如果持续失败，请检查本地 ASR 服务。',
  );
});

test('humanizeError distinguishes LLM bad request from auth and rate limits', () => {
  assert.equal(
    humanizeError('LLM refinement endpoint returned HTTP 400: bad request'),
    '精炼模型请求格式不正确，请检查 API Base、协议和模型是否匹配。',
  );
  assert.equal(
    humanizeError('LLM refinement endpoint returned HTTP 401: unauthorized'),
    '精炼模型认证失败，请检查 LLM API Key、模型和协议。',
  );
  assert.equal(
    humanizeError('LLM refinement endpoint returned HTTP 429: rate limit'),
    '精炼模型请求太频繁，请稍后再试。',
  );
});

test('humanizeStatusMessage keeps success text and humanizes shortcut failures', () => {
  assert.equal(humanizeStatusMessage('LLM 精炼配置已应用并保存'), 'LLM 精炼配置已应用并保存');
  assert.equal(
    humanizeStatusMessage('注册失败：鼠标快捷键监听启动失败，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub'),
    '注册失败：鼠标侧键不可用，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub。',
  );
});

test('humanizeStatusMessage explains keychain and config-file failures', () => {
  assert.equal(
    humanizeStatusMessage('读取本地保存配置失败：failed to read keychain entry llm-api-key'),
    '读取本地保存配置失败：无法读取 macOS Keychain 中的已保存密钥，请检查钥匙串权限。',
  );
  assert.equal(
    humanizeStatusMessage('读取开发配置失败：failed to read /tmp/runtime-config.json'),
    '读取开发配置失败：无法读写本机配置文件，请检查当前用户目录权限。',
  );
});

test('getShortcutIssueSummary distinguishes mouse accessibility from generic failures', () => {
  assert.equal(
    getShortcutIssueSummary(
      '鼠标快捷键监听启动失败，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub',
      'mouse',
    ),
    '侧键权限',
  );
  assert.equal(getShortcutIssueSummary('快捷键不能为空', 'keyboard'), '快捷键异常');
});
