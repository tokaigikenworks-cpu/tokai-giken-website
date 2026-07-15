'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'estimate.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/estimate.js'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/estimate.html' });

let printCalls = 0;
dom.window.print = () => { printCalls += 1; };
dom.window.confirm = () => true;
dom.window.eval(script);

const document = dom.window.document;
const change = new dom.window.Event('change', { bubbles: true });
document.querySelector('#purpose').value = 'vehicle';
document.querySelector('#fitting').value = 'known';
document.querySelector('#deliverable').value = 'prototype';
document.querySelector('#purpose').dispatchEvent(change);

assert.equal(document.querySelector('#category-code').textContent, 'D');
assert.equal(document.querySelector('#apply-category').disabled, false);
document.querySelector('#apply-category').click();
assert.equal(document.querySelectorAll('#line-items tr').length, 2);
assert.equal(document.querySelector('[data-category-item="D"] .item-price').value, '200000');

document.querySelector('#client-name').value = 'テスト株式会社';
document.querySelector('#project-name').value = '取付部品の設計';
document.querySelector('#client-name').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.equal(document.querySelector('#preview-client').textContent, 'テスト株式会社');
assert.equal(document.querySelector('#preview-project').textContent, '取付部品の設計');
assert.equal(document.querySelector('#preview-total').textContent, '¥220,000');

document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
assert.equal(printCalls, 1);

document.querySelector('#purpose').value = 'sell';
document.querySelector('#deliverable').value = 'support';
document.querySelector('#purpose').dispatchEvent(change);
assert.equal(document.querySelector('#category-code').textContent, 'E');
assert.equal(document.querySelector('#apply-category').disabled, true);

console.log('estimate-ui: all tests passed');
