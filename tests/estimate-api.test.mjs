import assert from 'node:assert/strict';
import { buildDummyClassification, onRequest } from '../functions/api/estimate.js';

const vehicle = buildDummyClassification({
  inquiryText: '車両へ取り付けるブラケットを作りたい',
  purpose: 'vehicle',
  deliverable: 'prototype',
  fitting: 'known',
  safety: 'low',
  rush: 'normal'
});
assert.equal(vehicle.category.code, 'D');
assert.equal(vehicle.category.auto, true);
assert.match(vehicle.warnings[0], /ダミーAPI応答/);

const sell = buildDummyClassification({ purpose: 'sell', deliverable: 'support' });
assert.equal(sell.category.code, 'E');
assert.equal(sell.category.auto, false);

const request = new Request('https://example.test/api/estimate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ inquiryText: 'STLデータを作りたい', deliverable: 'cad' })
});
const response = await onRequest({ request, env: {} });
const data = await response.json();
assert.equal(response.status, 200);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.equal(data.ok, true);
assert.equal(data.mode, 'dummy');
assert.equal(data.classification.category.code, 'B');
assert.equal(data.meta.inquiryLength, 11);
assert.deepEqual(data.meta.receivedFields, ['inquiryText', 'deliverable']);

const invalidResponse = await onRequest({
  request: new Request('https://example.test/api/estimate', { method: 'POST', body: 'invalid-json' }),
  env: {}
});
assert.equal(invalidResponse.status, 400);

const methodResponse = await onRequest({
  request: new Request('https://example.test/api/estimate'),
  env: {}
});
assert.equal(methodResponse.status, 405);

console.log('estimate-api: all tests passed');
