import assert from 'node:assert/strict';
import { handleSaveEstimateRequest } from '../functions/api/save-estimate.js';

function request(body, method = 'POST') {
  return new Request('https://example.test/api/save-estimate', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
}

const env = {
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'server-only-secret',
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp'
};

let forwarded = null;
const successFetch = async (url, options) => {
  forwarded = { url, options, body: JSON.parse(options.body) };
  return new Response(JSON.stringify({
    ok: true,
    action: 'created',
    recordId: 'record-1',
    savedAt: '2026-07-21 18:00:00'
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const success = await handleSaveEstimateRequest(request({
  environment: 'production',
  secret: 'browser-secret-must-be-ignored',
  record: { recordId: 'record-1', inquiryText: '機密の問い合わせ', items: [{ description: '作業費', price: 1000 }] }
}), env, successFetch);
const successData = await success.json();
assert.equal(success.status, 200);
assert.deepEqual(successData, { ok: true, action: 'created', recordId: 'record-1', savedAt: '2026-07-21 18:00:00' });
assert.equal(forwarded.url, env.SHEETS_WEB_APP_URL);
assert.equal(forwarded.body.secret, env.SHEETS_SHARED_SECRET);
assert.equal(forwarded.body.environment, 'preview');
assert.equal(forwarded.body.record.recordId, 'record-1');
assert.equal(forwarded.options.redirect, 'follow');
assert.doesNotMatch(JSON.stringify(successData), /server-only-secret|機密の問い合わせ|作業費/);

let productionForwarded = null;
await handleSaveEstimateRequest(request({ record: { recordId: 'record-1' } }), {
  ...env,
  CF_PAGES_BRANCH: 'main'
}, async (url, options) => {
  productionForwarded = JSON.parse(options.body);
  return new Response(JSON.stringify({ ok: true, action: 'updated', recordId: 'record-1', savedAt: '2026-07-21 18:01:00' }));
});
assert.equal(productionForwarded.environment, 'production');

const method = await handleSaveEstimateRequest(request({}, 'GET'), env, successFetch);
assert.equal(method.status, 405);
assert.equal((await method.json()).error, 'method_not_allowed');

const missingRecord = await handleSaveEstimateRequest(request({}), env, successFetch);
assert.equal(missingRecord.status, 400);
assert.equal((await missingRecord.json()).error, 'invalid_record');

const missingRecordId = await handleSaveEstimateRequest(request({ record: {} }), env, successFetch);
assert.equal(missingRecordId.status, 400);
assert.equal((await missingRecordId.json()).error, 'invalid_record_id');

const missingConfig = await handleSaveEstimateRequest(request({ record: { recordId: 'record-1' } }), {}, successFetch);
assert.equal(missingConfig.status, 503);
assert.equal((await missingConfig.json()).error, 'sheets_not_configured');

const googleError = await handleSaveEstimateRequest(request({ record: { recordId: 'record-1' } }), env, async () => {
  return new Response('{}', { status: 500 });
});
assert.equal(googleError.status, 502);
assert.equal((await googleError.json()).error, 'sheets_save_failed');

const invalidGoogleJson = await handleSaveEstimateRequest(request({ record: { recordId: 'record-1' } }), env, async () => {
  return new Response('not-json', { status: 200 });
});
assert.equal(invalidGoogleJson.status, 502);

const mismatchedRecord = await handleSaveEstimateRequest(request({ record: { recordId: 'record-1' } }), env, async () => {
  return new Response(JSON.stringify({ ok: true, action: 'updated', recordId: 'different', savedAt: '2026-07-21 18:02:00' }));
});
assert.equal(mismatchedRecord.status, 502);

const timeout = await handleSaveEstimateRequest(request({ record: { recordId: 'record-1' } }), env, (url, options) => {
  return new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', function () {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
}, 5);
assert.equal(timeout.status, 502);
assert.equal((await timeout.json()).error, 'sheets_save_failed');

console.log('save-estimate-api: all tests passed');
