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
assert.equal(engine.inferPurpose('取付相手はなく、安全性への影響もありません。'), '');
assert.equal(engine.inferPurpose('部品を作ってほしいです。用途や必要なデータ、取付条件などの詳細はまだ決まっていません。'), '');
assert.equal(engine.inferPurpose('車両への取付確認が必要です。'), 'vehicle');
assert.equal(engine.inferPurpose('量産対応と試作品の納品は不要です。'), '');
assert.equal(engine.recommendPaymentType({ code: 'A' }), 'prepaid');
assert.equal(engine.recommendPaymentType({ code: 'D' }), 'split');
assert.equal(engine.getPaymentDetails('split').quoteLabel, '着手金50％・残金50％');
assert.match(engine.getPaymentDetails('split').note, /成果物の最終確認後に残金50％をご請求/);
assert.equal(engine.getPaymentDetails('split').note, '着手金のご入金確認後に業務を開始し、成果物の最終確認後に残金50％をご請求します。\n残金のご入金確認後、正式な最終データを納品します。');
assert.equal(engine.formatQuoteDate('2026-07-19'), '20260719');
assert.equal(engine.makeQuoteNumber('2026-07-19', 1), '20260719_1');
assert.equal(engine.makeQuoteNumber('2026-07-19', 3), '20260719_3');

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
  outputFormat: 'STEP',
  items: [{ description: 'CAD再構築 基本作業費', quantity: 1, unit: '式', price: 60000 }],
  taxRate: 10
});
assert.match(summary, /TKG-EST-TEST/);
assert.match(summary, /合計：¥66,000/);
assert.match(summary, /支払条件：前払い（ご入金確認後に着手）/);
assert.match(summary, /支払条件補足：ご入金の確認後に業務へ着手いたします。/);
assert.match(summary, /納品形式：STEP/);

const splitSummary = engine.buildSummary({
  clientName: '鈴木',
  honorific: '様',
  paymentType: 'split',
  outputFormat: 'STL',
  items: [],
  taxRate: 10
});
assert.match(splitSummary, /宛名：鈴木 様/);
assert.match(splitSummary, /ご請求します。\n残金のご入金確認後、正式な最終データを納品します。/);

console.log('estimate-engine: all tests passed');
