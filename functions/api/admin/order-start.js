import {
  jsonResponse,
  normalizeLoadedRecord,
  postToSheets,
  queueAccessGranted,
  verifyQueueAccess
} from '../_pending-inquiries.js';
import { adminTokenMatches } from '../../lib/admin-auth.js';
import { createOrderTransfer, sha256Hex } from '../../lib/order-transfer.js';

function safeRecordId(value) {
  const recordId = String(value ?? '').trim();
  if (!recordId || recordId.length > 160 || !/^[a-zA-Z0-9._-]+$/.test(recordId)) return '';
  return recordId;
}

async function authorized(request, env, fetchImpl, accessVerifier) {
  if (request.headers.get('Cf-Access-Jwt-Assertion')) {
    return queueAccessGranted(request, env, fetchImpl, accessVerifier);
  }
  return Boolean(env.ORDER_START_TOKEN) && adminTokenMatches(request, env.ORDER_START_TOKEN);
}

export function orderTransferInput(record, now = new Date()) {
  const companyName = String(record.companyName || '').trim();
  const customerName = companyName || String(record.quoteClientName || record.clientName || '').trim();
  const details = (Array.isArray(record.items) ? record.items : []).map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.price);
    return {
      description: item.description,
      quantity,
      unit: item.unit,
      unit_price: unitPrice,
      amount: quantity * unitPrice,
      note: item.note || ''
    };
  });
  return {
    status: record.status,
    record_id: record.recordId,
    accepted_at: now.toISOString(),
    customer: {
      customer_type: companyName ? '法人' : '個人',
      customer_name: customerName,
      customer_contact_name: companyName ? record.clientName : '',
      customer_department: record.department || '',
      customer_postal_code: record.postalCode || '',
      customer_address: record.address || '',
      customer_phone: record.phone || '',
      customer_email: record.email || '',
      billing_name: record.quoteClientName || customerName,
      payment_terms: record.payment || ''
    },
    case: {
      project_name: record.estimateProjectName || record.projectName,
      inquiry_summary: record.estimateInquiryText || record.inquiryText,
      requested_delivery_date: record.estimateDelivery || record.delivery || ''
    },
    estimate: {
      estimate_number: record.quoteNumber,
      estimate_date: record.issueDate,
      subtotal: record.subtotal,
      tax_amount: record.taxAmount,
      total_amount: record.total,
      note: record.estimateNotes || ''
    },
    details
  };
}

async function loadAcceptedEstimate(recordId, env, fetchImpl, sheetPoster) {
  const forwarded = await sheetPoster(env, { action: 'loadInquiry', recordId }, fetchImpl);
  if (!forwarded.ok) return { ok: false, status: forwarded.status || 502, error: forwarded.error || 'sheets_request_failed' };
  const result = forwarded.result || {};
  if (result.ok !== true) {
    const notFound = result.error === 'record_not_found';
    return { ok: false, status: notFound ? 404 : 502, error: notFound ? 'record_not_found' : 'sheets_request_failed' };
  }
  const record = normalizeLoadedRecord(result.record);
  if (!record || record.recordId !== recordId) return { ok: false, status: 502, error: 'saved_data_corrupt' };
  return { ok: true, record };
}

export async function handleOrderStartRequest(
  request,
  env = {},
  fetchImpl = fetch,
  accessVerifier = verifyQueueAccess,
  sheetPoster = postToSheets,
  now = () => new Date()
) {
  if (!['GET', 'POST'].includes(request.method)) {
    return jsonResponse({ ok: false, status: 'method_not_allowed' }, 405);
  }
  if (!env.CONTACT_DB) return jsonResponse({ ok: false, status: 'configuration_error' }, 503);
  if (!await authorized(request, env, fetchImpl, accessVerifier)) {
    return jsonResponse({ ok: false, status: 'unauthorized' }, 401);
  }

  if (request.method === 'GET') {
    const recordId = safeRecordId(new URL(request.url).searchParams.get('record_id'));
    if (!recordId) return jsonResponse({ ok: false, status: 'invalid_record_id' }, 400);
    const existing = await env.CONTACT_DB.prepare(
      'SELECT record_id, transfer_status FROM order_transfers WHERE record_id = ?1'
    ).bind(recordId).first();
    return jsonResponse({ ok: true, record_id: recordId, status: existing?.transfer_status || 'not_started' }, 200);
  }

  if (!env.ORDER_IMPORTS || !env.SHEETS_WEB_APP_URL || !env.SHEETS_SHARED_SECRET) {
    return jsonResponse({ ok: false, status: 'configuration_error' }, 503);
  }
  const declaredSize = Number(request.headers.get('content-length') || 0);
  if (declaredSize > 64 * 1024) return jsonResponse({ ok: false, status: 'payload_too_large' }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, status: 'invalid_json' }, 400);
  }
  const recordId = safeRecordId(body && (body.recordId || body.record_id));
  if (!recordId) return jsonResponse({ ok: false, status: 'invalid_record_id' }, 400);

  const existing = await env.CONTACT_DB.prepare(
    'SELECT record_id, transfer_status FROM order_transfers WHERE record_id = ?1'
  ).bind(recordId).first();
  if (existing) {
    return jsonResponse({ ok: false, status: 'already_processed', record_id: recordId }, 409);
  }

  const loaded = await loadAcceptedEstimate(recordId, env, fetchImpl, sheetPoster);
  if (!loaded.ok) return jsonResponse({ ok: false, status: loaded.error }, loaded.status);

  let transfer;
  try {
    transfer = createOrderTransfer(orderTransferInput(loaded.record, now()), now());
  } catch (error) {
    const reason = String(error && error.message || 'validation_error');
    const status = reason === 'contract_not_confirmed' ? 'contract_not_confirmed' : 'validation_error';
    return jsonResponse({ ok: false, status, reason }, status === 'contract_not_confirmed' ? 409 : 422);
  }

  const payload = JSON.stringify(transfer, null, 2);
  const payloadHash = await sha256Hex(payload);
  const objectKey = `order_import/inbox/${recordId}.json`;
  const createdAt = now().toISOString();
  const inserted = await env.CONTACT_DB.prepare(`INSERT OR IGNORE INTO order_transfers
    (record_id, accepted_at, created_at, transfer_status, object_key, payload_sha256)
    VALUES (?1, ?2, ?3, 'creating', ?4, ?5)`)
    .bind(recordId, transfer.source.accepted_at, createdAt, objectKey, payloadHash)
    .run();
  if (!inserted.meta?.changes) {
    return jsonResponse({ ok: false, status: 'already_processed', record_id: recordId }, 409);
  }

  try {
    await env.ORDER_IMPORTS.put(objectKey, payload, {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { recordId, schemaVersion: transfer.schema_version, sha256: payloadHash }
    });
    await env.CONTACT_DB.prepare(
      "UPDATE order_transfers SET transfer_status = 'ready' WHERE record_id = ?1"
    ).bind(recordId).run();
  } catch (error) {
    await Promise.allSettled([
      env.ORDER_IMPORTS.delete(objectKey),
      env.CONTACT_DB.prepare('DELETE FROM order_transfers WHERE record_id = ?1').bind(recordId).run()
    ]);
    console.error('order-start failed', { recordId, error: String(error) });
    return jsonResponse({ ok: false, status: 'storage_error', record_id: recordId }, 502);
  }

  return jsonResponse({
    ok: true,
    status: 'ready',
    record_id: recordId,
    object_key: objectKey,
    sha256: payloadHash
  }, 201);
}

export function onRequest(context) {
  return handleOrderStartRequest(context.request, context.env || {}, fetch);
}
