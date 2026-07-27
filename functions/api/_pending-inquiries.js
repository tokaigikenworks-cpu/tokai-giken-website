const SHEETS_TIMEOUT_MS = 10000;
const MAX_PENDING_ITEMS = 100;
let accessKeysCache = null;

const ACCESS_VERIFICATION_REASONS = new Set([
  'missing_access_jwt',
  'missing_authenticated_email',
  'missing_token_email',
  'missing_access_aud',
  'missing_team_domain',
  'invalid_jwt_format',
  'invalid_jwt_header',
  'issuer_mismatch',
  'audience_mismatch',
  'token_expired',
  'token_not_active',
  'email_mismatch',
  'access_cert_fetch_failed',
  'signing_key_not_found',
  'signature_invalid',
  'access_verification_error',
  'access_ok'
]);

export function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export function serverEnvironment(env) {
  return env.CF_PAGES_BRANCH === 'main' ? 'production' : 'preview';
}

function base64UrlBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function parseJwtPart(value) {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
  } catch {
    return null;
  }
}

function accessIssuer(env) {
  const configured = String(env.CF_ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  if (!configured) return '';
  if (/^https:\/\//i.test(configured)) return configured;
  return `https://${configured}.cloudflareaccess.com`;
}

async function accessKey(issuer, kid, fetchImpl) {
  const now = Date.now();
  if (!accessKeysCache || accessKeysCache.issuer !== issuer || accessKeysCache.expiresAt < now) {
    try {
      const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return { ok: false, reason: 'access_cert_fetch_failed' };
      const result = await response.json();
      accessKeysCache = {
        issuer,
        expiresAt: now + (60 * 60 * 1000),
        keys: Array.isArray(result.keys) ? result.keys : []
      };
    } catch {
      return { ok: false, reason: 'access_cert_fetch_failed' };
    }
  }
  const key = accessKeysCache.keys.find((candidate) => candidate.kid === kid) || null;
  return key
    ? { ok: true, key }
    : { ok: false, reason: 'signing_key_not_found' };
}

function accessVerificationResult(ok, reason) {
  return { ok, reason };
}

export async function verifyQueueAccess(request, env = {}, fetchImpl = fetch) {
  const token = String(request.headers.get('Cf-Access-Jwt-Assertion') || '').trim();
  const authenticatedEmail = String(request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  const audience = String(env.CF_ACCESS_AUD || '').trim();
  const issuer = accessIssuer(env);
  if (!token) return accessVerificationResult(false, 'missing_access_jwt');
  if (!audience) return accessVerificationResult(false, 'missing_access_aud');
  if (!issuer) return accessVerificationResult(false, 'missing_team_domain');

  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return accessVerificationResult(false, 'invalid_jwt_format');
  }
  const header = parseJwtPart(parts[0]);
  const payload = parseJwtPart(parts[1]);
  if (!header || header.alg !== 'RS256' || !header.kid) {
    return accessVerificationResult(false, 'invalid_jwt_header');
  }
  if (!payload) return accessVerificationResult(false, 'invalid_jwt_format');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== issuer) return accessVerificationResult(false, 'issuer_mismatch');
  if (!audiences.includes(audience)) return accessVerificationResult(false, 'audience_mismatch');
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) {
    return accessVerificationResult(false, 'token_expired');
  }
  if (payload.nbf != null && !Number.isFinite(Number(payload.nbf))) {
    return accessVerificationResult(false, 'invalid_jwt_format');
  }
  if (payload.nbf != null && Number(payload.nbf) > now + 60) {
    return accessVerificationResult(false, 'token_not_active');
  }

  try {
    const keyResult = await accessKey(issuer, header.kid, fetchImpl);
    if (!keyResult.ok) return accessVerificationResult(false, keyResult.reason);
    const key = await crypto.subtle.importKey(
      'jwk',
      keyResult.key,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const signature = base64UrlBytes(parts[2]);
    const verified = await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      signature,
      signed
    );
    if (!verified) return accessVerificationResult(false, 'signature_invalid');

    const tokenEmail = String(payload.email || '').trim().toLowerCase();
    if (!tokenEmail) {
      return accessVerificationResult(
        false,
        authenticatedEmail ? 'missing_token_email' : 'missing_authenticated_email'
      );
    }
    if (authenticatedEmail && tokenEmail !== authenticatedEmail) {
      return accessVerificationResult(false, 'email_mismatch');
    }
    return accessVerificationResult(true, 'access_ok');
  } catch {
    return accessVerificationResult(false, 'access_verification_error');
  }
}

function normalizedAccessVerification(value) {
  if (value === true) return accessVerificationResult(true, 'access_ok');
  if (value === false || !value || typeof value !== 'object') {
    return accessVerificationResult(false, 'access_verification_error');
  }
  const reason = ACCESS_VERIFICATION_REASONS.has(value.reason)
    ? value.reason
    : 'access_verification_error';
  return accessVerificationResult(value.ok === true, value.ok === true ? 'access_ok' : reason);
}

export async function queueAccessGranted(
  request,
  env = {},
  fetchImpl = fetch,
  accessVerifier = verifyQueueAccess
) {
  let result;
  try {
    result = normalizedAccessVerification(await accessVerifier(request, env, fetchImpl));
  } catch {
    result = accessVerificationResult(false, 'access_verification_error');
  }
  if (!result.ok) console.warn(`access_verification_reason=${result.reason}`);
  return result.ok;
}

function text(value, max = 5000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function stringList(value, maxItems = 20, maxLength = 500) {
  if (Array.isArray(value)) return value.slice(0, maxItems).map((item) => text(item, maxLength)).filter(Boolean);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (Array.isArray(parsed)) return stringList(parsed, maxItems, maxLength);
  } catch {
    // Apps Script may return a comma-separated display value.
  }
  return String(value).split(',').slice(0, maxItems).map((item) => text(item, maxLength)).filter(Boolean);
}

function attachmentList(record) {
  const metadata = Array.isArray(record.attachmentMetadata)
    ? record.attachmentMetadata
    : (Array.isArray(record.attachments) ? record.attachments : []);
  return metadata.slice(0, 20).map((attachment) => ({
    name: text(attachment && attachment.name, 240),
    type: text(attachment && attachment.type, 120),
    size: Number.isFinite(Number(attachment && attachment.size)) ? Number(attachment.size) : 0,
    reference: text(attachment && (attachment.reference || attachment.key || attachment.url || attachment.id), 500)
  })).filter((attachment) => attachment.name || attachment.reference);
}

export function normalizePendingRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const recordId = text(record.recordId, 100);
  if (!recordId) return null;
  const attachments = attachmentList(record);
  const attachmentNames = stringList(record.attachmentNames, 20, 240);
  const attachmentReferences = stringList(record.attachmentReferences, 20, 500);

  return {
    recordId,
    inquiryId: text(record.inquiryId || record.receiptNumber, 100),
    status: text(record.status, 50),
    createdAt: text(record.createdAt, 50),
    updatedAt: text(record.updatedAt, 50),
    inquiryReceivedAt: text(record.inquiryReceivedAt || record.createdAt, 50),
    clientName: text(record.clientName, 100),
    companyName: text(record.companyName, 150),
    email: text(record.email, 254),
    projectName: text(record.projectName, 200),
    inquiryText: text(record.inquiryText, 5000),
    delivery: text(record.delivery, 100),
    notes: text(record.notes, 5000),
    vehicleModel: text(record.vehicleModel, 200),
    budgetRange: text(record.budgetRange, 100),
    purpose: text(record.purpose, 50),
    sourceType: text(record.sourceType, 50),
    fitting: text(record.fitting, 50),
    deliverable: text(record.deliverable, 50),
    safety: text(record.safety, 50),
    rush: text(record.rush, 50),
    attachmentCount: Number.isFinite(Number(record.attachmentCount)) ? Math.max(0, Number(record.attachmentCount)) : Math.max(attachments.length, attachmentNames.length),
    attachmentNames: attachmentNames.length ? attachmentNames : attachments.map((attachment) => attachment.name).filter(Boolean),
    attachmentReferences: attachmentReferences.length ? attachmentReferences : attachments.map((attachment) => attachment.reference).filter(Boolean),
    attachmentMetadata: attachments,
    sourcePage: text(record.sourcePage, 200)
  };
}

function jsonList(value, maxItems = 100) {
  if (Array.isArray(value)) return value.slice(0, maxItems);
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.slice(0, maxItems) : [];
  } catch {
    return [];
  }
}

function numberOrEmpty(value) {
  if (value === '' || value == null) return '';
  return Number.isFinite(Number(value)) ? Number(value) : '';
}

const INTERNAL_NOTE_KEYS = new Set([
  'sourcePage',
  'attachmentTypes',
  'attachmentSizes',
  'attachmentReferences',
  'attachmentNames'
]);

function estimateNotes(record) {
  const savedEstimateNotes = text(record.estimateNotes, 10000);
  if (savedEstimateNotes) return savedEstimateNotes;
  const legacyNotes = text(record.notes, 10000);
  if (!legacyNotes) return '';
  try {
    const parsed = JSON.parse(legacyNotes);
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && Object.keys(parsed).some((key) => INTERNAL_NOTE_KEYS.has(key))
    ) return '';
  } catch {
    return legacyNotes;
  }
  return legacyNotes;
}

export function normalizeActiveRecord(record) {
  const base = normalizePendingRecord(record);
  if (!base) return null;
  return {
    ...base,
    quoteNumber: text(record.quoteNumber, 100),
    estimateProjectName: text(record.estimateProjectName || record.projectName, 200),
    updatedAt: text(record.updatedAt || record.lastSheetSavedAt, 50),
    attachmentCount: Number.isFinite(Number(record.attachmentCount)) ? Math.max(0, Number(record.attachmentCount)) : base.attachmentCount
  };
}

export function normalizeLoadedRecord(record) {
  const base = normalizeActiveRecord(record);
  if (!base) return null;
  const items = jsonList(record.items || record.itemsJson, 200).map((item) => ({
    description: text(item && (item.description || item.name || item.content), 500),
    quantity: numberOrEmpty(item && (item.quantity ?? item.qty)),
    unit: text(item && item.unit, 50),
    price: numberOrEmpty(item && (item.price ?? item.unitPrice))
  }));
  return {
    ...base,
    honorific: text(record.honorific, 20),
    originalProjectName: text(record.originalProjectName, 200),
    estimateInquiryText: text(record.estimateInquiryText || record.inquiryText, 10000),
    estimateDelivery: text(record.estimateDelivery || record.delivery, 200),
    validUntil: text(record.validUntil, 50),
    estimateNotes: estimateNotes(record),
    issueDate: text(record.issueDate, 50),
    localClass: text(record.localClass, 10),
    localReason: text(record.localReason, 5000),
    apiClass: text(record.apiClass, 10),
    comparisonResult: text(record.comparisonResult, 50),
    apiConfidence: numberOrEmpty(record.apiConfidence),
    apiReason: text(record.apiReason, 5000),
    apiWarnings: stringList(record.apiWarnings, 50, 1000),
    finalClass: text(record.finalClass, 10),
    apiModel: text(record.apiModel, 100),
    apiResponseMs: numberOrEmpty(record.apiResponseMs),
    apiTokens: numberOrEmpty(record.apiTokens),
    apiAdopted: record.apiAdopted === true || String(record.apiAdopted).toLowerCase() === 'true',
    items,
    subtotal: numberOrEmpty(record.subtotal),
    taxRate: numberOrEmpty(record.taxRate),
    taxAmount: numberOrEmpty(record.taxAmount ?? record.tax),
    total: numberOrEmpty(record.total),
    paymentType: text(record.paymentType, 50),
    customPayment: text(record.customPayment, 500),
    payment: text(record.payment || record.paymentTerms, 1000),
    paymentNote: text(record.paymentNote || record.paymentSupplement, 3000),
    outputFormat: text(record.outputFormat || record.deliveryFormat, 500),
    quoteClientName: text(record.quoteClientName || record.clientName, 200),
    lastSheetSavedAt: text(record.lastSheetSavedAt || record.updatedAt, 50),
    pdfIssuedAt: text(record.pdfIssuedAt, 50)
  };
}

function pendingTimestamp(record) {
  const value = Date.parse(record.inquiryReceivedAt || record.createdAt || '');
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

export function normalizePendingList(value) {
  const rawItems = value && Array.isArray(value.items) ? value.items : [];
  const items = rawItems
    .map(normalizePendingRecord)
    .filter((record) => record && record.status === '未対応')
    .sort((left, right) => pendingTimestamp(left) - pendingTimestamp(right))
    .slice(0, MAX_PENDING_ITEMS);
  const count = Number.isFinite(Number(value && value.count))
    ? Math.max(items.length, Number(value.count))
    : items.length;
  return { items, count };
}

export function normalizeActiveList(value) {
  const allowedStatuses = new Set(['確認中', '見積作成中']);
  const rawItems = value && Array.isArray(value.items) ? value.items : [];
  const items = rawItems
    .map(normalizeActiveRecord)
    .filter((record) => record && allowedStatuses.has(record.status))
    .sort((left, right) => pendingTimestamp(left) - pendingTimestamp(right))
    .slice(0, MAX_PENDING_ITEMS);
  const count = Number.isFinite(Number(value && value.count))
    ? Math.max(items.length, Number(value.count))
    : items.length;
  return { items, count };
}

export async function postToSheets(env, payload, fetchImpl = fetch, timeoutMs = SHEETS_TIMEOUT_MS) {
  if (!env.SHEETS_WEB_APP_URL || !env.SHEETS_SHARED_SECRET) {
    return { ok: false, error: 'sheets_not_configured', status: 503 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(env.SHEETS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        secret: env.SHEETS_SHARED_SECRET,
        environment: serverEnvironment(env)
      }),
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!response.ok) return { ok: false, error: 'sheets_request_failed', status: 502 };
    let result;
    try {
      result = await response.json();
    } catch {
      return { ok: false, error: 'sheets_request_failed', status: 502 };
    }
    return { ok: true, result };
  } catch {
    return { ok: false, error: 'sheets_request_failed', status: 502 };
  } finally {
    clearTimeout(timer);
  }
}
