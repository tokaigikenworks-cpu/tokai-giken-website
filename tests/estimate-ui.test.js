'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'estimate.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/estimate.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets/estimate.css'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/estimate.html' });

let printCalls = 0;
dom.window.print = () => { printCalls += 1; };
dom.window.confirm = () => true;
dom.window.eval(script);

const document = dom.window.document;
const change = new dom.window.Event('change', { bubbles: true });
assert.equal(document.querySelector('.estimate-hero h1').textContent.trim(), 'トカイ技研の見積ツール');
assert.equal(document.querySelector('#deliverable option[value="reference"]').textContent, '3Dデータ（点群またはメッシュ）');
assert.equal(document.querySelector('#payment-type').value, 'prepaid');
assert.equal(document.querySelector('#preview-payment').textContent, '前払い（ご入金確認後に着手）');
assert.deepEqual(Array.from(document.querySelectorAll('#honorific option'), (option) => option.textContent), ['御中', '様']);
assert.match(document.querySelector('.recipient-help').textContent, /個人名は「様」/);
assert.equal(document.querySelector('#copy-summary').textContent.trim(), '見積内容をテキストでコピー');
assert.equal(document.querySelector('#save-json').textContent.trim(), '編集データを保存');
assert.equal(document.querySelector('#save-json').tagName, 'BUTTON');
assert.equal(document.querySelector('#load-json-button').tagName, 'BUTTON');
assert.match(document.querySelector('.edit-data-help').textContent, /後から再編集/);
assert.match(styles, /\.tool-actions \.button[\s\S]*min-height: 48px/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.line-items-table tr[\s\S]*display: grid/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.tool-actions[\s\S]*grid-template-columns: 1fr/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.quote-sheet[\s\S]*aspect-ratio: 210 \/ 297/);
assert.match(styles, /@media print[\s\S]*\.quote-sheet[\s\S]*width: 210mm/);
assert.doesNotMatch(styles, /overflow-x:\s*hidden/);
assert.match(script, /outputFormat: fields\.outputFormat\.value\.trim\(\)/);

let loadButtonClicks = 0;
document.querySelector('#load-json').addEventListener('click', () => { loadButtonClicks += 1; });
document.querySelector('#load-json-button').click();
assert.equal(loadButtonClicks, 1);

document.querySelector('#purpose').value = 'vehicle';
document.querySelector('#fitting').value = 'known';
document.querySelector('#deliverable').value = 'prototype';
document.querySelector('#purpose').dispatchEvent(change);

assert.equal(document.querySelector('#category-code').textContent, 'D');
assert.equal(document.querySelector('#apply-category').disabled, false);
assert.equal(document.querySelector('#apply-category').textContent, '推奨作業を見積明細へ追加');
assert.equal(document.querySelector('#payment-type').value, 'split');
assert.equal(document.querySelector('#preview-payment').textContent, '着手金50％・残金50％');
assert.match(document.querySelector('#preview-payment-note').textContent, /成果物の最終確認後に残金50％をご請求/);
assert.match(document.querySelector('#preview-payment-note').textContent, /ご請求します。\n残金のご入金確認後、正式な最終データを納品/);
assert.equal(document.querySelector('#preview-payment-note .no-break').textContent, '最終データ');
document.querySelector('#apply-category').click();
assert.equal(document.querySelectorAll('#line-items tr').length, 2);
assert.equal(document.querySelector('[data-category-item="D"] .item-price').value, '200000');
assert.deepEqual(Array.from(document.querySelectorAll('#line-items tr:first-child td[data-label]'), (cell) => cell.dataset.label), ['内容', '数量', '単位', '単価']);

document.querySelector('#line-items tr:first-child .remove-item').click();
assert.equal(document.querySelectorAll('#line-items tr').length, 1);

document.querySelector('#client-name').value = '鈴木';
document.querySelector('#honorific').value = '様';
document.querySelector('#project-name').value = '取付部品の設計';
document.querySelector('#output-format').value = 'STL';
document.querySelector('#client-name').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(document.querySelector('#preview-client').textContent, '鈴木');
assert.equal(document.querySelector('#preview-honorific').textContent, '様');
assert.equal(document.querySelector('#preview-project').textContent, '取付部品の設計');
assert.equal(document.querySelector('#preview-output-format').textContent, 'STL');
assert.equal(document.querySelector('#preview-total').textContent, '¥220,000');

document.querySelector('#payment-type').value = 'custom';
document.querySelector('#payment-type').dispatchEvent(change);
assert.equal(document.querySelector('#custom-payment-label').hidden, false);
document.querySelector('#custom-payment').value = '月末締め・翌月末払い';
document.querySelector('#custom-payment').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(document.querySelector('#preview-payment').textContent, '月末締め・翌月末払い');

document.querySelector('#purpose').value = 'data';
document.querySelector('#fitting').value = 'none';
document.querySelector('#deliverable').value = 'reference';
document.querySelector('#purpose').dispatchEvent(change);
assert.equal(document.querySelector('#category-code').textContent, 'A');
assert.equal(document.querySelector('#payment-type').value, 'custom');

document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
assert.equal(printCalls, 1);

document.querySelector('#purpose').value = 'sell';
document.querySelector('#deliverable').value = 'support';
document.querySelector('#purpose').dispatchEvent(change);
assert.equal(document.querySelector('#category-code').textContent, 'E');
assert.equal(document.querySelector('#apply-category').disabled, true);

console.log('estimate-ui: all tests passed');
