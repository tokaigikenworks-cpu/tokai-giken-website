'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'contact.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'assets/script.js'), 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://preview.example.test/contact.html'
});

let fetchCalls = 0;
dom.window.fetch = () => {
  fetchCalls += 1;
  return new Promise(() => {});
};
Object.defineProperty(dom.window.crypto, 'randomUUID', {
  configurable: true,
  value: () => '00000000-0000-4000-8000-000000000010'
});
dom.window.eval(script);

const document = dom.window.document;
const form = document.querySelector('form[action="/api/contact"]');
const input = form.querySelector('[name="name"]');
const select = form.querySelector('[name="data"]');
const textarea = form.querySelector('[name="message"]');
const submit = form.querySelector('.submit');
const status = form.querySelector('.form-status');

const enter = (target) => {
  const event = new dom.window.KeyboardEvent('keydown', {
    key: 'Enter',
    bubbles: true,
    cancelable: true
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

assert.equal(enter(input), true, 'input Enter must be prevented');
assert.equal(enter(select), true, 'select Enter must be prevented');
assert.equal(enter(textarea), false, 'textarea Enter must remain available');
assert.equal(fetchCalls, 0, 'Enter must not submit the form');

submit.click();
assert.equal(fetchCalls, 0, 'invalid form must not submit');
assert.match(status.textContent, /必須項目/);
assert.equal(status.classList.contains('error'), true);
assert.equal(submit.disabled, false);

form.querySelector('[name="name"]').value = 'テスト太郎';
form.querySelector('[name="email"]').value = 'test@example.com';
textarea.value = 'テスト相談';
submit.click();

assert.equal(fetchCalls, 1, 'explicit button click submits once');
assert.equal(submit.disabled, true, 'button is disabled while sending');
assert.equal(submit.textContent, '送信中…');
submit.click();
assert.equal(fetchCalls, 1, 'repeated click must not submit twice');

console.log('contact-ui: all tests passed');
