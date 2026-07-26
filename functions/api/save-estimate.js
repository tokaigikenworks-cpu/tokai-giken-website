import { queryVerifiedEstimateIssue } from './verify-estimate.js';

const SHEETS_TIMEOUT_MS = 10000;
const VERIFY_TIMEOUT_MS = 6000;

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function serverEnvironment(env) {
  return env.CF_PAGES_BRANCH === 'main' ? 'production' : 'preview';
}

function validGoogleResponse(value, expectedRecordId) {
  return value
    && typeof value === 'object'
    && value.ok === true
    && (value.action === 'created' || value.action === 'updated')
    && String(value.recordId || '') === expectedRecordId
    && typeof value.savedAt === 'string'
    && value.savedAt.trim();
}

export async function handleSaveEstimateRequest(request, env = {}, fetchImpl = fetch, timeoutMs = SHEETS_TIMEOUT_MS) {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }
  if (!payload || typeof payload !== 'object' || !payload.record || typeof payload.record !== 'object' || Array.isArray(payload.record)) {
    return jsonResponse({ ok: false, error: 'invalid_record' }, 400);
  }
  const recordId = String(payload.record.recordId || '').trim();
  const quoteNumber = String(payload.record.quoteNumber || '').trim();
  if (!recordId) {
    return jsonResponse({ ok: false, error: 'invalid_record_id' }, 400);
  }
  if (!env.SHEETS_WEB_APP_URL || !env.SHEETS_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'sheets_not_configured' }, 503);
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  const verifyUncertainSave = async function () {
    if (!quoteNumber || payload.record.status !== '見積提出済み') return null;
    const verification = await queryVerifiedEstimateIssue(
      env,
      recordId,
      quoteNumber,
      fetchImpl,
      Math.min(timeoutMs, VERIFY_TIMEOUT_MS)
    );
    if (!verification.ok || !verification.verified) return null;
    return jsonResponse({
      ok: true,
      action: 'verified',
      recordId,
      savedAt: verification.record.savedAt || verification.record.pdfIssuedAt,
      verified: true
    }, 200);
  };
  try {
    const googleResponse = await fetchImpl(env.SHEETS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.SHEETS_SHARED_SECRET,
        environment: serverEnvironment(env),
        record: payload.record
      }),
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!googleResponse.ok) {
      return await verifyUncertainSave()
        || jsonResponse({ ok: false, error: 'sheets_save_failed' }, 502);
    }
    let result;
    try {
      result = await googleResponse.json();
    } catch (error) {
      return await verifyUncertainSave()
        || jsonResponse({ ok: false, error: 'sheets_save_failed' }, 502);
    }
    if (result && result.ok === false && result.error === 'update_conflict') {
      return jsonResponse({
        ok: false,
        error: 'update_conflict',
        latestUpdatedAt: String(result.latestUpdatedAt || '')
      }, 409);
    }
    if (!validGoogleResponse(result, recordId)) {
      return await verifyUncertainSave()
        || jsonResponse({ ok: false, error: 'sheets_save_failed' }, 502);
    }
    return jsonResponse({
      ok: true,
      action: result.action,
      recordId,
      savedAt: result.savedAt.trim()
    }, 200);
  } catch (error) {
    return await verifyUncertainSave()
      || jsonResponse({ ok: false, error: 'sheets_save_failed' }, 502);
  } finally {
    clearTimeout(timer);
  }
}

export function onRequest(context) {
  return handleSaveEstimateRequest(context.request, context.env || {}, fetch);
}
