import {
  jsonResponse,
  normalizeLoadedRecord,
  postToSheets,
  verifyQueueAccess
} from './_pending-inquiries.js';

const VERIFY_TIMEOUT_MS = 6000;

function text(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export async function queryVerifiedEstimateIssue(
  env,
  recordId,
  quoteNumber,
  fetchImpl = fetch,
  timeoutMs = VERIFY_TIMEOUT_MS
) {
  const forwarded = await postToSheets(env, {
    action: 'verifyEstimateIssue',
    recordId
  }, fetchImpl, timeoutMs);
  if (!forwarded.ok) return { ok: false, error: forwarded.error, status: forwarded.status };

  const result = forwarded.result || {};
  if (result.ok !== true || !result.record) {
    return { ok: false, error: result.error || 'record_not_found', status: result.error === 'record_not_found' ? 404 : 502 };
  }
  const record = normalizeLoadedRecord(result.record);
  if (!record || record.recordId !== recordId) {
    return { ok: false, error: 'saved_data_corrupt', status: 502 };
  }
  const verified = record.status === '見積提出済み'
    && Boolean(record.pdfIssuedAt)
    && record.quoteNumber === quoteNumber;
  return {
    ok: true,
    verified,
    record: {
      recordId: record.recordId,
      status: record.status,
      pdfIssuedAt: record.pdfIssuedAt,
      quoteNumber: record.quoteNumber,
      savedAt: record.lastSheetSavedAt || record.updatedAt || record.pdfIssuedAt
    }
  };
}

export async function handleVerifyEstimateRequest(
  request,
  env = {},
  fetchImpl = fetch,
  timeoutMs,
  accessVerifier = verifyQueueAccess
) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await accessVerifier(request, env)) return jsonResponse({ ok: false, error: 'access_required' }, 403);
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return jsonResponse({ ok: false, error: 'unsupported_media_type' }, 415);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }
  const recordId = text(payload && payload.recordId, 100);
  const quoteNumber = text(payload && payload.quoteNumber, 100);
  if (!recordId || !quoteNumber) return jsonResponse({ ok: false, error: 'invalid_request' }, 400);

  const verification = await queryVerifiedEstimateIssue(env, recordId, quoteNumber, fetchImpl, timeoutMs);
  if (!verification.ok) {
    return jsonResponse({ ok: false, error: verification.error }, verification.status || 502);
  }
  return jsonResponse({
    ok: true,
    verified: verification.verified,
    record: verification.record
  }, 200);
}

export function onRequest(context) {
  return handleVerifyEstimateRequest(context.request, context.env || {}, fetch);
}
