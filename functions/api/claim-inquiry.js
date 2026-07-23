import {
  jsonResponse,
  normalizePendingRecord,
  postToSheets,
  verifyQueueAccess
} from './_pending-inquiries.js';

export async function handleClaimInquiryRequest(request, env = {}, fetchImpl = fetch, timeoutMs, accessVerifier = verifyQueueAccess) {
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
    action: 'claimInquiry',
    recordId,
    expectedStatus: '未対応',
    nextStatus: '確認中'
  }, fetchImpl, timeoutMs);
  if (!forwarded.ok) return jsonResponse({ ok: false, error: forwarded.error }, forwarded.status);

  const result = forwarded.result || {};
  if (result.ok !== true) {
    const conflict = result.error === 'already_claimed' || result.error === 'status_conflict';
    return jsonResponse({
      ok: false,
      error: conflict ? 'already_claimed' : 'sheets_request_failed',
      status: String(result.status || '')
    }, conflict ? 409 : 502);
  }
  const record = normalizePendingRecord(result.record);
  if (!record || record.recordId !== recordId || record.status !== '確認中') {
    return jsonResponse({ ok: false, error: 'sheets_request_failed' }, 502);
  }

  return jsonResponse({ ok: true, action: 'claimed', record }, 200);
}

export function onRequest(context) {
  return handleClaimInquiryRequest(context.request, context.env || {}, fetch);
}
