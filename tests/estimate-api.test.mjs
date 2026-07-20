import assert from 'node:assert/strict';
import {
  buildLocalClassification,
  buildOpenAIRequest,
  handleEstimateRequest,
  limitPayloadForOpenAI,
  requestOpenAIClassification
} from '../functions/api/estimate.js';

const classificationCases = [
  [{ inquiryText: '現物をスキャンしてメッシュで納品してほしい', purpose: 'data', deliverable: 'reference' }, 'A'],
  [{ inquiryText: '廃番部品をCADで再構築したい', purpose: 'reproduce', deliverable: 'cad' }, 'B'],
  [{ inquiryText: '3Dプリント用データを作りたい', purpose: 'print', deliverable: 'production' }, 'C'],
  [{ inquiryText: '車両への取付部品を設計して試作したい', purpose: 'vehicle', fitting: 'known', deliverable: 'prototype' }, 'D'],
  [{ inquiryText: '量産、販売、外注先調整まで相談したい', purpose: 'sell', deliverable: 'support' }, 'E']
];
classificationCases.forEach(([input, expected]) => {
  assert.equal(buildLocalClassification(input).category.code, expected);
});

assert.match(buildLocalClassification({ fitting: 'unknown' }).warnings.join('\n'), /嵌合相手/);
assert.match(buildLocalClassification({ safety: 'unknown' }).warnings.join('\n'), /安全性/);
assert.match(buildLocalClassification({ rush: 'rush' }).warnings.join('\n'), /短納期/);
assert.match(buildLocalClassification({}).warnings.join('\n'), /主な目的/);

const limited = limitPayloadForOpenAI({
  inquiryText: '会社名：株式会社テスト\n担当者：鈴木\n連絡先 test@example.com\n電話 090-1234-5678\nメッシュ化を希望',
  purpose: 'data',
  clientName: '送信禁止',
  quoteNumber: '送信禁止',
  amount: 999999
});
assert.equal('clientName' in limited.payload, false);
assert.equal('quoteNumber' in limited.payload, false);
assert.equal('amount' in limited.payload, false);
assert.doesNotMatch(limited.payload.inquiryText, /株式会社テスト|鈴木|test@example\.com|090-1234-5678/);
assert.ok(limited.redactionCount >= 4);

const requestBody = buildOpenAIRequest(limited.payload, 'gpt-5.6-luna');
assert.equal(requestBody.model, 'gpt-5.6-luna');
assert.equal(requestBody.store, false);
assert.equal(requestBody.text.format.type, 'json_schema');
assert.equal(requestBody.text.format.strict, true);
assert.deepEqual(requestBody.text.format.schema.properties.category.enum, ['A', 'B', 'C', 'D', 'E']);
assert.doesNotMatch(JSON.stringify(requestBody), /送信禁止/);

let capturedOpenAIRequest = null;
const openaiFetch = async (url, options) => {
  capturedOpenAIRequest = { url, options };
  return new Response(JSON.stringify({
    id: 'resp_test',
    model: 'gpt-5.6-luna',
    output: [{
      type: 'message',
      content: [{
        type: 'output_text',
        text: JSON.stringify({
          category: 'D',
          confidence: 0.92,
          reason: '車両取付と試作を含むためDです。',
          warnings: ['嵌合相手との干渉確認が必要です。'],
          inferredPurpose: 'vehicle'
        })
      }]
    }],
    usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 }
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

const successRequest = new Request('https://example.test/api/estimate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inquiryText: '車両用ブラケットを設計・試作したい',
    purpose: 'vehicle',
    fitting: 'known',
    deliverable: 'prototype',
    clientName: '送信禁止'
  })
});
const successResponse = await handleEstimateRequest(successRequest, {
  OPENAI_API_KEY: 'test-secret',
  OPENAI_MODEL: 'gpt-5.6-luna',
  CF_PAGES_BRANCH: 'feature/estimate-tool-mvp'
}, openaiFetch);
const successData = await successResponse.json();
assert.equal(successResponse.status, 200);
assert.equal(successData.mode, 'openai');
assert.equal(successData.classification.category.code, 'D');
assert.equal(successData.classification.category.price, 200000);
assert.equal(successData.classification.confidence, 0.92);
assert.equal(successData.meta.usage.total_tokens, 160);
assert.equal(capturedOpenAIRequest.url, 'https://api.openai.com/v1/responses');
assert.equal(capturedOpenAIRequest.options.headers.Authorization, 'Bearer test-secret');
const sentToOpenAI = JSON.parse(capturedOpenAIRequest.options.body);
assert.equal(sentToOpenAI.store, false);
assert.doesNotMatch(JSON.stringify(sentToOpenAI), /clientName|送信禁止/);

const missingSecretResponse = await handleEstimateRequest(new Request('https://example.test/api/estimate', {
  method: 'POST',
  body: JSON.stringify({ purpose: 'reproduce', deliverable: 'cad' })
}), { CF_PAGES_BRANCH: 'feature/estimate-tool-mvp' }, openaiFetch);
const missingSecretData = await missingSecretResponse.json();
assert.equal(missingSecretResponse.status, 200);
assert.equal(missingSecretData.mode, 'local-fallback');
assert.equal(missingSecretData.meta.fallbackReason, 'missing_secret');
assert.equal(missingSecretData.classification.category.code, 'B');

let productionFetchCalled = false;
const productionResponse = await handleEstimateRequest(new Request('https://example.test/api/estimate', {
  method: 'POST',
  body: JSON.stringify({ purpose: 'sell' })
}), { OPENAI_API_KEY: 'test-secret', CF_PAGES_BRANCH: 'main' }, async () => {
  productionFetchCalled = true;
  return new Response();
});
const productionData = await productionResponse.json();
assert.equal(productionData.mode, 'local-fallback');
assert.equal(productionData.meta.fallbackReason, 'preview_only');
assert.equal(productionFetchCalled, false);

const rateLimitResponse = await handleEstimateRequest(new Request('https://example.test/api/estimate', {
  method: 'POST',
  body: JSON.stringify({ purpose: 'vehicle' })
}), { OPENAI_API_KEY: 'test-secret', CF_PAGES_BRANCH: 'feature/estimate-tool-mvp' }, async () => {
  return new Response('{}', { status: 429 });
});
const rateLimitData = await rateLimitResponse.json();
assert.equal(rateLimitData.mode, 'local-fallback');
assert.equal(rateLimitData.meta.fallbackReason, 'rate_limit');
assert.equal(rateLimitData.meta.openaiStatus, 429);

await assert.rejects(
  requestOpenAIClassification({ purpose: 'data' }, { OPENAI_API_KEY: 'test' }, (url, options) => {
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  }, 5),
  (error) => error.code === 'timeout'
);

const invalidResponse = await handleEstimateRequest(
  new Request('https://example.test/api/estimate', { method: 'POST', body: 'invalid-json' }),
  {},
  openaiFetch
);
assert.equal(invalidResponse.status, 400);

const methodResponse = await handleEstimateRequest(new Request('https://example.test/api/estimate'), {}, openaiFetch);
assert.equal(methodResponse.status, 405);

console.log('estimate-api: all tests passed');
