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
let fetchBody;
dom.window.fetch = (_url, options) => {
  fetchCalls += 1;
  fetchBody = options.body;
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
const fileInput = form.querySelector('[name="attachment"]');
const submit = form.querySelector('.submit');
const status = form.querySelector('.form-status');
const selectedFiles = form.querySelector('.selected-files');
const selectedFilesList = form.querySelector('.selected-files-list');
const clearFiles = form.querySelector('.clear-files');

const chooseFiles = (...files) => {
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: files
  });
  fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

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

const firstFile = new dom.window.File(['first'], 'first sample.step', {
  type: 'application/octet-stream',
  lastModified: 100
});
const secondFile = new dom.window.File(['second'], 'very-long-second-sample-file-name-for-mobile-layout.pdf', {
  type: 'application/pdf',
  lastModified: 200
});

chooseFiles(firstFile);
assert.equal(selectedFiles.hidden, false, 'selected file panel is displayed');
assert.equal(selectedFilesList.children.length, 1, 'one selected file is listed');
assert.match(selectedFiles.textContent, /first sample\.step/);

chooseFiles(secondFile);
assert.equal(selectedFilesList.children.length, 2, 'additional selections are appended');

chooseFiles(secondFile);
assert.equal(selectedFilesList.children.length, 2, 'duplicate selections are ignored');

selectedFilesList.querySelector('.remove-file').click();
assert.equal(selectedFilesList.children.length, 1, 'individual file can be removed');
assert.doesNotMatch(selectedFiles.textContent, /first sample\.step/);

chooseFiles(firstFile);
assert.equal(selectedFilesList.children.length, 2, 'a removed file can be selected again');

clearFiles.click();
assert.equal(selectedFiles.hidden, true, 'all selected files can be removed');
assert.equal(selectedFilesList.children.length, 0);

const tooManyFiles = Array.from({ length: 11 }, (_, index) => new dom.window.File(
  [`file-${index}`],
  `file-${index}.pdf`,
  { type: 'application/pdf', lastModified: 300 + index }
));
chooseFiles(...tooManyFiles);
assert.equal(selectedFiles.hidden, true, 'selection over the limit is rejected');
assert.match(status.textContent, /最大10点/);

submit.click();
assert.equal(fetchCalls, 0, 'invalid form must not submit');
assert.match(status.textContent, /必須項目/);
assert.equal(status.classList.contains('error'), true);
assert.equal(submit.disabled, false);

form.querySelector('[name="name"]').value = 'テスト太郎';
form.querySelector('[name="email"]').value = 'test@example.com';
textarea.value = 'テスト相談';
chooseFiles(firstFile, secondFile);
submit.click();

assert.equal(fetchCalls, 1, 'explicit button click submits once');
assert.equal(selectedFilesList.children.length, 2, 'selected files remain visible while sending');
assert.deepEqual(
  fetchBody.getAll('attachment').map((file) => file.name),
  ['first sample.step', 'very-long-second-sample-file-name-for-mobile-layout.pdf'],
  'only the files remaining in the selection are submitted'
);
assert.equal(submit.disabled, true, 'button is disabled while sending');
assert.equal(submit.textContent, '送信中…');
submit.click();
assert.equal(fetchCalls, 1, 'repeated click must not submit twice');

console.log('contact-ui: all tests passed');
