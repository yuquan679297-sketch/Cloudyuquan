export function humanizeError(message: string) {
  const normalized = message.toLowerCase();

  if (message.includes('Microphone') || message.includes('mediaDevices') || message.includes('Permission')) {
    return '无法使用麦克风，请在 macOS 系统设置的“隐私与安全性 -> 麦克风”中允许 VoiceHub。';
  }

  if (
    message.includes('鼠标快捷键') ||
    message.includes('辅助功能') ||
    normalized.includes('mouse shortcut')
  ) {
    return '鼠标侧键不可用，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub。';
  }

  if (message.includes('clipboard') || message.includes('剪贴板')) {
    return '复制失败，请检查剪贴板权限，或手动选中当前 Prompt 复制。';
  }

  if (normalized.includes('websocket')) {
    return '本地音频连接失败，请重新打开 App 后再试；如果持续失败，请检查本地 ASR 服务。';
  }

  if (message.includes('ASR') || message.includes('豆包')) {
    if (message.includes('401') || message.includes('403') || normalized.includes('unauthorized') || normalized.includes('api key')) {
      return '豆包 ASR 认证失败，请检查 API Key 和权限。';
    }

    if (normalized.includes('timeout') || message.includes('超时')) {
      return '豆包 ASR 响应超时，请稍后重试并检查网络连接。';
    }

    return '语音识别失败，请检查豆包 ASR 凭证、Resource ID 和网络连接。';
  }

  if (
    message.includes('LLM') ||
    message.includes('精炼') ||
    normalized.includes('openai') ||
    normalized.includes('anthropic') ||
    normalized.includes('model')
  ) {
    if (message.includes('401') || message.includes('403') || normalized.includes('unauthorized') || normalized.includes('api key')) {
      return '精炼模型认证失败，请检查 LLM API Key、模型和协议。';
    }

    if (message.includes('429') || normalized.includes('rate limit')) {
      return '精炼模型请求太频繁，请稍后再试。';
    }

    if (message.includes('400') || normalized.includes('bad request')) {
      return '精炼模型请求格式不正确，请检查 API Base、协议和模型是否匹配。';
    }

    if (normalized.includes('timeout') || message.includes('超时')) {
      return '精炼模型响应超时，请稍后重试或换一个模型。';
    }

    return '精炼模型请求失败，请检查 LLM 配置和网络连接。';
  }

  if (message.includes('401') || message.includes('403') || normalized.includes('unauthorized') || normalized.includes('api key')) {
    return '认证失败，请检查对应服务的 API Key 和权限。';
  }

  if (message.includes('429') || normalized.includes('rate limit')) {
    return '请求太频繁，请稍后再试。';
  }

  if (normalized.includes('timeout') || message.includes('超时')) {
    return '请求超时，请稍后重试。';
  }

  return '处理失败，请查看技术详情。';
}

function humanizeStorageError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes('keychain entry') || normalized.includes('keychain persistence')) {
    if (normalized.includes('read keychain')) {
      return '无法读取 macOS Keychain 中的已保存密钥，请检查钥匙串权限。';
    }

    if (normalized.includes('write keychain')) {
      return '无法写入 macOS Keychain，请检查钥匙串权限。';
    }

    if (normalized.includes('delete keychain')) {
      return '无法清除 macOS Keychain 中的已保存密钥，请检查钥匙串权限。';
    }

    return '无法访问 macOS Keychain，请检查钥匙串权限。';
  }

  if (
    normalized.includes('failed to read ') ||
    normalized.includes('failed to write ') ||
    normalized.includes('failed to parse ') ||
    normalized.includes('failed to create ') ||
    normalized.includes('failed to resolve app config directory')
  ) {
    return '无法读写本机配置文件，请检查当前用户目录权限。';
  }

  return humanizeError(message);
}

export function humanizeStatusMessage(message: string) {
  const trimmed = message.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('注册失败：')) {
    return `注册失败：${humanizeError(trimmed.slice('注册失败：'.length).trim())}`;
  }

  if (trimmed.startsWith('读取本地保存配置失败：')) {
    return `读取本地保存配置失败：${humanizeStorageError(trimmed.slice('读取本地保存配置失败：'.length).trim())}`;
  }

  if (trimmed.startsWith('读取开发配置失败：')) {
    return `读取开发配置失败：${humanizeStorageError(trimmed.slice('读取开发配置失败：'.length).trim())}`;
  }

  const normalized = trimmed.toLowerCase();
  if (
    trimmed.includes('失败') ||
    normalized.includes('failed') ||
    normalized.includes('error') ||
    normalized.includes('timeout') ||
    normalized.includes('unauthorized')
  ) {
    return humanizeStorageError(trimmed);
  }

  return trimmed;
}

export function getShortcutIssueSummary(message: string, source: 'keyboard' | 'mouse') {
  const humanized = humanizeStatusMessage(message);

  if (source === 'mouse' && humanized.includes('辅助功能')) {
    return '侧键权限';
  }

  return '快捷键异常';
}
