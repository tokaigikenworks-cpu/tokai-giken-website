import assert from 'node:assert/strict';
import { verifyQueueAccess } from '../functions/api/_pending-inquiries.js';

const now = Math.floor(Date.now() / 1000);
const base64Url = (value) => Buffer.from(value).toString('base64url');

async function createKeyPair(kid) {
  const pair = await crypto.subtle.generateKey({
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256'
  }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  return { pair, jwk };
}

const primary = await createKeyPair('primary-key');
const alternate = await createKeyPair('alternate-key');

async function signedToken(options = {}) {
  const team = options.team || 'test-team';
  const audience = options.audience || 'test-audience';
  const email = options.email || 'owner@example.com';
  const header = {
    alg: 'RS256',
    kid: options.kid || 'primary-key',
    typ: 'JWT',
    ...(options.header || {})
  };
  const payload = {
    iss: `https://${team}.cloudflareaccess.com`,
    aud: [audience],
    email,
    exp: now + 300,
    ...(options.payload || {})
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    options.signingKey || primary.pair.privateKey,
    new TextEncoder().encode(unsigned)
  );
  return `${unsigned}.${Buffer.from(signature).toString('base64url')}`;
}

function accessRequest(token, email = 'owner@example.com') {
  const headers = {};
  if (token != null) headers['Cf-Access-Jwt-Assertion'] = token;
  if (email != null) headers['Cf-Access-Authenticated-User-Email'] = email;
  return new Request('https://preview.example.test/api/pending-inquiries', { headers });
}

function accessEnv(team = 'test-team', audience = 'test-audience') {
  return {
    CF_ACCESS_TEAM_DOMAIN: team,
    CF_ACCESS_AUD: audience
  };
}

function certResponse(keys = [primary.jwk], status = 200) {
  return new Response(JSON.stringify({ keys }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function expectReason(request, env, reason, fetchImpl = async () => certResponse()) {
  const result = await verifyQueueAccess(request, env, fetchImpl);
  assert.deepEqual(result, { ok: reason === 'access_ok', reason });
}

await expectReason(accessRequest(null), accessEnv(), 'missing_access_jwt');
await expectReason(accessRequest('a.b.c'), accessEnv('test-team', ''), 'missing_access_aud');
await expectReason(accessRequest('a.b.c'), accessEnv('', 'test-audience'), 'missing_team_domain');
await expectReason(accessRequest('not-a-jwt'), accessEnv(), 'invalid_jwt_format');

const invalidHeader = [
  base64Url(JSON.stringify({ alg: 'HS256', kid: 'primary-key' })),
  base64Url(JSON.stringify({})),
  'signature'
].join('.');
await expectReason(accessRequest(invalidHeader), accessEnv(), 'invalid_jwt_header');

await expectReason(
  accessRequest(await signedToken({ team: 'different-team' })),
  accessEnv(),
  'issuer_mismatch'
);
await expectReason(
  accessRequest(await signedToken({ audience: 'different-audience' })),
  accessEnv(),
  'audience_mismatch'
);
await expectReason(
  accessRequest(await signedToken({ payload: { exp: now - 1 } })),
  accessEnv(),
  'token_expired'
);
await expectReason(
  accessRequest(await signedToken({ payload: { nbf: now + 120 } })),
  accessEnv(),
  'token_not_active'
);
await expectReason(
  accessRequest(await signedToken({ email: 'different@example.com' })),
  accessEnv(),
  'email_mismatch'
);

const missingEmailToken = await signedToken({
  team: 'missing-email-team',
  payload: {
    iss: 'https://missing-email-team.cloudflareaccess.com',
    email: null
  }
});
await expectReason(
  accessRequest(missingEmailToken, null),
  accessEnv('missing-email-team'),
  'missing_authenticated_email'
);

const missingTokenEmailWithHeader = await signedToken({
  team: 'missing-token-email-team',
  payload: {
    iss: 'https://missing-token-email-team.cloudflareaccess.com',
    email: null
  }
});
await expectReason(
  accessRequest(missingTokenEmailWithHeader),
  accessEnv('missing-token-email-team'),
  'missing_token_email'
);

const certFailureToken = await signedToken({
  team: 'cert-failure-team',
  payload: { iss: 'https://cert-failure-team.cloudflareaccess.com' }
});
await expectReason(
  accessRequest(certFailureToken),
  accessEnv('cert-failure-team'),
  'access_cert_fetch_failed',
  async () => certResponse([], 503)
);

const missingKeyToken = await signedToken({
  team: 'missing-key-team',
  kid: 'missing-key',
  payload: { iss: 'https://missing-key-team.cloudflareaccess.com' }
});
await expectReason(
  accessRequest(missingKeyToken),
  accessEnv('missing-key-team'),
  'signing_key_not_found'
);

const invalidSignatureToken = await signedToken({
  team: 'invalid-signature-team',
  payload: { iss: 'https://invalid-signature-team.cloudflareaccess.com' },
  signingKey: alternate.pair.privateKey
});
await expectReason(
  accessRequest(invalidSignatureToken),
  accessEnv('invalid-signature-team'),
  'signature_invalid'
);

const validToken = await signedToken({
  team: 'valid-team',
  payload: { iss: 'https://valid-team.cloudflareaccess.com' }
});
await expectReason(
  accessRequest(validToken),
  accessEnv('valid-team'),
  'access_ok'
);

const validTokenWithoutEmailHeader = await signedToken({
  team: 'valid-no-email-header-team',
  payload: { iss: 'https://valid-no-email-header-team.cloudflareaccess.com' }
});
await expectReason(
  accessRequest(validTokenWithoutEmailHeader, null),
  accessEnv('valid-no-email-header-team'),
  'access_ok'
);

console.log('access-verification: all tests passed');
