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
const printTitles = [];
let apiRequest = null;
dom.window.print = () => {
  printCalls += 1;
  printTitles.push(dom.window.document.title);
};
dom.window.confirm = () => true;
dom.window.URL.createObjectURL = () => 'blob:estimate-test';
dom.window.URL.revokeObjectURL = () => {};
dom.window.fetch = async (url, options) => {
  apiRequest = { url, options };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      mode: 'openai',
      classification: {
        category: {
          code: 'D',
          label: 'AIが変更してはいけない名称',
          price: 1,
          auto: false,
          reason: 'モックAPIから返した判定理由です。'
        },
        confidence: 0.91,
        warnings: ['モックAPI応答です。'],
        inferredPurpose: 'vehicle'
      },
      meta: {
        durationMs: 840,
        model: 'gpt-5.6-luna',
        redactionCount: 1,
        usage: { total_tokens: 160 }
      }
    })
  };
};
class TestFileReader {
  addEventListener(type, listener) { this[type] = listener; }
  readAsText(file) {
    this.result = file.contents;
    this.load();
  }
}
dom.window.FileReader = TestFileReader;
dom.window.eval(script);

const document = dom.window.document;
const change = new dom.window.Event('change', { bubbles: true });
const input = new dom.window.Event('input', { bubbles: true });
assert.equal(document.querySelector('.estimate-hero h1').textContent.trim(), 'トカイ技研の見積ツール');
assert.equal(document.querySelector('#deliverable').value, '');
assert.equal(document.querySelector('#deliverable option:first-child').textContent, '選択してください');
assert.equal(document.querySelector('#deliverable option[value="reference"]').textContent, '3Dデータ（点群またはメッシュ）');
assert.equal(document.querySelector('#payment-type').value, 'prepaid');
assert.equal(document.querySelector('#preview-payment').textContent, '前払い（ご入金確認後に着手）');
assert.deepEqual(Array.from(document.querySelectorAll('#honorific option'), (option) => option.textContent), ['御中', '様']);
assert.match(document.querySelector('.recipient-help').textContent, /個人名は「様」/);
assert.equal(document.querySelector('#copy-summary').textContent.trim(), '見積内容をテキストでコピー');
assert.equal(document.querySelector('#save-json').textContent.trim(), '編集データを保存');
assert.equal(document.querySelector('#save-json').tagName, 'BUTTON');
assert.equal(document.querySelector('#load-json-button').tagName, 'BUTTON');
assert.equal(document.querySelector('#classify-with-api').textContent.trim(), 'API判定を実行');
assert.match(document.querySelector('#api-classification-status').textContent, /自動反映されません/);
assert.equal(document.querySelector('#classification-comparison').hidden, true);
assert.match(document.querySelector('.edit-data-help').textContent, /後から再編集/);
assert.match(styles, /\.tool-actions \.button[\s\S]*min-height: 48px/);
assert.match(styles, /#custom-payment-label\[hidden\][\s\S]*display: none !important/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.line-items-table tr[\s\S]*display: grid/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.tool-actions[\s\S]*grid-template-columns: 1fr/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.quote-sheet[\s\S]*aspect-ratio: 210 \/ 297/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.tool-panel input\[type="date"\][\s\S]*width: 100%[\s\S]*min-inline-size: 0[\s\S]*-webkit-appearance: none[\s\S]*appearance: none/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.tool-form-grid > label[\s\S]*max-width: 100%[\s\S]*min-width: 0/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.quote-sheet \.quote-footer[\s\S]*width: 100%[\s\S]*margin: auto 0 0/);
assert.match(styles, /@media \(max-width: 740px\)[\s\S]*\.quote-notes[\s\S]*flex: 1 1 0/);
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

const issueDate = document.querySelector('#issue-date');
const quoteNumber = document.querySelector('#quote-number');
issueDate.value = '2026-07-19';
issueDate.dispatchEvent(input);
assert.equal(quoteNumber.value, '20260719_1');
assert.equal(dom.window.localStorage.getItem('estimate-sequence-20260719'), null);

const originalTitle = document.title;
document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
assert.equal(printCalls, 1);
assert.equal(printTitles[0], '20260719_1');
assert.equal(dom.window.localStorage.getItem('estimate-sequence-20260719'), '1');
assert.equal(document.title, originalTitle);
document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
assert.equal(printCalls, 2);
assert.equal(dom.window.localStorage.getItem('estimate-sequence-20260719'), '1');

let jsonDownloadName = '';
dom.window.HTMLAnchorElement.prototype.click = function () { jsonDownloadName = this.download; };
document.querySelector('#save-json').click();
assert.equal(jsonDownloadName, '20260719_1.json');

document.querySelector('#reset-estimate').click();
assert.equal(document.querySelector('#deliverable').value, '');
issueDate.value = '2026-07-19';
issueDate.dispatchEvent(input);
assert.equal(quoteNumber.value, '20260719_2');
assert.equal(dom.window.localStorage.getItem('estimate-sequence-20260719'), '1');
issueDate.value = '2026-07-20';
issueDate.dispatchEvent(input);
assert.equal(quoteNumber.value, '20260720_1');

const loadInput = document.querySelector('#load-json');
Object.defineProperty(loadInput, 'files', {
  configurable: true,
  value: [{ contents: JSON.stringify({
    quoteNumber: '20260718_7',
    issueDate: '2026-07-18',
    deliverable: '',
    items: []
  }) }]
});
loadInput.dispatchEvent(change);
assert.equal(quoteNumber.value, '20260718_7');
assert.equal(document.querySelector('#deliverable').value, '');
issueDate.value = '2026-07-20';
issueDate.dispatchEvent(change);
assert.equal(quoteNumber.value, '20260718_7');

document.querySelector('#purpose').value = 'sell';
document.querySelector('#deliverable').value = 'support';
document.querySelector('#purpose').dispatchEvent(change);
assert.equal(document.querySelector('#category-code').textContent, 'E');
assert.equal(document.querySelector('#apply-category').disabled, true);

async function testApiIntegration() {
  document.querySelector('#inquiry-text').value = '車両用ブラケットを設計したい';
  document.querySelector('#payment-type').value = 'prepaid';
  document.querySelector('#classify-with-api').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(apiRequest.url, '/api/estimate');
  assert.equal(apiRequest.options.method, 'POST');
  const sent = JSON.parse(apiRequest.options.body);
  assert.equal(sent.inquiryText, '車両用ブラケットを設計したい');
  assert.equal(sent.purpose, 'sell');
  assert.equal('clientName' in sent, false);
  assert.equal('quoteNumber' in sent, false);
  assert.equal(document.querySelector('#category-code').textContent, 'E');
  assert.equal(document.querySelector('#comparison-local-code').textContent, 'E');
  assert.equal(document.querySelector('#comparison-api-code').textContent, 'D');
  assert.equal(document.querySelector('#comparison-match').textContent, '不一致');
  assert.match(document.querySelector('#comparison-api-reason').textContent, /モックAPIから返した/);
  assert.match(document.querySelector('#comparison-api-warnings').textContent, /モックAPI応答/);
  assert.doesNotMatch(document.querySelector('#category-reason').textContent, /モックAPIから返した/);
  assert.equal(document.querySelector('#classification-comparison').hidden, false);
  assert.equal(document.querySelector('#adopt-api-classification').disabled, false);
  assert.match(document.querySelector('#comparison-meta').textContent, /確信度: 91%/);
  assert.match(document.querySelector('#comparison-meta').textContent, /tokens: 160/);
  assert.match(document.querySelector('#comparison-meta').textContent, /削除: 1件/);
  assert.equal(document.querySelector('#api-classification-status').dataset.state, 'success');
  assert.match(document.querySelector('#api-classification-status').textContent, /比較後/);
  assert.equal(document.querySelector('#classify-with-api').disabled, false);

  document.querySelector('#adopt-api-classification').click();
  assert.equal(document.querySelector('#category-code').textContent, 'D');
  assert.equal(document.querySelector('#category-label').textContent, '設計・試作支援 / ¥200,000〜');
  assert.match(document.querySelector('#category-reason').textContent, /モックAPIから返した/);
  assert.equal(document.querySelector('#payment-type').value, 'prepaid');
  assert.equal(document.querySelector('#adopt-api-classification').disabled, true);

  document.querySelector('#inquiry-text').dispatchEvent(input);
  assert.equal(document.querySelector('#category-code').textContent, 'E');
  assert.equal(document.querySelector('#classification-comparison').hidden, true);
  assert.match(document.querySelector('#api-classification-status').textContent, /もう一度/);

  dom.window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      mode: 'local-fallback',
      classification: {},
      meta: { fallbackReason: 'rate_limit' }
    })
  });
  document.querySelector('#classify-with-api').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.querySelector('#comparison-match').textContent, 'ローカルへフォールバック');
  assert.equal(document.querySelector('#comparison-match').dataset.state, 'fallback');
  assert.equal(document.querySelector('#adopt-api-classification').disabled, true);
  assert.equal(document.querySelector('#category-code').textContent, 'E');
  assert.match(document.querySelector('#comparison-meta').textContent, /rate_limit/);
}

testApiIntegration()
  .then(() => console.log('estimate-ui: all tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
