export function getAsrTargetDiagnostic(endpoint: string, resourceId: string) {
  const trimmedEndpoint = endpoint.trim();
  const trimmedResourceId = resourceId.trim();

  if (!trimmedEndpoint || !trimmedResourceId) {
    return {
      status: 'error' as const,
      detail: `${trimmedEndpoint || 'Endpoint 缺失'} · ${trimmedResourceId || 'Resource ID 缺失'}`,
      suggestion: '确认 Endpoint 和 Resource ID 都已填写；如果没有特殊需求，保留默认值即可。',
    };
  }

  if (!/^wss?:\/\//i.test(trimmedEndpoint)) {
    return {
      status: 'warn' as const,
      detail: `${trimmedEndpoint} · ${trimmedResourceId} · Endpoint 不是 WebSocket 地址`,
      suggestion: '把 Endpoint 改成以 ws:// 或 wss:// 开头的 WebSocket 地址，再重新运行诊断。',
    };
  }

  return {
    status: 'ok' as const,
    detail: `${trimmedEndpoint} · ${trimmedResourceId}`,
    suggestion: '',
  };
}
