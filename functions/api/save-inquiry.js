const SHEETS_TIMEOUT_MS = 10000;

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

function text(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function normalizeSourceType(value) {
  if (value === 'ある') return 'cad';
  if (value === 'ない') return 'none';
  return '';
}

function attachmentMetadata(attachments) {
  return attachments.map((attachment) => ({
    name: text(attachment.name, 240),
    type: text(attachment.type, 120),
    size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
    reference: text(attachment.key || attachment.url || attachment.id, 500)
  }));
}

export function createInquiryRecord(inquiry, options = {}) {
  const now = text(options.now || new Date().toISOString(), 40);
  const attachments = attachmentMetadata(Array.isArray(inquiry.attachments) ? inquiry.attachments : []);
  const randomUUID = options.randomUUID || (() => crypto.randomUUID());
  const recordId = randomUUID();
  const projectName = text(inquiry.object, 200) || '問い合わせ案件';
  const notes = JSON.stringify({
    sourcePage: '/contact',
    attachmentTypes: attachments.map((attachment) => attachment.type),
    attachmentSizes: attachments.map((attachment) => attachment.size),
    attachmentReferences: attachments.map((attachment) => attachment.reference).filter(Boolean)
  });

  return {
    recordId,
    inquiryId: text(inquiry.inquiryId, 100),
    createdAt: now,
    updatedAt: now,
    pdfIssuedAt: '',
    status: '未対応',
    quoteNumber: '',
    issueDate: '',
    clientName: text(inquiry.name, 100),
    honorific: '',
    projectName,
    inquiryText: text(inquiry.message, 5000),
    delivery: text(inquiry.deadline, 100),
    validUntil: '',
    notes,
    purpose: '',
    sourceType: normalizeSourceType(text(inquiry.data, 50)),
    fitting: text(inquiry.vehicle, 200) ? 'known' : '',
    deliverable: '',
    safety: '',
    rush: '',
    localClass: '',
    localReason: '',
    apiClass: '',
    comparisonResult: '',
    apiConfidence: '',
    apiReason: '',
    apiWarnings: [],
    finalClass: '',
    apiModel: '',
    apiResponseMs: '',
    apiTokens: '',
    subtotal: 0,
    taxRate: '',
    taxAmount: 0,
    tax: 0,
    total: 0,
    items: [],
    itemsJson: '[]',
    paymentType: '',
    customPayment: '',
    payment: '',
    paymentNote: '',
    paymentTerms: '',
    paymentSupplement: '',
    outputFormat: '',
    deliveryFormat: '',
    email: text(inquiry.email, 254).toLowerCase(),
    companyName: text(inquiry.company, 150),
    vehicleModel: text(inquiry.vehicle, 200),
    budgetRange: text(inquiry.budget, 50),
    attachmentCount: attachments.length,
    attachmentNames: attachments.map((attachment) => attachment.name),
    attachmentMetadata: attachments,
    sourcePage: '/contact',
    inquiryReceivedAt: now
  };
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

export async function saveInquiryRecord(record, env = {}, fetchImpl = fetch, timeoutMs = SHEETS_TIMEOUT_MS) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || !text(record.recordId, 100)) {
    return { ok: false, error: 'invalid_record' };
  }
  if (!env.SHEETS_WEB_APP_URL || !env.SHEETS_SHARED_SECRET) {
    return { ok: false, error: 'sheets_not_configured' };
  }

  const environment = serverEnvironment(env);
  const forwardedRecord = { ...record, environment };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const googleResponse = await fetchImpl(env.SHEETS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveInquiry',
        secret: env.SHEETS_SHARED_SECRET,
        environment,
        record: forwardedRecord
      }),
      signal: controller.signal,
      redirect: 'follow'
    });
    if (!googleResponse.ok) return { ok: false, error: 'sheets_save_failed' };
    let result;
    try {
      result = await googleResponse.json();
    } catch {
      return { ok: false, error: 'sheets_save_failed' };
    }
    if (!validGoogleResponse(result, record.recordId)) return { ok: false, error: 'sheets_save_failed' };
    return {
      ok: true,
      action: result.action,
      recordId: record.recordId,
      savedAt: result.savedAt.trim()
    };
  } catch {
    return { ok: false, error: 'sheets_save_failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSaveInquiryRequest(request, env = {}, fetchImpl = fetch, timeoutMs = SHEETS_TIMEOUT_MS) {
  if (request.method !== 'POST') return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  if (!(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) {
    return jsonResponse({ ok: false, error: 'unsupported_media_type' }, 415);
  }
  if (!env.SHEETS_SHARED_SECRET || request.headers.get('X-Inquiry-Internal-Secret') !== env.SHEETS_SHARED_SECRET) {
    return jsonResponse({ ok: false, error: 'forbidden' }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_json' }, 400);
  }
  if (!payload || typeof payload !== 'object' || !payload.record || typeof payload.record !== 'object' || Array.isArray(payload.record)) {
    return jsonResponse({ ok: false, error: 'invalid_record' }, 400);
  }

  const record = createInquiryRecord(payload.record);
  const result = await saveInquiryRecord(record, env, fetchImpl, timeoutMs);
  if (!result.ok) {
    const status = result.error === 'sheets_not_configured' ? 503 : 502;
    return jsonResponse(result, status);
  }
  return jsonResponse(result, 200);
}

export function onRequest(context) {
  return handleSaveInquiryRequest(context.request, context.env || {}, fetch);
}
