import {
  jsonResponse,
  normalizePendingList,
  postToSheets,
  verifyQueueAccess
} from './_pending-inquiries.js';

export async function handlePendingInquiriesRequest(request, env = {}, fetchImpl = fetch, timeoutMs, accessVerifier = verifyQueueAccess) {
  if (request.method !== 'GET') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!await accessVerifier(request, env)) return jsonResponse({ ok: false, error: 'access_required' }, 403);

  const forwarded = await postToSheets(env, {
    action: 'listPendingInquiries',
    status: '未対応',
    limit: 100
  }, fetchImpl, timeoutMs);
  if (!forwarded.ok) return jsonResponse({ ok: false, error: forwarded.error }, forwarded.status);
  if (!forwarded.result || forwarded.result.ok !== true) {
    return jsonResponse({ ok: false, error: 'sheets_request_failed' }, 502);
  }

  const normalized = normalizePendingList(forwarded.result);
  return jsonResponse({
    ok: true,
    count: normalized.count,
    items: normalized.items,
    fetchedAt: new Date().toISOString()
  }, 200);
}

export function onRequest(context) {
  return handlePendingInquiriesRequest(context.request, context.env || {}, fetch);
}
