import assert from 'node:assert/strict';
import { handlePendingInquiriesRequest } from '../functions/api/pending-inquiries.js';
import { handleClaimInquiryRequest } from '../functions/api/claim-inquiry.js';
import { verifyQueueAccess } from '../functions/api/_pending-inquiries.js';

const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'test-jwt',
  'Cf-Access-Authenticated-User-Email': 'owner@example.com'
};
const env = {
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp',
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'shared-secret'
};
const allowAccess = async () => true;

const base64Url = (value) => Buffer.from(value).toString('base64url');
const accessKeys = await crypto.subtle.generateKey({
  name: 'RSASSA-PKCS1-v1_5',
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: 'SHA-256'
}, true, ['sign', 'verify']);
const accessJwk = await crypto.subtle.exportKey('jwk', accessKeys.publicKey);
accessJwk.kid = 'test-key';
accessJwk.alg = 'RS256';
const accessHeader = base64Url(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' }));
const accessPayload = base64Url(JSON.stringify({
  iss: 'https://test-team.cloudflareaccess.com',
  aud: ['test-audience'],
  email: 'owner@example.com',
  exp: Math.floor(Date.now() / 1000) + 300
}));
const accessUnsigned = `${accessHeader}.${accessPayload}`;
const accessSignature = await crypto.subtle.sign(
  { name: 'RSASSA-PKCS1-v1_5' },
  accessKeys.privateKey,
  new TextEncoder().encode(accessUnsigned)
);
const accessToken = `${accessUnsigned}.${Buffer.from(accessSignature).toString('base64url')}`;
const verifiedAccess = await verifyQueueAccess(new Request('https://preview.example.test/api/pending-inquiries', {
  headers: {
    'Cf-Access-Jwt-Assertion': accessToken,
    'Cf-Access-Authenticated-User-Email': 'owner@example.com'
  }
}), {
  CF_ACCESS_TEAM_DOMAIN: 'test-team',
  CF_ACCESS_AUD: 'test-audience'
}, async () => new Response(JSON.stringify({ keys: [accessJwk] }), {
  headers: { 'Content-Type': 'application/json' }
}));
assert.equal(verifiedAccess, true);

const pendingRequest = (headers = accessHeaders) => new Request('https://preview.example.test/api/pending-inquiries', {
  method: 'GET',
  headers
});
const claimRequest = (body, headers = accessHeaders) => new Request('https://preview.example.test/api/claim-inquiry', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

let listPayload;
const listResponse = await handlePendingInquiriesRequest(pendingRequest(), env, async (_url, options) => {
  listPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    count: 2,
    items: [
      {
        recordId: 'record-newer',
        inquiryId: 'TG-NEWER',
        status: '未対応',
        inquiryReceivedAt: '2026-07-23T10:00:00.000Z',
        clientName: '新しい案件',
        attachmentNames: '["new.step"]'
      },
      {
        recordId: 'record-started',
        status: '確認中',
        inquiryReceivedAt: '2026-07-21T10:00:00.000Z'
      },
      {
        recordId: 'record-older',
        inquiryId: 'TG-OLDER',
        status: '未対応',
        inquiryReceivedAt: '2026-07-22T10:00:00.000Z',
        clientName: '古い案件',
        companyName: 'テスト会社',
        attachmentMetaJson: '[]',
        attachmentMetadata: [{ name: 'old.pdf', size: 123, reference: 'contacts/old.pdf' }]
      }
    ]
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(listResponse.status, 200);
const listResult = await listResponse.json();
assert.equal(listResult.count, 2);
assert.deepEqual(listResult.items.map((item) => item.recordId), ['record-older', 'record-newer']);
assert.equal(listResult.items[0].attachmentReferences[0], 'contacts/old.pdf');
assert.equal(listPayload.action, 'listPendingInquiries');
assert.equal(listPayload.environment, 'preview');
assert.equal(listPayload.secret, 'shared-secret');

const noAccess = await handlePendingInquiriesRequest(pendingRequest({}), env, async () => {
  throw new Error('must not call Sheets without Access');
}, undefined, async () => false);
assert.equal(noAccess.status, 403);
assert.equal((await noAccess.json()).error, 'access_required');

const wrongListMethod = await handlePendingInquiriesRequest(new Request('https://preview.example.test/api/pending-inquiries', {
  method: 'POST',
  headers: accessHeaders
}), env);
assert.equal(wrongListMethod.status, 405);

let claimPayload;
const claimResponse = await handleClaimInquiryRequest(claimRequest({ recordId: 'record-older' }), env, async (_url, options) => {
  claimPayload = JSON.parse(options.body);
  return new Response(JSON.stringify({
    ok: true,
    action: 'claimed',
    record: {
      recordId: 'record-older',
      inquiryId: 'TG-OLDER',
      status: '確認中',
      inquiryReceivedAt: '2026-07-22T10:00:00.000Z',
      clientName: '古い案件'
    }
  }), { headers: { 'Content-Type': 'application/json' } });
}, undefined, allowAccess);
assert.equal(claimResponse.status, 200);
assert.equal((await claimResponse.json()).record.status, '確認中');
assert.equal(claimPayload.action, 'claimInquiry');
assert.equal(claimPayload.environment, 'preview');
assert.equal(claimPayload.expectedStatus, '未対応');
assert.equal(claimPayload.nextStatus, '確認中');

const conflict = await handleClaimInquiryRequest(claimRequest({ recordId: 'record-older' }), env, async () => {
  return new Response(JSON.stringify({ ok: false, error: 'already_claimed', status: '確認中' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}, undefined, allowAccess);
assert.equal(conflict.status, 409);
assert.deepEqual(await conflict.json(), { ok: false, error: 'already_claimed', status: '確認中' });

const invalidClaim = await handleClaimInquiryRequest(claimRequest({ recordId: '' }), env, fetch, undefined, allowAccess);
assert.equal(invalidClaim.status, 400);

const productionPayloadResponse = await handlePendingInquiriesRequest(pendingRequest(), {
  ...env,
  CF_PAGES_BRANCH: 'main'
}, async (_url, options) => {
  assert.equal(JSON.parse(options.body).environment, 'production');
  return new Response(JSON.stringify({ ok: true, count: 0, items: [] }), {
    headers: { 'Content-Type': 'application/json' }
  });
}, undefined, allowAccess);
assert.equal(productionPayloadResponse.status, 200);

const timeoutResponse = await handlePendingInquiriesRequest(pendingRequest(), env, (_url, options) => {
  return new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
}, 5, allowAccess);
assert.equal(timeoutResponse.status, 502);
assert.equal((await timeoutResponse.json()).error, 'sheets_request_failed');

console.log('pending-inquiries-api: all tests passed');
