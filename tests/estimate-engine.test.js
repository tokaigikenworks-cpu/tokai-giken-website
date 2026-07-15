'use strict';

const assert = require('node:assert/strict');
const engine = require('../assets/estimate.js');

function category(input) {
  const result = engine.classifyCase(input);
  return result.category && result.category.code;
}

assert.equal(category({ purpose: 'data', deliverable: 'reference', safety: 'low' }), 'A');
assert.equal(category({ purpose: 'print', deliverable: 'cad', safety: 'low' }), 'B');
assert.equal(category({ purpose: 'print', deliverable: 'production', safety: 'low' }), 'C');
assert.equal(category({ purpose: 'vehicle', fitting: 'known', deliverable: 'prototype', safety: 'low' }), 'D');
assert.equal(category({ purpose: 'sell', deliverable: 'support', safety: 'low' }), 'E');
assert.equal(category({ purpose: 'data', deliverable: 'reference', safety: 'high' }), 'E');
assert.equal(category({ inquiryText: '廃番部品と同じ物を再製作したい', deliverable: 'cad', safety: 'low' }), 'B');

const fittingResult = engine.classifyCase({
  purpose: 'reproduce',
  fitting: 'unknown',
  deliverable: 'cad',
  safety: 'low'
});
assert.equal(fittingResult.category.code, 'D');
assert.ok(fittingResult.warnings.some((warning) => warning.includes('嵌合相手')));

const totals = engine.calculateTotals([
  { quantity: 1, price: 60000 },
  { quantity: 2, price: 5000 }
], 10);
assert.deepEqual(totals, { subtotal: 70000, tax: 7000, total: 77000 });

const summary = engine.buildSummary({
  quoteNumber: 'TKG-EST-TEST',
  issueDate: '2026-07-15',
  clientName: 'テスト株式会社',
  honorific: '御中',
  projectName: 'CAD再構築',
  items: [{ description: 'CAD再構築 基本作業費', quantity: 1, unit: '式', price: 60000 }],
  taxRate: 10
});
assert.match(summary, /TKG-EST-TEST/);
assert.match(summary, /合計：¥66,000/);

console.log('estimate-engine: all tests passed');
