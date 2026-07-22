import assert from 'node:assert/strict';
import { handleContactRequest } from '../functions/api/contact.js';

function fakeDatabase() {
  return {
    prepare(sql) {
      return {
        bind() { return this; },
        async first() {
          return sql.includes('SELECT inquiry_id') ? null : undefined;
        },
        async run() { return { success: true }; }
      };
    }
  };
}

function formRequest() {
  const form = new FormData();
  form.set('submission_token', '00000000-0000-4000-8000-000000000010');
  form.set('name', 'テスト太郎');
  form.set('company', 'テスト会社');
  form.set('email', 'test@example.com');
  form.set('deadline', '8月中');
  form.set('message', 'テスト相談本文');
  form.set('object', 'テスト対象物');
  form.set('vehicle', 'テスト車');
  form.set('budget', '10〜20万円');
  form.set('data', 'ある');
  return new Request('https://preview.example.test/api/contact', {
    method: 'POST',
    headers: { Origin: 'https://preview.example.test', Accept: 'application/json' },
    body: form
  });
}

const env = {
  CONTACT_DB: fakeDatabase(),
  CONTACT_RATE_LIMIT: { get: async () => null, put: async () => undefined },
  RESEND_API_KEY: 'resend-secret',
  CONTACT_NOTIFICATION_TO: 'owner@example.com',
  CONTACT_FROM: 'website@example.com',
  ALLOWED_ORIGIN: 'https://preview.example.test',
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'sheets-secret',
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp'
};

const order = [];
let sheetPayload;
const successFetch = async (url, options) => {
  if (url === 'https://api.resend.com/emails') {
    order.push('email');
    return new Response('{}', { status: 200 });
  }
  order.push('sheet');
  sheetPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    action: 'created',
    recordId: sheetPayload.record.recordId,
    savedAt: '2026-07-22 12:30:00'
  }));
};

const success = await handleContactRequest({ request: formRequest(), env }, { fetch: successFetch });
assert.equal(success.status, 200);
assert.equal((await success.json()).ok, true);
assert.deepEqual(order, ['email', 'sheet']);
assert.equal(sheetPayload.action, 'saveInquiry');
assert.equal(sheetPayload.environment, 'preview');
assert.equal(sheetPayload.record.status, '未対応');
assert.equal(sheetPayload.record.clientName, 'テスト太郎');
assert.match(sheetPayload.record.recordId, /^[0-9a-f-]{36}$/i);

const originalConsoleError = console.error;
const errors = [];
console.error = (message) => errors.push(message);
try {
  const envWithoutRateLimit = { ...env, CONTACT_DB: fakeDatabase() };
  delete envWithoutRateLimit.CONTACT_RATE_LIMIT;
  const sheetFailure = await handleContactRequest({ request: formRequest(), env: envWithoutRateLimit }, {
    fetch: async (url) => {
      if (url === 'https://api.resend.com/emails') return new Response('{}', { status: 200 });
      return new Response('{}', { status: 500 });
    }
  });
  assert.equal(sheetFailure.status, 200);
  assert.equal((await sheetFailure.json()).ok, true);
  assert.deepEqual(errors, ['inquiry_sheet_save_failed']);
  assert.doesNotMatch(errors.join(' '), /テスト太郎|test@example\.com|テスト相談本文|sheets-secret/);
} finally {
  console.error = originalConsoleError;
}

console.log('contact-inquiry-sheet: all tests passed');
