import {antigravityAccounts, quotaRequest, parseQuotaResponse, decodeStoredValue} from './core.js';

const $ = id => document.getElementById(id);
const API = {
  v8: {accounts: '/v8/management/credentials', query: '/v8/management/requests/api-call'},
  v0: {accounts: '/v0/management/auth-files', query: '/v0/management/api-call'}
};
let accounts = [];
let run = null;
let apiVersion = null;

function setAPIVersion(version) {
  apiVersion = version;
  $('api-current').textContent = version ? `当前接口：${version}` :
    $('api-mode').value === 'auto' ? '当前接口：待识别' : `指定接口：${$('api-mode').value}`;
}

function storedKey() {
  try {
    const read = name => decodeStoredValue(localStorage.getItem(name), location.host, navigator.userAgent);
    const saved = read('cli-proxy-auth');
    const state = saved?.state || saved;
    return state?.managementKey || read('managementKey') || '';
  } catch { return ''; }
}

function notify(message, error = false) {
  $('notice').hidden = false;
  $('notice').textContent = message;
  $('notice').className = error ? 'notice error' : 'notice';
}

async function api(operation, options = {}) {
  const key = $('management-key').value.trim();
  if (!key) {
    $('connection').open = true;
    $('management-key').focus();
    throw new Error('请填写当前服务的管理密钥');
  }
  const mode = $('api-mode').value;
  const first = mode === 'auto' ? apiVersion || 'v8' : mode;
  const versions = mode === 'auto' ? [first, first === 'v8' ? 'v0' : 'v8'] : [first];
  let failure;
  for (const version of versions) {
    const path = API[version][operation];
    const response = await fetch(path, {
      ...options, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: {Authorization: `Bearer ${key}`, 'Content-Type': 'application/json'}
    });
    if (response.ok) {
      let data;
      try { data = await response.json(); }
      catch (error) { if (options.signal?.aborted) throw error; }
      const valid = operation === 'accounts' ? Array.isArray(data?.files) :
        Number.isInteger(data?.status_code) && data.status_code >= 100 && data.status_code <= 599 && data.body !== undefined;
      if (valid) {
        setAPIVersion(version);
        return data;
      }
      failure = new Error(`管理接口响应格式错误：${path}`);
    } else {
      const errors = {401: '管理密钥无效', 403: '管理接口拒绝访问，请检查密钥和远程管理设置'};
      failure = new Error(errors[response.status] || `管理接口返回 HTTP ${response.status}：${path}`);
      if (response.status !== 404 && response.status !== 405) throw failure;
    }
  }
  throw failure;
}

async function readAccounts(signal) {
  const data = await api('accounts', {signal});
  if (!Array.isArray(data.files)) throw new Error('账号列表响应格式错误');
  accounts = antigravityAccounts(data.files);
  render();
  return accounts;
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

async function copy(text, button) {
  try {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); copied = true; } catch { /* Use the selection fallback. */ }
    }
    if (!copied) {
      const textarea = node('textarea', 'clipboard-fallback');
      textarea.value = text;
      document.body.append(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('copy failed');
    }
    if (button) button.textContent = '已复制';
    notify('已复制到剪贴板');
  } catch { notify('复制失败，请选中链接手动复制', true); }
}

function render() {
  const allResults = accounts.filter(account => account.result);
  const pending = accounts.filter(account => account.result?.kind === 'verify');
  $('total').textContent = accounts.length;
  $('checked').textContent = allResults.length;
  $('pending').textContent = pending.length;
  $('errors').textContent = accounts.filter(account => account.result?.kind === 'error').length;
  $('copy-all').disabled = !pending.some(account => account.result.urls.length);
  const search = $('search').value.trim().toLowerCase();
  const visible = accounts.filter(account =>
    (!$('only-pending').checked || account.result?.kind === 'verify') &&
    `${account.email} ${account.name}`.toLowerCase().includes(search)
  );
  const container = $('accounts');
  container.replaceChildren();
  for (const account of visible) {
    const card = node('article', `account ${account.result?.kind || ''}`);
    const heading = node('div', 'account-heading');
    const identity = node('div', 'identity');
    identity.append(node('h2', '', account.email), node('div', 'filename', account.name));
    const actions = node('div', 'account-actions');
    if (account.disabled) actions.append(node('span', 'tag', '已停用'));
    const query = node('button', '', account.busy ? '查询中…' : '查询');
    query.disabled = Boolean(run) || !account.authIndex;
    query.addEventListener('click', () => queryAccounts([account]));
    actions.append(query);
    heading.append(identity, actions);
    card.append(heading);
    const result = account.result;
    card.append(node('div', `result ${result?.kind || ''}`, account.busy ? '正在获取账号状态…' :
      result ? `${result.status || '请求失败'} · ${result.message}` : account.authIndex ? '尚未查询' : '缺少 auth_index，无法查询'));
    for (const url of result?.urls || []) {
      const link = node('textarea', 'verification-url');
      link.readOnly = true;
      link.rows = 3;
      link.value = url;
      link.setAttribute('aria-label', `${account.email} 的验证链接`);
      const links = node('div', 'link-actions');
      const copyButton = node('button', 'primary', '复制验证链接');
      copyButton.addEventListener('click', () => copy(url, copyButton));
      const open = node('a', 'open-link', '打开验证页 ↗');
      open.href = url;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      links.append(copyButton, open);
      card.append(link, links);
    }
    if (account.checkedAt) card.append(node('div', 'checked-at', `查询时间：${account.checkedAt}`));
    container.append(card);
  }
  $('empty').hidden = visible.length > 0;
  if (accounts.length) $('empty').textContent = '没有符合筛选条件的账号。';
}

function setRunning(controller) {
  run = controller;
  $('query-all').disabled = Boolean(controller);
  $('load-accounts').disabled = Boolean(controller);
  $('management-key').disabled = Boolean(controller);
  $('api-mode').disabled = Boolean(controller);
  $('cancel').hidden = !controller;
  render();
}

async function checkAccount(account, signal) {
  account.busy = true;
  render();
  try {
    if (!account.authIndex) throw new Error('账号缺少 auth_index');
    const data = await api('query', {
      method: 'POST', body: JSON.stringify(quotaRequest(account)), signal
    });
    account.result = parseQuotaResponse(data);
    account.checkedAt = new Date().toLocaleString();
  } catch (error) {
    if (signal.aborted) return;
    account.result = {kind: 'error', status: 0, urls: [], message: error.message};
    account.checkedAt = new Date().toLocaleString();
    // Stop after an invalid management session instead of retrying every account.
    if (/管理密钥无效|管理接口拒绝访问/.test(error.message)) {
      notify(error.message, true);
      run?.abort();
    }
  } finally {
    account.busy = false;
    render();
  }
}

async function queryAccounts(selected) {
  if (run) return;
  const controller = new AbortController();
  setRunning(controller);
  $('notice').hidden = true;
  try {
    const queue = selected || await readAccounts(controller.signal);
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < queue.length && !controller.signal.aborted) {
        const account = queue[cursor++];
        await checkAccount(account, controller.signal);
        done++;
        $('progress').textContent = `已查询 ${done} / ${queue.length}`;
      }
    };
    await Promise.all([worker(), worker()]);
    $('progress').textContent = controller.signal.aborted ? '查询已停止' : `查询完成，共 ${queue.length} 个账号`;
    if (!queue.length) notify('未找到 Antigravity 账号');
  } catch (error) {
    if (!controller.signal.aborted) notify(error.message, true);
  } finally { setRunning(null); }
}

$('management-key').value = storedKey();
$('connection-summary').textContent = $('management-key').value ? '管理密钥 · 已复用管理中心会话' : '填写管理密钥';
$('connection').open = !$('management-key').value;
$('api-mode').addEventListener('change', () => setAPIVersion(null));
$('management-key').addEventListener('input', () => setAPIVersion(null));
$('query-all').addEventListener('click', () => queryAccounts());
$('load-accounts').addEventListener('click', async () => {
  if (run) return;
  const controller = new AbortController();
  setRunning(controller);
  try {
    await readAccounts(controller.signal);
    $('progress').textContent = `已读取 ${accounts.length} 个账号，点击账号旁的“查询”获取状态`;
  } catch (error) { if (!controller.signal.aborted) notify(error.message, true); }
  finally { setRunning(null); }
});
$('cancel').addEventListener('click', () => run?.abort());
$('search').addEventListener('input', render);
$('only-pending').addEventListener('change', render);
$('copy-all').addEventListener('click', () => {
  const lines = accounts.filter(account => account.result?.kind === 'verify' && account.result.urls.length)
    .map(account => `${account.email}\n${account.result.urls.join('\n')}`);
  copy(lines.join('\n\n'), $('copy-all'));
});
