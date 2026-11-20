import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {antigravityAccounts, quotaRequest, parseQuotaResponse, safeVerificationURL, decodeStoredValue} from '../web/core.js';

const verificationURL = 'https://accounts.google.com/v3/signin/continue?plt=example%2Bvalue&continue=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2&sarp=1&scc=1&flowName=GlifWebSignIn';
const errorBody = {
  error: {code: 403, status: 'PERMISSION_DENIED', message: 'Verify your account to continue.', details: [
    {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'VALIDATION_REQUIRED', domain: 'cloudcode-pa.googleapis.com', metadata: {
      validation_url: verificationURL, validation_learn_more_url: 'https://support.google.com/accounts?p=verify'
    }},
    {'@type': 'type.googleapis.com/google.rpc.Help', links: [
      {description: 'Verify your account', url: verificationURL},
      {description: 'Learn more', url: 'https://support.google.com/accounts?p=verify'}
    ]}
  ]}
};

test('quota response wrapper preserves the complete verification URL exactly once', () => {
  const result = parseQuotaResponse({status_code: 403, body: JSON.stringify(errorBody)});
  assert.equal(result.kind, 'verify');
  assert.deepEqual(result.urls, [verificationURL]);
});

test('Help links are a fallback when ErrorInfo omits validation_url', () => {
  const body = structuredClone(errorBody);
  delete body.error.details[0].metadata.validation_url;
  assert.deepEqual(parseQuotaResponse({status_code: 403, body}).urls, [verificationURL]);
});

test('a verification requirement without a link remains visible', () => {
  const result = parseQuotaResponse({status_code: 403, body: {error: {code: 403, details: [{reason: 'VALIDATION_REQUIRED'}]}}});
  assert.equal(result.kind, 'verify');
  assert.deepEqual(result.urls, []);
});

test('ordinary permission failures and expired credentials are not verification requirements', () => {
  for (const [status, message] of [[403, 'Permission denied'], [401, 'Verify your account'], [429, 'Quota exceeded'], [500, 'Internal error']]) {
    assert.equal(parseQuotaResponse({status_code: status, body: {error: {message}}}).kind, 'error');
  }
  assert.equal(parseQuotaResponse({status_code: 200, body: '{}'}).kind, 'ok');
  assert.equal(parseQuotaResponse({body: '{}'}).kind, 'error');
});

test('text verification errors are shown without inventing a URL', () => {
  assert.equal(parseQuotaResponse({status_code: 403, body: 'Verify your account to continue.'}).kind, 'verify');
});

test('unsafe, unrelated, credential-bearing URLs are not displayed as verification links', () => {
  for (const url of ['javascript:alert(1)', 'http://accounts.google.com/a', 'https://accounts.google.com.evil.example/a',
    'https://support.google.com/accounts', 'https://x@accounts.google.com/a', 'https://accounts.google.com:8443/a',
    'https://accounts.google.com/a\n', ' https://accounts.google.com/a']) assert.equal(safeVerificationURL(url), '');
  assert.equal(safeVerificationURL(verificationURL), verificationURL);
});

test('provider filtering retains disabled Antigravity accounts and distinguishes credential indices', () => {
  const accounts = antigravityAccounts([
    {provider: 'antigravity', name: 'one.json', auth_index: 'one', email: 'same@example.com', disabled: true},
    {type: 'google-antigravity', name: 'two.json', auth_index: 'two', email: 'same@example.com'},
    {provider: 'codex', name: 'codex.json', auth_index: 'three'}
  ]);
  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].disabled, true);
  assert.notEqual(accounts[0].authIndex, accounts[1].authIndex);
  assert.equal(quotaRequest(accounts[0]).header.Authorization, 'Bearer $TOKEN$');
  assert.deepEqual(JSON.parse(quotaRequest(accounts[0]).data), {project: 'aicode-consumers'});
});

test('saved official management sessions are decoded with the original origin and user agent', () => {
  const value = {state: {managementKey: 'test-only-key'}};
  const host = 'localhost:8317', ua = 'test-agent';
  const key = new TextEncoder().encode(`cli-proxy-api-webui::secure-storage|${host}|${ua}`);
  const raw = new TextEncoder().encode(JSON.stringify(value));
  const encoded = btoa(String.fromCharCode(...raw.map((byte, i) => byte ^ key[i % key.length])));
  assert.deepEqual(decodeStoredValue(`enc::v1::${encoded}`, host, ua), value);
  assert.deepEqual(decodeStoredValue(JSON.stringify(value), host, ua), value);
  assert.equal(decodeStoredValue('broken', host, ua), null);
});

test('the page has no timers, background observers or automatic requests', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /setInterval|setTimeout|MutationObserver|visibilitychange/);
});
