import assert from 'node:assert/strict';
import {
  buildLocalClassification,
  buildOpenAIRequest,
  enforceClassificationRules,
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
assert.match(buildLocalClassification({}).warnings.join('\n'), /元になる情報/);
assert.match(buildLocalClassification({}).warnings.join('\n'), /希望する納品物/);
assert.equal(buildLocalClassification({}).category.code, 'A');
assert.equal(buildLocalClassification({}).confidence, 0.35);

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
assert.match(JSON.stringify(requestBody), /否定表現/);

const bWithoutFittingWarning = enforceClassificationRules({
  category: 'B',
  confidence: 0.93,
  reason: 'CAD再構築です。',
  warnings: ['取付相手がいないため、嵌合確認や取付検証は実施できません。'],
  inferredPurpose: 'reproduce'
}, {
  inquiryText: '廃番部品をCAD再構築したい。取付相手はなく、安全性への影響もありません。',
  purpose: 'reproduce',
  sourceType: 'physical',
  fitting: 'none',
  deliverable: 'cad'
});
assert.equal(bWithoutFittingWarning.category, 'B');
assert.deepEqual(bWithoutFittingWarning.warnings, []);

const fittingConflict = enforceClassificationRules({
  category: 'D',
  confidence: 0.8,
  reason: '取付確認を含みます。',
  warnings: ['取付相手が不明です。'],
  inferredPurpose: 'vehicle'
}, {
  inquiryText: '車両への取付確認が必要です。',
  purpose: 'vehicle',
  sourceType: 'physical',
  fitting: 'none',
  deliverable: 'prototype'
});
assert.deepEqual(fittingConflict.warnings, ['取付条件について、選択内容と問い合わせ本文が一致していません。確認してください。']);

const insufficient = enforceClassificationRules({
  category: 'E',
  confidence: 0.98,
  reason: '量産案件と推測しました。',
  warnings: ['量産体制を確認してください。'],
  inferredPurpose: 'sell'
}, {
  inquiryText: '部品を作ってほしいです。用途や必要なデータ、取付条件などの詳細はまだ決まっていません。',
  purpose: '',
  sourceType: '',
  fitting: 'none',
  deliverable: ''
});
assert.equal(insufficient.category, 'A');
assert.equal(insufficient.inferredPurpose, 'other');
assert.ok(insufficient.confidence <= 0.35);
assert.match(insufficient.reason, /情報が不足/);
assert.match(insufficient.warnings.join('\n'), /主な目的/);
assert.match(insufficient.warnings.join('\n'), /元になる情報/);
assert.match(insufficient.warnings.join('\n'), /希望する納品物/);
assert.doesNotMatch(insufficient.warnings.join('\n'), /量産/);

const negatedRequirements = enforceClassificationRules({
  category: 'B',
  confidence: 0.8,
  reason: '再構築です。',
  warnings: ['設計変更が必要です。', '試作が必要です。', '量産検討が必要です。', '安全確認が必要です。'],
  inferredPurpose: 'reproduce'
}, {
  inquiryText: '設計変更は不要です。試作品の納品は不要です。量産対応は不要です。安全性への影響はありません。',
  purpose: 'reproduce',
  sourceType: 'physical',
  fitting: 'none',
  deliverable: 'cad'
});
assert.deepEqual(negatedRequirements.warnings, []);

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
}), { OPENAI_API_KEY: 'test-secret', CF_PAGES_BRANCH: 'main' }, async (url, options) => {
  productionFetchCalled = true;
  return openaiFetch(url, options);
});
const productionData = await productionResponse.json();
assert.equal(productionData.mode, 'openai');
assert.equal(productionData.classification.category.code, 'D');
assert.equal(productionFetchCalled, true);

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
