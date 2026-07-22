import { createInquiryRecord, saveInquiryRecord } from './save-inquiry.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 20 * 1024 * 1024;
const MAX_FILE_COUNT = 10;
const RATE_LIMIT_WINDOW = 10 * 60;
const RATE_LIMIT_MAX = 5;

const FILE_TYPES = {
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heic', 'image/heif'],
  pdf: ['application/pdf'],
  stl: ['model/stl', 'application/sla', 'application/vnd.ms-pki.stl', 'application/octet-stream'],
  step: ['model/step', 'application/step', 'application/octet-stream'],
  stp: ['model/step', 'application/step', 'application/octet-stream']
};

const text = (form, name, max = 1000) => String(form.get(name) || '').trim().slice(0, max);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function allowedOrigin(request, configuredOrigins) {
  const origin = request.headers.get('Origin');
  if (!origin || !configuredOrigins) return false;
  return configuredOrigins.split(',').map((value) => value.trim()).includes(origin);
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function enforceRateLimit(request, kv) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const bucket = Math.floor(Date.now() / (RATE_LIMIT_WINDOW * 1000));
  const key = `contact:${await hash(ip)}:${bucket}`;
  const count = Number(await kv.get(key) || 0);
  if (count >= RATE_LIMIT_MAX) return false;
  await kv.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW * 2 });
  return true;
}

function fileExtension(name) {
  return name.toLowerCase().split('.').pop() || '';
}

async function signatureMatches(file, extension) {
  if (['stl', 'step', 'stp'].includes(extension)) return true;
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...bytes);
  if (['jpg', 'jpeg'].includes(extension)) return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === 'png') return bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10';
  if (extension === 'webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (extension === 'pdf') return ascii.startsWith('%PDF-');
  if (['heic', 'heif'].includes(extension)) return ascii.slice(4, 8) === 'ftyp';
  return false;
}

async function validateFiles(files) {
  if (files.length > MAX_FILE_COUNT) throw new Error('添付ファイルは10点以内にしてください。');
  let total = 0;
  for (const file of files) {
    total += file.size;
    const extension = fileExtension(file.name);
    const mimeTypes = FILE_TYPES[extension];
    if (!mimeTypes || !mimeTypes.includes(file.type)) throw new Error(`許可されていないファイル形式です：${file.name}`);
    if (file.size > MAX_FILE_SIZE) throw new Error(`1ファイルの上限は10MBです：${file.name}`);
    if (!(await signatureMatches(file, extension))) throw new Error(`ファイル内容を確認できませんでした：${file.name}`);
  }
  if (total > MAX_TOTAL_SIZE) throw new Error('添付ファイルの合計上限は20MBです。');
}

function safeFileName(name) {
  const cleaned = name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.slice(-120) || 'attachment';
}

async function sendNotification(env, inquiry, fetchImpl = fetch) {
  const body = [
    `受付番号: ${inquiry.inquiryId}`,
    `受付日時: ${inquiry.receivedAt}`,
    `名前: ${inquiry.name}`,
    `会社名: ${inquiry.company || '未入力'}`,
    `メール: ${inquiry.email}`,
    `希望納期: ${inquiry.deadline || '未入力'}`,
    `対象物: ${inquiry.object || '未入力'}`,
    `車種・型式: ${inquiry.vehicle || '未入力'}`,
    `予算感: ${inquiry.budget || '未入力'}`,
    `3Dデータ: ${inquiry.data || '未入力'}`,
    `添付: ${inquiry.attachments.length}件`,
    ...inquiry.attachments.map((attachment) => `  - ${attachment.name} (${attachment.key})`),
    '',
    inquiry.message
  ].join('\n');

  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.CONTACT_FROM,
      to: env.CONTACT_NOTIFICATION_TO.split(',').map((value) => value.trim()),
      reply_to: inquiry.email,
      subject: `【トカイ技研】新しい相談 ${inquiry.inquiryId}`,
      text: body
    })
  });

  if (!response.ok) throw new Error(`Notification failed: ${response.status}`);
}

export async function handleContactRequest(context, dependencies = {}) {
  const { request, env } = context;
  const fetchImpl = dependencies.fetch || fetch;
  if (request.method !== 'POST') return json({ ok: false, message: 'Method not allowed.' }, 405);

  const requiredBindings = ['CONTACT_DB', 'CONTACT_RATE_LIMIT', 'RESEND_API_KEY', 'CONTACT_NOTIFICATION_TO', 'CONTACT_FROM', 'ALLOWED_ORIGIN'];
  const missing = requiredBindings.filter((name) => !env[name]);
  if (missing.length) return json({ ok: false, message: '問い合わせ受付の本番設定が完了していません。' }, 503);
  if (!allowedOrigin(request, env.ALLOWED_ORIGIN)) return json({ ok: false, message: '送信元を確認できませんでした。' }, 403);
  if (!(await enforceRateLimit(request, env.CONTACT_RATE_LIMIT))) return json({ ok: false, message: '送信回数が上限に達しました。時間をおいて再度お試しください。' }, 429);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, message: '送信内容を読み取れませんでした。' }, 400);
  }

  if (text(form, 'website', 200)) return json({ ok: true });

  const inquiry = {
    submissionToken: text(form, 'submission_token', 64),
    name: text(form, 'name', 100),
    company: text(form, 'company', 150),
    email: text(form, 'email', 254).toLowerCase(),
    deadline: text(form, 'deadline', 100),
    message: text(form, 'message', 5000),
    object: text(form, 'object', 200),
    vehicle: text(form, 'vehicle', 200),
    budget: text(form, 'budget', 50),
    data: text(form, 'data', 50)
  };

  if (!/^[0-9a-f-]{36}$/i.test(inquiry.submissionToken)) return json({ ok: false, message: '送信情報を更新してから再度お試しください。' }, 400);
  if (!inquiry.name || !inquiry.message || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) {
    return json({ ok: false, message: '必須項目の内容を確認してください。' }, 400);
  }

  const files = form.getAll('attachment').filter((item) => item instanceof File && item.size > 0);
  try {
    await validateFiles(files);
  } catch (error) {
    return json({ ok: false, message: error.message }, 400);
  }
  if (files.length && !env.CONTACT_FILES) return json({ ok: false, message: '添付ファイル受付の本番設定が完了していません。' }, 503);

  const existing = await env.CONTACT_DB.prepare('SELECT inquiry_id, status FROM inquiries WHERE submission_token = ?1')
    .bind(inquiry.submissionToken)
    .first();
  if (existing) {
    if (existing.status === 'notified') return json({ ok: true, inquiryId: existing.inquiry_id });
    return json({
      ok: false,
      inquiryId: existing.inquiry_id,
      message: `受付番号 ${existing.inquiry_id} の通知処理を確認しています。時間をおいてお問い合わせください。`
    }, 409);
  }

  const receivedAt = new Date().toISOString();
  const inquiryId = `TG-${receivedAt.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  await env.CONTACT_DB.prepare(`INSERT INTO inquiries (
    inquiry_id, received_at, submission_token, name, company, email, deadline, message,
    object_name, vehicle, budget, has_3d_data, attachments_json, status
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
    .bind(inquiryId, receivedAt, inquiry.submissionToken, inquiry.name, inquiry.company, inquiry.email,
      inquiry.deadline, inquiry.message, inquiry.object, inquiry.vehicle, inquiry.budget, inquiry.data, '[]', 'processing')
    .run();

  const attachments = [];
  try {
    for (const file of files) {
      const key = `contacts/${inquiryId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
      await env.CONTACT_FILES.put(key, file.stream(), {
        httpMetadata: { contentType: file.type },
        customMetadata: { inquiryId, originalName: file.name }
      });
      attachments.push({ key, name: file.name, type: file.type, size: file.size });
    }

    await env.CONTACT_DB.prepare('UPDATE inquiries SET attachments_json = ?1, status = ?2 WHERE inquiry_id = ?3')
      .bind(JSON.stringify(attachments), 'received', inquiryId)
      .run();

    await sendNotification(env, { ...inquiry, inquiryId, receivedAt, attachments }, fetchImpl);
    await env.CONTACT_DB.prepare('UPDATE inquiries SET status = ?1 WHERE inquiry_id = ?2').bind('notified', inquiryId).run();
  } catch (error) {
    await env.CONTACT_DB.prepare('UPDATE inquiries SET status = ?1 WHERE inquiry_id = ?2').bind('notification_or_file_error', inquiryId).run();
    console.error('contact_processing_failed');
    return json({ ok: false, inquiryId, message: `受付番号 ${inquiryId} で保存しましたが、通知処理を完了できませんでした。` }, 502);
  }

  const sheetRecord = createInquiryRecord({ ...inquiry, attachments }, { now: receivedAt });
  const sheetResult = await saveInquiryRecord(sheetRecord, env, fetchImpl);
  if (!sheetResult.ok) console.error('inquiry_sheet_save_failed');

  if ((request.headers.get('Accept') || '').includes('text/html')) {
    const url = new URL('/contact-complete.html', request.url);
    url.searchParams.set('id', inquiryId);
    return Response.redirect(url.toString(), 303);
  }
  return json({ ok: true, inquiryId });
}

export function onRequest(context) {
  return handleContactRequest(context);
}
