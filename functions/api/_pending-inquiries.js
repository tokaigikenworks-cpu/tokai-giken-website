const SHEETS_TIMEOUT_MS = 10000;
const MAX_PENDING_ITEMS = 100;
let accessKeysCache = null;

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
    const response = await fetchImpl(`${issuer}/cdn-cgi/access/certs`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return null;
    const result = await response.json();
    accessKeysCache = {
      issuer,
      expiresAt: now + (60 * 60 * 1000),
      keys: Array.isArray(result.keys) ? result.keys : []
    };
  }
  return accessKeysCache.keys.find((key) => key.kid === kid) || null;
}

export async function verifyQueueAccess(request, env = {}, fetchImpl = fetch) {
  const token = String(request.headers.get('Cf-Access-Jwt-Assertion') || '').trim();
  const authenticatedEmail = String(request.headers.get('Cf-Access-Authenticated-User-Email') || '').trim().toLowerCase();
  const audience = String(env.CF_ACCESS_AUD || '').trim();
  const issuer = accessIssuer(env);
  if (!token || !authenticatedEmail || !audience || !issuer) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const header = parseJwtPart(parts[0]);
  const payload = parseJwtPart(parts[1]);
  if (!header || !payload || header.alg !== 'RS256' || !header.kid) return false;

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== issuer || !audiences.includes(audience)) return false;
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= now) return false;
  if (payload.nbf != null && Number(payload.nbf) > now + 60) return false;
  if (String(payload.email || '').trim().toLowerCase() !== authenticatedEmail) return false;

  try {
    const jwk = await accessKey(issuer, header.kid, fetchImpl);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    return await crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      base64UrlBytes(parts[2]),
      signed
    );
  } catch {
    return false;
  }
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
