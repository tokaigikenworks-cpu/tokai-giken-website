import assert from 'node:assert/strict';
import { handleVerifyEstimateRequest } from '../functions/api/verify-estimate.js';

const env = {
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp',
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'shared-secret'
};
const allowAccess = async () => true;
const headers = {
  'Cf-Access-Jwt-Assertion': 'test-jwt',
  'Cf-Access-Authenticated-User-Email': 'owner@example.com',
  'Content-Type': 'application/json'
};
const request = (body, method = 'POST') => new Request('https://preview.example.test/api/verify-estimate', {
  method,
  headers,
  body: method === 'POST' ? JSON.stringify(body) : undefined
});

let forwarded;
const verifiedResponse = await handleVerifyEstimateRequest(request({
  recordId: 'record-1',
  quoteNumber: '20260726_1'
}), env, async (_url, options) => {
  forwarded = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    record: {
      recordId: 'record-1',
      status: '見積提出済み',
      pdfIssuedAt: '2026-07-26T06:00:00.000Z',
      quoteNumber: '20260726_1',
      updatedAt: '2026-07-26T06:00:01.000Z'
    }
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(verifiedResponse.status, 200);
const verified = await verifiedResponse.json();
assert.equal(verified.verified, true);
assert.equal(verified.record.recordId, 'record-1');
assert.equal(verified.record.status, '見積提出済み');
assert.equal(forwarded.action, 'verifyEstimateIssue');
assert.equal(forwarded.recordId, 'record-1');
assert.equal(forwarded.environment, 'preview');

const mismatchResponse = await handleVerifyEstimateRequest(request({
  recordId: 'record-1',
  quoteNumber: '20260726_2'
}), env, async () => new Response(JSON.stringify({
  ok: true,
  record: {
    recordId: 'record-1',
    status: '見積提出済み',
    pdfIssuedAt: '2026-07-26T06:00:00.000Z',
    quoteNumber: '20260726_1'
  }
})), undefined, allowAccess);
assert.equal(mismatchResponse.status, 200);
assert.equal((await mismatchResponse.json()).verified, false);

const missingResponse = await handleVerifyEstimateRequest(request({
  recordId: 'missing',
  quoteNumber: '20260726_1'
}), env, async () => new Response(JSON.stringify({ ok: false, error: 'record_not_found' })), undefined, allowAccess);
assert.equal(missingResponse.status, 404);
assert.equal((await missingResponse.json()).error, 'record_not_found');

assert.equal((await handleVerifyEstimateRequest(request({}, 'GET'), env, fetch, undefined, allowAccess)).status, 405);
assert.equal((await handleVerifyEstimateRequest(request({ recordId: '', quoteNumber: '' }), env, fetch, undefined, allowAccess)).status, 400);
assert.equal((await handleVerifyEstimateRequest(request({ recordId: 'record-1', quoteNumber: '20260726_1' }), env, fetch, undefined, async () => false)).status, 403);

console.log('verify-estimate-api: all tests passed');
