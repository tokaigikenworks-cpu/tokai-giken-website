import {
  jsonResponse,
  normalizeLoadedRecord,
  postToSheets,
  verifyQueueAccess
} from './_pending-inquiries.js';

const ACTIVE_STATUSES = new Set(['確認中', '見積作成中']);

export async function handleLoadInquiryRequest(request, env = {}, fetchImpl = fetch, timeoutMs, accessVerifier = verifyQueueAccess) {
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
  const recordId = String(payload && payload.recordId || '').trim().slice(0, 100);
  if (!recordId) return jsonResponse({ ok: false, error: 'invalid_record_id' }, 400);

  const forwarded = await postToSheets(env, {
    action: 'loadInquiry',
    recordId
  }, fetchImpl, timeoutMs);
  if (!forwarded.ok) return jsonResponse({ ok: false, error: forwarded.error }, forwarded.status);
  const result = forwarded.result || {};
  if (result.ok !== true) {
    const notFound = result.error === 'record_not_found';
    return jsonResponse({ ok: false, error: notFound ? 'record_not_found' : 'sheets_request_failed' }, notFound ? 404 : 502);
  }
  const record = normalizeLoadedRecord(result.record);
  if (!record || record.recordId !== recordId) {
    return jsonResponse({ ok: false, error: 'saved_data_corrupt' }, 502);
  }
  if (!ACTIVE_STATUSES.has(record.status)) {
    return jsonResponse({ ok: false, error: 'invalid_status', status: record.status }, 409);
  }
  return jsonResponse({ ok: true, record }, 200);
}

export function onRequest(context) {
  return handleLoadInquiryRequest(context.request, context.env || {}, fetch);
}
