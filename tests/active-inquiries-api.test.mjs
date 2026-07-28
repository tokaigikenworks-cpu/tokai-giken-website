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
    count: 3,
    items: [
      { recordId: 'newer', status: '見積作成中', inquiryReceivedAt: '2026-07-24T00:00:00Z', quoteNumber: '20260724_1' },
      { recordId: 'awaiting-send', status: '見積提出済み', inquiryReceivedAt: '2026-07-20T00:00:00Z' },
      { recordId: 'sent', status: '見積提出済み', inquiryReceivedAt: '2026-07-19T00:00:00Z', termsSentAt: '2026-07-20T01:00:00Z' },
      { recordId: 'older', status: '確認中', inquiryReceivedAt: '2026-07-21T00:00:00Z', clientName: '古い案件' }
    ]
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(listResponse.status, 200);
const listResult = await listResponse.json();
assert.deepEqual(listResult.items.map((item) => item.recordId), ['awaiting-send', 'older', 'newer']);
assert.equal(listResult.count, 3);
assert.equal(listPayload.action, 'listActiveInquiries');
assert.deepEqual(listPayload.statuses, ['確認中', '見積作成中', '見積提出済み']);
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
      estimateNotes: '',
      notes: '再開テスト用備考',
      itemsJson: JSON.stringify([{ description: '設計費', quantity: 2, unit: '式', price: 50000 }]),
      apiWarnings: JSON.stringify(['取付条件を確認']),
      termsDocumentName: 'トカイ技研 取引条件・免責事項',
      termsVersion: '統合案',
      termsPublishedAt: '2026-07-28',
      termsUrl: 'documents/tokai-giken-terms-2026-07-28.pdf',
      individualConditionsJson: JSON.stringify({ physicalInspection: 'あり' }),
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
assert.equal(loaded.estimateNotes, '再開テスト用備考');
assert.equal(loaded.termsVersion, '統合案');
assert.equal(loaded.individualConditions.physicalInspection, 'あり');
assert.equal(loadPayload.action, 'loadInquiry');
assert.equal(loadPayload.environment, 'preview');

const internalNotes = JSON.stringify({
  sourcePage: '/contact',
  attachmentTypes: ['application/pdf'],
  attachmentSizes: [1200],
  attachmentReferences: ['contacts/older/reference.pdf']
});
const internalNotesResponse = await handleLoadInquiryRequest(loadRequest('internal-notes'), env, async () => {
  return new Response(JSON.stringify({
    ok: true,
    record: {
      recordId: 'internal-notes',
      status: '見積作成中',
      estimateNotes: '',
      notes: internalNotes,
      attachmentNames: JSON.stringify(['reference.pdf']),
      attachmentMetadata: [{
        name: 'reference.pdf',
        type: 'application/pdf',
        size: 1200,
        reference: 'contacts/older/reference.pdf'
      }],
      sourcePage: '/contact'
    }
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
const internalLoaded = (await internalNotesResponse.json()).record;
assert.equal(internalLoaded.estimateNotes, '');
assert.equal(internalLoaded.notes, internalNotes);
assert.deepEqual(internalLoaded.attachmentNames, ['reference.pdf']);
assert.equal(internalLoaded.attachmentMetadata[0].reference, 'contacts/older/reference.pdf');

const missing = await handleLoadInquiryRequest(loadRequest('missing'), env, async () => {
  return new Response(JSON.stringify({ ok: false, error: 'record_not_found' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}, undefined, allowAccess);
assert.equal(missing.status, 404);
assert.equal((await missing.json()).error, 'record_not_found');

const issuedAwaitingSend = await handleLoadInquiryRequest(loadRequest('submitted'), env, async () => {
  return new Response(JSON.stringify({ ok: true, record: { recordId: 'submitted', status: '見積提出済み' } }), {
    headers: { 'Content-Type': 'application/json' }
  });
}, undefined, allowAccess);
assert.equal(issuedAwaitingSend.status, 200);

const invalidStatus = await handleLoadInquiryRequest(loadRequest('submitted-sent'), env, async () => {
  return new Response(JSON.stringify({
    ok: true,
    record: {
      recordId: 'submitted-sent',
      status: '見積提出済み',
      termsSentAt: '2026-07-28T10:00:00Z'
    }
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(invalidStatus.status, 409);
assert.equal((await invalidStatus.json()).error, 'invalid_status');

const noAccess = await handleActiveInquiriesRequest(listRequest(), env, fetch, undefined, async () => false);
assert.equal(noAccess.status, 403);

console.log('active-inquiries-api: all tests passed');
