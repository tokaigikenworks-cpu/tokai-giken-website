import assert from 'node:assert/strict';
import {
  createInquiryRecord,
  handleSaveInquiryRequest,
  saveInquiryRecord
} from '../functions/api/save-inquiry.js';

const env = {
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'server-only-secret',
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp'
};

function request(body, options = {}) {
  const method = options.method || 'POST';
  return new Request('https://example.test/api/save-inquiry', {
    method,
    headers: {
      'Content-Type': options.contentType || 'application/json',
      'X-Inquiry-Internal-Secret': options.secret === undefined ? env.SHEETS_SHARED_SECRET : options.secret
    },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
}

const record = createInquiryRecord({
  inquiryId: 'TG-20260722-TEST0001',
  name: 'テスト太郎',
  company: 'テスト会社',
  email: 'test@example.com',
  deadline: '8月中',
  message: '相談本文',
  object: 'テスト部品',
  vehicle: 'テスト車',
  budget: '10〜20万円',
  data: 'ある',
  attachments: [{ name: 'sample.step', type: 'model/step', size: 1234, key: 'contacts/id/sample.step' }]
}, { now: '2026-07-22T12:00:00.000Z', randomUUID: () => '00000000-0000-4000-8000-000000000001' });

assert.equal(record.recordId, '00000000-0000-4000-8000-000000000001');
assert.equal(record.inquiryId, 'TG-20260722-TEST0001');
assert.equal(record.status, '未対応');
assert.equal(record.projectName, 'テスト部品');
assert.equal(record.sourceType, 'cad');
assert.equal(record.fitting, 'known');
assert.equal(record.attachmentCount, 1);
assert.deepEqual(record.attachmentNames, ['sample.step']);

let forwarded;
const successFetch = async (url, options) => {
  forwarded = { url, options, body: JSON.parse(options.body) };
  return new Response(JSON.stringify({
    ok: true,
    action: 'created',
    recordId: record.recordId,
    savedAt: '2026-07-22 12:00:01'
  }));
};

const saved = await saveInquiryRecord(record, env, successFetch);
assert.equal(saved.ok, true);
assert.equal(forwarded.body.action, 'saveInquiry');
assert.equal(forwarded.body.environment, 'preview');
assert.equal(forwarded.body.record.environment, 'preview');
assert.equal(forwarded.body.secret, env.SHEETS_SHARED_SECRET);
assert.doesNotMatch(JSON.stringify(saved), /テスト太郎|相談本文|server-only-secret|sample\.step/);

let productionPayload;
await saveInquiryRecord(record, { ...env, CF_PAGES_BRANCH: 'main' }, async (url, options) => {
  productionPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({ ok: true, action: 'updated', recordId: record.recordId, savedAt: '2026-07-22 12:00:02' }));
});
assert.equal(productionPayload.environment, 'production');

const getResponse = await handleSaveInquiryRequest(request({}, { method: 'GET' }), env, successFetch);
assert.equal(getResponse.status, 405);

const invalidSecret = await handleSaveInquiryRequest(request({ record: {} }, { secret: 'wrong' }), env, successFetch);
assert.equal(invalidSecret.status, 403);

const invalidType = await handleSaveInquiryRequest(request({ record: {} }, { contentType: 'text/plain' }), env, successFetch);
assert.equal(invalidType.status, 415);

const invalidRecord = await handleSaveInquiryRequest(request({}), env, successFetch);
assert.equal(invalidRecord.status, 400);

const timeout = await saveInquiryRecord(record, env, (url, options) => new Promise((resolve, reject) => {
  options.signal.addEventListener('abort', () => reject(new Error('aborted')));
}), 5);
assert.deepEqual(timeout, { ok: false, error: 'sheets_save_failed' });

console.log('save-inquiry-api: all tests passed');
