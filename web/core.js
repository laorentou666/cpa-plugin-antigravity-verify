// This module has no network access or timers.
export function antigravityAccounts(files) {
  return files.filter(file => [file.provider, file.type].some(value =>
    ['antigravity', 'google-antigravity'].includes(String(value || '').toLowerCase())
  )).map(file => ({
    authIndex: String(file.auth_index ?? ''),
    name: String(file.name || file.id || ''),
    email: String(file.email || file.account || file.label || file.name || file.id || '未命名账号'),
    disabled: Boolean(file.disabled),
    project: String(file.project_id || 'aicode-consumers')
  }));
}

export function quotaRequest(account) {
  return {
    auth_index: account.authIndex,
    method: 'POST',
    url: 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
    header: {
      Authorization: 'Bearer $TOKEN$',
      'Content-Type': 'application/json',
      'User-Agent': 'antigravity/cli/1.0.13 (aidev_client; os_type=darwin; arch=arm64)'
    },
    data: JSON.stringify({project: account.project})
  };
}

export function safeVerificationURL(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\s\x00-\x1f]/.test(value)) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname === 'accounts.google.com' &&
      !parsed.username && !parsed.password && (!parsed.port || parsed.port === '443') ? value : '';
  } catch { return ''; }
}

export function parseQuotaResponse(response) {
  const status = Number(response?.status_code);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return {kind: 'error', status: 0, urls: [], message: '查询响应缺少上游状态码'};
  }
  let body = response.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { /* Plain-text errors remain searchable. */ }
  }
  const error = body?.error && typeof body.error === 'object' ? body.error : body;
  const details = Array.isArray(error?.details) ? error.details : [];
  const message = typeof error?.message === 'string' ? error.message : typeof body === 'string' ? body : '';
  const verify = status === 403 && (
    details.some(detail => detail?.reason === 'VALIDATION_REQUIRED') ||
    /verify\s+(?:your\s+)?account|verify your identity|validation_required/i.test(message)
  );
  if (verify) {
    const urls = [];
    const add = value => { const url = safeVerificationURL(value); if (url && !urls.includes(url)) urls.push(url); };
    for (const detail of details) add(detail?.metadata?.validation_url);
    add(error?.validation_url);
    if (!urls.length) {
      for (const detail of details) {
        for (const link of Array.isArray(detail?.links) ? detail.links : []) {
          if (/verify|validation|验证/i.test(link?.description || '')) add(link?.url);
        }
      }
    }
    return {kind: 'verify', status, urls, message: urls.length ? '需要验证账号' : '需要验证账号，上游未提供可用验证链接'};
  }
  if (status >= 200 && status < 300) return {kind: 'ok', status, urls: [], message: '查询成功'};
  return {kind: 'error', status, urls: [], message: (message || '上游返回异常').slice(0, 500)};
}

export function decodeStoredValue(raw, host, userAgent) {
  if (!raw) return null;
  try {
    if (raw.startsWith('enc::v1::')) {
      const key = new TextEncoder().encode(`cli-proxy-api-webui::secure-storage|${host}|${userAgent}`);
      const bytes = Uint8Array.from(atob(raw.slice(9)), char => char.charCodeAt(0));
      raw = new TextDecoder().decode(bytes.map((value, index) => value ^ key[index % key.length]));
    }
    return JSON.parse(raw);
  } catch { return null; }
}
