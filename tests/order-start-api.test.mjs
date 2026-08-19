import assert from 'node:assert/strict';
import { handleOrderStartRequest } from '../functions/api/admin/order-start.js';
import { handleOrderStartCandidatesRequest } from '../functions/api/order-start-candidates.js';

class FakeDatabase {
  constructor() { this.rows = new Map(); }
  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async first() {
            const row = database.rows.get(values[0]);
            return row ? { record_id: values[0], transfer_status: row.transfer_status } : null;
          },
          async run() {
            if (sql.includes('INSERT OR IGNORE')) {
              if (database.rows.has(values[0])) return { meta: { changes: 0 } };
              database.rows.set(values[0], {
                transfer_status: 'creating',
                object_key: values[3],
                payload_sha256: values[4]
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET transfer_status = 'ready'")) {
              database.rows.get(values[0]).transfer_status = 'ready';
              return { meta: { changes: 1 } };
            }
            if (sql.includes('DELETE FROM order_transfers')) {
              database.rows.delete(values[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          }
        };
      }
    };
  }
}

class FakeR2 {
  constructor() { this.objects = new Map(); }
  async put(key, value, options) { this.objects.set(key, { value, options }); }
  async delete(key) { this.objects.delete(key); }
}

const acceptedRecord = {
  recordId: 'record-accepted-001',
  status: '受注',
  clientName: '山田 太郎',
  companyName: '株式会社テスト',
  email: 'yamada@example.com',
  estimateProjectName: '治具設計',
  estimateInquiryText: '検査治具の設計を希望',
  estimateDelivery: '2026-09-30',
  quoteNumber: 'EST-2026-0014',
  issueDate: '2026-08-20',
  subtotal: 100000,
  taxAmount: 10000,
  total: 110000,
  payment: '銀行振込',
  estimateNotes: 'テスト見積',
  items: [{ description: '治具設計', quantity: 1, unit: '式', price: 100000 }]
};

const database = new FakeDatabase();
const bucket = new FakeR2();
const env = {
  CONTACT_DB: database,
  ORDER_IMPORTS: bucket,
  SHEETS_WEB_APP_URL: 'https://script.google.test/exec',
  SHEETS_SHARED_SECRET: 'test-secret'
};
const allowAccess = async () => true;
const sheetPoster = async (_env, payload) => ({
  ok: true,
  result: payload.recordId === acceptedRecord.recordId
    ? { ok: true, record: acceptedRecord }
    : { ok: false, error: 'record_not_found' }
});
const now = () => new Date('2026-08-20T01:02:03.000Z');
const accessHeaders = {
  'Cf-Access-Jwt-Assertion': 'test-jwt',
  'Cf-Access-Authenticated-User-Email': 'owner@example.com'
};

const postRequest = () => new Request('https://preview.example.test/api/admin/order-start', {
  method: 'POST',
  headers: { ...accessHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ recordId: acceptedRecord.recordId })
});

const created = await handleOrderStartRequest(postRequest(), env, fetch, allowAccess, sheetPoster, now);
assert.equal(created.status, 201);
assert.equal((await created.json()).status, 'ready');
const stored = bucket.objects.get('order_import/inbox/record-accepted-001.json');
assert.ok(stored);
const transfer = JSON.parse(stored.value);
assert.equal(transfer.source.record_id, acceptedRecord.recordId);
assert.equal(transfer.customer.customer_name, '株式会社テスト');
assert.equal(transfer.estimate.total_amount, 110000);
assert.equal(transfer.details[0].amount, 100000);

const duplicate = await handleOrderStartRequest(postRequest(), env, fetch, allowAccess, sheetPoster, now);
assert.equal(duplicate.status, 409);
assert.equal((await duplicate.json()).status, 'already_processed');
assert.equal(bucket.objects.size, 1);

const statusResponse = await handleOrderStartRequest(new Request(
  'https://preview.example.test/api/admin/order-start?record_id=record-accepted-001',
  { headers: accessHeaders }
), env, fetch, allowAccess, sheetPoster, now);
assert.equal((await statusResponse.json()).status, 'ready');

const candidates = await handleOrderStartCandidatesRequest(
  new Request('https://preview.example.test/api/order-start-candidates', { headers: accessHeaders }),
  { SHEETS_WEB_APP_URL: 'https://script.google.test/exec', SHEETS_SHARED_SECRET: 'test-secret' },
  async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.action, 'listOrderStartCandidates');
    return new Response(JSON.stringify({
      ok: true,
      count: 3,
      items: [
        acceptedRecord,
        { ...acceptedRecord, recordId: 'not-contracted', status: '見積提出済み' },
        { ...acceptedRecord, recordId: 'draft', status: '見積作成中' }
      ]
    }), { headers: { 'Content-Type': 'application/json' } });
  },
  undefined,
  allowAccess
);
const candidateBody = await candidates.json();
assert.deepEqual(candidateBody.items.map((item) => item.recordId), ['record-accepted-001', 'not-contracted']);

const unauthorized = await handleOrderStartRequest(postRequest(), env, fetch, async () => false, sheetPoster, now);
assert.equal(unauthorized.status, 401);

console.log('order-start-api: all tests passed');
