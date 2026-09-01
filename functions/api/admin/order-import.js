import { jsonResponse } from '../_pending-inquiries.js';
import { adminTokenMatches } from '../../lib/admin-auth.js';

const PREFIXES = {
  ready: 'order_import/inbox/',
  processed: 'order_import/processed/',
  pending: 'order_import/pending/',
  error: 'order_import/error/'
};

function safeRecordId(value) {
  const recordId = String(value ?? '').trim();
  if (!recordId || recordId.length > 160 || !/^[a-zA-Z0-9._-]+$/.test(recordId)) return '';
  return recordId;
}

async function authorize(request, env) {
  return env.ORDER_START_TOKEN && adminTokenMatches(request, env.ORDER_START_TOKEN);
}

async function listInbox(env) {
  const items = [];
  let cursor;
  do {
    const page = await env.ORDER_IMPORTS.list({ prefix: PREFIXES.ready, cursor, limit: 1000, include: ['customMetadata'] });
    page.objects.forEach((object) => {
      if (!object.key.endsWith('.json')) return;
      items.push({
        record_id: object.customMetadata?.recordId || object.key.slice(PREFIXES.ready.length, -5),
        key: object.key,
        size: object.size,
        uploaded: object.uploaded
      });
    });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return items;
}

async function moveObject(env, recordId, result, reason) {
  const sourceKey = `${PREFIXES.ready}${recordId}.json`;
  const destinationKey = `${PREFIXES[result]}${recordId}.json`;
  const source = await env.ORDER_IMPORTS.get(sourceKey);
  if (!source) {
    const existing = await env.ORDER_IMPORTS.head(destinationKey);
    return existing ? { status: 'already_moved', key: destinationKey } : null;
  }

  const metadata = { ...(source.customMetadata || {}) };
  if (reason) metadata.resultReason = String(reason).slice(0, 500);
  await env.ORDER_IMPORTS.put(destinationKey, source.body, {
    httpMetadata: source.httpMetadata,
    customMetadata: metadata
  });
  await env.ORDER_IMPORTS.delete(sourceKey);
  await env.CONTACT_DB.prepare(`UPDATE order_transfers
    SET transfer_status = ?1, object_key = ?2, processed_at = ?3, result_reason = ?4
    WHERE record_id = ?5`)
    .bind(result, destinationKey, new Date().toISOString(), String(reason || '').slice(0, 500), recordId)
    .run();
  return { status: result, key: destinationKey };
}

export async function onRequest({ request, env }) {
  if (!env.ORDER_IMPORTS || !env.CONTACT_DB || !env.ORDER_START_TOKEN) {
    return jsonResponse({ ok: false, status: 'configuration_error' }, 503);
  }
  if (!await authorize(request, env)) return jsonResponse({ ok: false, status: 'unauthorized' }, 401);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const recordIdValue = url.searchParams.get('record_id');
    if (!recordIdValue) return jsonResponse({ ok: true, items: await listInbox(env) }, 200);
    const recordId = safeRecordId(recordIdValue);
    if (!recordId) return jsonResponse({ ok: false, status: 'invalid_record_id' }, 400);
    const object = await env.ORDER_IMPORTS.get(`${PREFIXES.ready}${recordId}.json`);
    if (!object) return jsonResponse({ ok: false, status: 'not_found', record_id: recordId }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-record-id': recordId
      }
    });
  }

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ ok: false, status: 'invalid_json' }, 400); }
    const recordId = safeRecordId(body.record_id);
    const result = String(body.result || '');
    if (!recordId) return jsonResponse({ ok: false, status: 'invalid_record_id' }, 400);
    if (!['processed', 'pending', 'error'].includes(result)) return jsonResponse({ ok: false, status: 'invalid_result' }, 400);
    const moved = await moveObject(env, recordId, result, body.reason);
    if (!moved) return jsonResponse({ ok: false, status: 'not_found', record_id: recordId }, 404);
    return jsonResponse({ ok: true, record_id: recordId, ...moved }, 200);
  }

  return jsonResponse({ ok: false, status: 'method_not_allowed' }, 405);
}
