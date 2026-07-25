import assert from 'node:assert/strict';
import { handleActiveInquiriesRequest } from '../functions/api/active-inquiries.js';
import { handleLoadInquiryRequest } from '../functions/api/load-inquiry.js';

const env = {
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp',
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'shared-secret'
};
const allowAccess = async () => true;
const headers = {
  'Cf-Access-Jwt-Assertion': 'test-jwt',
  'Cf-Access-Authenticated-User-Email': 'owner@example.com'
};

const listRequest = () => new Request('https://preview.example.test/api/active-inquiries', {
  method: 'GET',
  headers
});
const loadRequest = (recordId) => new Request('https://preview.example.test/api/load-inquiry', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId })
});

let listPayload;
const listResponse = await handleActiveInquiriesRequest(listRequest(), env, async (_url, options) => {
  listPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    count: 2,
    items: [
      { recordId: 'newer', status: '見積作成中', inquiryReceivedAt: '2026-07-24T00:00:00Z', quoteNumber: '20260724_1' },
      { recordId: 'ignored', status: '見積提出済み', inquiryReceivedAt: '2026-07-20T00:00:00Z' },
      { recordId: 'older', status: '確認中', inquiryReceivedAt: '2026-07-21T00:00:00Z', clientName: '古い案件' }
    ]
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(listResponse.status, 200);
const listResult = await listResponse.json();
assert.deepEqual(listResult.items.map((item) => item.recordId), ['older', 'newer']);
assert.equal(listResult.count, 2);
assert.equal(listPayload.action, 'listActiveInquiries');
assert.equal(listPayload.environment, 'preview');

let loadPayload;
const loadResponse = await handleLoadInquiryRequest(loadRequest('older'), env, async (_url, options) => {
  loadPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    record: {
      recordId: 'older',
      inquiryId: 'TG-OLDER',
      status: '見積作成中',
      clientName: '見積 太郎',
      quoteClientName: '株式会社テスト',
      estimateProjectName: '再開テスト',
      estimateInquiryText: '保存済み相談内容',
      itemsJson: JSON.stringify([{ description: '設計費', quantity: 2, unit: '式', price: 50000 }]),
      apiWarnings: JSON.stringify(['取付条件を確認']),
      taxRate: 10,
      total: 110000
    }
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(loadResponse.status, 200);
const loaded = (await loadResponse.json()).record;
assert.equal(loaded.recordId, 'older');
assert.equal(loaded.items[0].price, 50000);
assert.deepEqual(loaded.apiWarnings, ['取付条件を確認']);
assert.equal(loadPayload.action, 'loadInquiry');
assert.equal(loadPayload.environment, 'preview');

const missing = await handleLoadInquiryRequest(loadRequest('missing'), env, async () => {
  return new Response(JSON.stringify({ ok: false, error: 'record_not_found' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}, undefined, allowAccess);
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error, 'record_not_found');

const invalidStatus = await handleLoadInquiryRequest(loadRequest('submitted'), env, async () => {
  return new Response(JSON.stringify({ ok: true, record: { recordId: 'submitted', status: '見積提出済み' } }), {
    headers: { 'Content-Type': 'application/json' }
  });
}, undefined, allowAccess);
assert.equal(invalidStatus.status, 409);
assert.equal((await invalidStatus.json()).error, 'invalid_status');

const noAccess = await handleActiveInquiriesRequest(listRequest(), env, fetch, undefined, async () => false);
assert.equal(noAccess.status, 403);

console.log('active-inquiries-api: all tests passed');
