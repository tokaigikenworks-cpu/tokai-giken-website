const CATEGORY_ORDER = ['A', 'B', 'C', 'D', 'E'];
const CATEGORIES = {
  A: {
    code: 'A',
    label: '3Dスキャン・データ化',
    price: 20000,
    auto: true,
    reason: '現物形状を取得し、確認・保管に使う3Dデータへ整理する基本区分です。'
  },
  B: {
    code: 'B',
    label: 'CAD再構築',
    price: 60000,
    auto: true,
    reason: '再製作や形状編集に必要な、編集可能なCADデータを作成する区分です。'
  },
  C: {
    code: 'C',
    label: '製作用データ作成',
    price: 100000,
    auto: true,
    reason: '製作方法を見据えてデータを整える区分です。'
  },
  D: {
    code: 'D',
    label: '設計・試作支援',
    price: 200000,
    auto: true,
    reason: '取付・干渉・使用条件を確認し、設計と試作検証まで進める区分です。'
  },
  E: {
    code: 'E',
    label: '開発・外注支援',
    price: 300000,
    auto: false,
    reason: '成果物・責任範囲・外注工程を確認して個別見積とする区分です。'
  }
};

function categoryAtLeast(current, minimum) {
  if (!current) return minimum;
  return CATEGORY_ORDER.indexOf(current) >= CATEGORY_ORDER.indexOf(minimum) ? current : minimum;
}

function inferPurpose(text) {
  const source = String(text || '');
  if (/販売|量産|商品化|外注先|ロット/.test(source)) return 'sell';
  if (/取り付け|取付|嵌合|干渉|車両|車種|ブラケット|マウント/.test(source)) return 'vehicle';
  if (/同じ物|再製作|再現|廃番|生産終了|複製/.test(source)) return 'reproduce';
  if (/3D.?プリント|造形|STL/.test(source)) return 'print';
  if (/3D.?データ|スキャン|計測|STEP|メッシュ/.test(source)) return 'data';
  return '';
}

export function buildDummyClassification(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const inferredPurpose = input.purpose || inferPurpose(input.inquiryText);
  const warnings = ['ダミーAPI応答です。実APIによる文章判定結果ではありません。'];
  let code = {
    data: 'A',
    print: 'B',
    reproduce: 'B',
    vehicle: 'D',
    sell: 'E',
    other: 'B'
  }[inferredPurpose] || 'A';

  if (input.deliverable === 'cad') code = categoryAtLeast(code, 'B');
  if (input.deliverable === 'production') code = categoryAtLeast(code, 'C');
  if (input.deliverable === 'prototype') code = categoryAtLeast(code, 'D');
  if (input.deliverable === 'support') code = categoryAtLeast(code, 'E');
  if (input.fitting === 'known' || input.fitting === 'unknown') code = categoryAtLeast(code, 'D');
  if (input.safety === 'high') code = categoryAtLeast(code, 'E');
  if (!input.purpose && inferredPurpose) warnings.push('問い合わせ文の語句から目的を仮判定しました。');
  if (input.fitting === 'unknown') warnings.push('嵌合相手が不明です。追加資料の確認が必要です。');
  if (input.rush === 'rush') warnings.push('短納期対応の可否と追加費用を確認してください。');
  if (code === 'E') warnings.push('E区分は自動確定せず、作業範囲を確認して個別見積とします。');

  return {
    category: CATEGORIES[code],
    warnings,
    inferredPurpose
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export async function onRequest(context) {
  const request = context.request;
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'POSTメソッドを使用してください。' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: 'JSON形式のリクエストを送信してください。' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse({ ok: false, error: 'リクエスト内容が正しくありません。' }, 400);
  }

  const receivedFields = ['inquiryText', 'purpose', 'sourceType', 'fitting', 'deliverable', 'safety', 'rush']
    .filter(function (key) { return Object.prototype.hasOwnProperty.call(payload, key); });

  return jsonResponse({
    ok: true,
    mode: 'dummy',
    classification: buildDummyClassification(payload),
    meta: {
      receivedFields,
      inquiryLength: String(payload.inquiryText || '').length
    }
  }, 200);
}
