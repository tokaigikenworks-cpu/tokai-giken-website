(function (root) {
  'use strict';

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
      reason: '3Dプリント・切削・板金など、製作方法を見据えてデータを整える区分です。'
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
      reason: '販売・量産・安全要件・複数工程を含むため、作業範囲を確認して個別見積とする区分です。'
    }
  };

  const DEFAULT_NOTES = '送料、出張確認、外注加工、特殊材料、追加試作等が必要な場合は、事前確認のうえ別途お見積りします。';
  const DEFAULT_PAYMENT = '前払い（ご入金確認後に着手）';
  const PAYMENT_TERMS = {
    prepaid: {
      formLabel: DEFAULT_PAYMENT,
      quoteLabel: DEFAULT_PAYMENT,
      note: 'ご入金の確認後に業務へ着手いたします。'
    },
    split: {
      formLabel: '分割払い（着手金50％・残金50％）',
      quoteLabel: '着手金50％・残金50％',
      note: '着手金のご入金確認後に業務を開始し、成果物の最終確認後に残金50％をご請求します。\n残金のご入金確認後、正式な最終データを納品します。'
    }
  };

  function recommendPaymentType(category) {
    return category && CATEGORY_ORDER.indexOf(category.code) >= CATEGORY_ORDER.indexOf('D') ? 'split' : 'prepaid';
  }

  function getPaymentDetails(type, customValue) {
    if (type === 'split') return PAYMENT_TERMS.split;
    if (type === 'custom') {
      return {
        formLabel: String(customValue || '').trim() || '個別設定（内容未入力）',
        quoteLabel: String(customValue || '').trim() || '個別設定（内容未入力）',
        note: '支払時期・金額は上記の個別条件に従います。'
      };
    }
    return PAYMENT_TERMS.prepaid;
  }

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

  function classifyCase(input) {
    const data = input || {};
    const warnings = [];
    const inferredPurpose = data.purpose || inferPurpose(data.inquiryText);
    let code = '';

    switch (inferredPurpose) {
      case 'data': code = 'A'; break;
      case 'print': code = 'B'; break;
      case 'reproduce': code = 'B'; break;
      case 'vehicle': code = 'D'; break;
      case 'sell': code = 'E'; break;
      case 'other': code = 'B'; break;
      default: return { category: null, warnings, inferredPurpose: '' };
    }

    if (data.deliverable === 'cad') code = categoryAtLeast(code, 'B');
    if (data.deliverable === 'production') code = categoryAtLeast(code, 'C');
    if (data.deliverable === 'prototype') code = categoryAtLeast(code, 'D');
    if (data.deliverable === 'support') code = categoryAtLeast(code, 'E');
    if (data.fitting === 'known' || data.fitting === 'unknown') code = categoryAtLeast(code, 'D');
    if (data.safety === 'high') code = categoryAtLeast(code, 'E');

    if (!data.purpose && inferredPurpose) {
      warnings.push('問い合わせ文の語句から目的を仮判定しています。主な目的を確認してください。');
    }
    if (data.fitting === 'unknown') {
      warnings.push('嵌合相手が不明です。現物・3Dデータ・取付部の写真と概略寸法のいずれかが必要です。');
    }
    if (data.sourceType === 'photo') {
      warnings.push('写真・概略寸法のみのため、精度要件によって現物確認または追加計測が必要です。');
    }
    if (data.sourceType === 'none') {
      warnings.push('元になる現物・図面・データがありません。要件整理と新規設計の範囲を確認してください。');
    }
    if (data.safety === 'unknown') {
      warnings.push('安全性・法規への影響が未確認です。実使用条件を確認してください。');
    }
    if (data.safety === 'high') {
      warnings.push('強度・法規・安全責任の範囲を確認し、必要に応じて専門機関または製造元基準へ接続します。');
    }
    if (data.rush === 'rush') {
      warnings.push('短納期対応は通常案件と分け、特急対応費を別途確認します。');
    }
    if (code === 'E') {
      warnings.push('E区分は自動確定せず、成果物・責任範囲・外注工程を整理して個別見積とします。');
    }

    return { category: CATEGORIES[code], warnings, inferredPurpose };
  }

  function normalizeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function calculateTotals(items, taxRate) {
    const normalizedItems = Array.isArray(items) ? items : [];
    const subtotal = normalizedItems.reduce(function (sum, item) {
      return sum + normalizeNumber(item.quantity) * normalizeNumber(item.price);
    }, 0);
    const tax = Math.floor(subtotal * normalizeNumber(taxRate) / 100);
    return { subtotal, tax, total: subtotal + tax };
  }

  function formatYen(value) {
    return '¥' + Math.round(normalizeNumber(value)).toLocaleString('ja-JP');
  }

  function formatDate(value) {
    if (!value) return '—';
    const parts = String(value).split('-');
    if (parts.length !== 3) return String(value);
    return parts[0] + '/' + parts[1] + '/' + parts[2];
  }

  function formatQuoteDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const offset = value.getTimezoneOffset();
      return new Date(value.getTime() - offset * 60000).toISOString().slice(0, 10).replaceAll('-', '');
    }
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? match[1] + match[2] + match[3] : '';
  }

  function makeQuoteNumber(issueDate, sequence) {
    const datePart = formatQuoteDate(issueDate);
    const number = Math.max(1, Math.floor(Number(sequence) || 1));
    return datePart ? datePart + '_' + number : '';
  }

  function buildSummary(data) {
    const items = Array.isArray(data.items) ? data.items : [];
    const totals = calculateTotals(items, data.taxRate);
    const payment = getPaymentDetails(data.paymentType, data.customPayment);
    const lines = [
      '御見積書',
      '見積番号：' + (data.quoteNumber || '—'),
      '発行日：' + formatDate(data.issueDate),
      '宛名：' + (data.clientName || '—') + ' ' + (data.honorific || ''),
      '案件名：' + (data.projectName || '—'),
      '',
      '【明細】'
    ];

    if (!items.length) lines.push('明細なし');
    items.forEach(function (item, index) {
      const amount = normalizeNumber(item.quantity) * normalizeNumber(item.price);
      lines.push((index + 1) + '. ' + (item.description || '未入力') + ' / ' + normalizeNumber(item.quantity) + (item.unit || '式') + ' / ' + formatYen(amount));
    });

    lines.push(
      '',
      '小計：' + formatYen(totals.subtotal),
      '消費税：' + formatYen(totals.tax),
      '合計：' + formatYen(totals.total),
      '',
      '見積有効期限：' + formatDate(data.validUntil),
      '納期：' + (data.delivery || '別途協議'),
      '支払条件：' + (data.payment || payment.quoteLabel),
      '支払条件補足：' + (data.paymentNote || payment.note),
      '納品形式：' + (data.outputFormat || '別途協議'),
      '備考：' + (data.notes || DEFAULT_NOTES)
    );
    return lines.join('\n');
  }

  const engine = {
    CATEGORIES,
    DEFAULT_NOTES,
    DEFAULT_PAYMENT,
    PAYMENT_TERMS,
    recommendPaymentType,
    getPaymentDetails,
    classifyCase,
    calculateTotals,
    formatYen,
    formatDate,
    formatQuoteDate,
    makeQuoteNumber,
    buildSummary,
    inferPurpose
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = engine;
  root.EstimateEngine = engine;

  if (typeof document === 'undefined') return;

  const form = document.querySelector('#estimate-form');
  if (!form) return;

  const byId = function (id) { return document.getElementById(id); };
  const fields = {
    quoteNumber: byId('quote-number'),
    issueDate: byId('issue-date'),
    clientName: byId('client-name'),
    honorific: byId('honorific'),
    projectName: byId('project-name'),
    validUntil: byId('valid-until'),
    delivery: byId('delivery'),
    inquiryText: byId('inquiry-text'),
    purpose: byId('purpose'),
    sourceType: byId('source-type'),
    fitting: byId('fitting'),
    deliverable: byId('deliverable'),
    safety: byId('safety'),
    rush: byId('rush'),
    taxRate: byId('tax-rate'),
    paymentType: byId('payment-type'),
    customPayment: byId('custom-payment'),
    outputFormat: byId('output-format'),
    notes: byId('notes')
  };
  const classificationFields = [
    fields.inquiryText,
    fields.purpose,
    fields.sourceType,
    fields.fitting,
    fields.deliverable,
    fields.safety,
    fields.rush
  ];

  const itemContainer = byId('line-items');
  let itemSequence = 0;
  let previewObjectUrls = [];
  let paymentManuallyChanged = false;
  let quoteNumberIsAutomatic = true;
  let issuedQuoteNumber = '';
  let apiClassificationResult = null;

  const SEQUENCE_STORAGE_PREFIX = 'estimate-sequence-';

  function toLocalISODate(date) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function sequenceStorageKey(issueDate) {
    const datePart = formatQuoteDate(issueDate);
    return datePart ? SEQUENCE_STORAGE_PREFIX + datePart : '';
  }

  function getLastIssuedSequence(issueDate) {
    const key = sequenceStorageKey(issueDate);
    if (!key) return 0;
    try {
      const value = Number(window.localStorage.getItem(key));
      return Number.isInteger(value) && value > 0 ? value : 0;
    } catch (error) {
      return 0;
    }
  }

  function setLastIssuedSequence(issueDate, sequence) {
    const key = sequenceStorageKey(issueDate);
    if (!key) return;
    try {
      window.localStorage.setItem(key, String(sequence));
    } catch (error) {
      // Storage may be unavailable in private browsing. Printing must remain usable.
    }
  }

  function refreshAutomaticQuoteNumber() {
    if (!quoteNumberIsAutomatic) return;
    fields.quoteNumber.value = makeQuoteNumber(fields.issueDate.value, getLastIssuedSequence(fields.issueDate.value) + 1);
  }

  function finalizeQuoteNumber() {
    if (issuedQuoteNumber && fields.quoteNumber.value.trim() === issuedQuoteNumber) return issuedQuoteNumber;

    if (quoteNumberIsAutomatic) refreshAutomaticQuoteNumber();
    let quoteNumber = fields.quoteNumber.value.trim();
    if (!quoteNumber) {
      quoteNumberIsAutomatic = true;
      refreshAutomaticQuoteNumber();
      quoteNumber = fields.quoteNumber.value.trim();
    }

    const datePart = formatQuoteDate(fields.issueDate.value);
    const match = quoteNumber.match(/^(\d{8})_(\d+)$/);
    if (match && match[1] === datePart) {
      const sequence = Number(match[2]);
      if (sequence > getLastIssuedSequence(fields.issueDate.value)) {
        setLastIssuedSequence(fields.issueDate.value, sequence);
      }
    }
    issuedQuoteNumber = quoteNumber;
    updatePreview();
    return quoteNumber;
  }

  function printEstimate() {
    const quoteNumber = finalizeQuoteNumber();
    const originalTitle = document.title;
    let restored = false;
    const restoreTitle = function () {
      if (restored) return;
      restored = true;
      window.removeEventListener('afterprint', restoreTitle);
      document.title = originalTitle;
    };
    const openPrintDialog = function () {
      window.addEventListener('afterprint', restoreTitle, { once: true });
      window.print();
      restoreTitle();
    };

    document.title = quoteNumber || '見積書';
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(openPrintDialog);
    } else {
      openPrintDialog();
    }
  }

  function setInitialValues() {
    const today = new Date();
    const valid = new Date(today);
    valid.setDate(valid.getDate() + 30);
    fields.issueDate.value = toLocalISODate(today);
    fields.validUntil.value = toLocalISODate(valid);
    quoteNumberIsAutomatic = true;
    issuedQuoteNumber = '';
    refreshAutomaticQuoteNumber();
  }

  function currentClassificationInput() {
    return {
      inquiryText: fields.inquiryText.value,
      purpose: fields.purpose.value,
      sourceType: fields.sourceType.value,
      fitting: fields.fitting.value,
      deliverable: fields.deliverable.value,
      safety: fields.safety.value,
      rush: fields.rush.value
    };
  }

  function setApiClassificationStatus(message, state) {
    const status = byId('api-classification-status');
    status.textContent = message;
    if (state) status.dataset.state = state;
    else delete status.dataset.state;
  }

  function clearApiClassification() {
    if (!apiClassificationResult) return;
    apiClassificationResult = null;
    setApiClassificationStatus('入力内容が変更されました。必要に応じてダミーAPIで再判定してください。');
  }

  function normalizeApiClassification(response) {
    const classification = response && response.classification;
    const code = classification && classification.category && classification.category.code;
    const localCategory = CATEGORIES[code];
    if (!localCategory) throw new Error('APIの判定結果を読み取れませんでした。');
    return {
      category: {
        code: localCategory.code,
        label: classification.category.label || localCategory.label,
        price: normalizeNumber(classification.category.price) || localCategory.price,
        auto: classification.category.auto !== false && localCategory.auto,
        reason: classification.category.reason || localCategory.reason
      },
      warnings: Array.isArray(classification.warnings) ? classification.warnings.map(String) : [],
      inferredPurpose: classification.inferredPurpose || ''
    };
  }

  async function classifyWithApi() {
    const button = byId('classify-with-api');
    button.disabled = true;
    button.textContent = 'APIへ送信中…';
    setApiClassificationStatus('問い合わせ文と選択条件をダミーAPIへ送信しています。', 'loading');
    try {
      const response = await fetch('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentClassificationInput())
      });
      const data = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(data.error || 'API通信に失敗しました（HTTP ' + response.status + '）。');
      apiClassificationResult = normalizeApiClassification(data);
      updateClassification();
      setApiClassificationStatus('ダミーAPIの応答を反映しました。通信テスト成功です。', 'success');
    } catch (error) {
      apiClassificationResult = null;
      updateClassification();
      setApiClassificationStatus(error.message || 'APIへ接続できませんでした。', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'ダミーAPIで判定をテスト';
    }
  }

  function updatePaymentFields() {
    const isCustom = fields.paymentType.value === 'custom';
    byId('custom-payment-label').hidden = !isCustom;
    fields.customPayment.disabled = !isCustom;
  }

  function syncPaymentWithClassification(result) {
    if (!paymentManuallyChanged) {
      fields.paymentType.value = recommendPaymentType(result.category);
    }
    updatePaymentFields();
  }

  function updateClassification() {
    const result = apiClassificationResult || classifyCase(currentClassificationInput());
    const code = byId('category-code');
    const label = byId('category-label');
    const reason = byId('category-reason');
    const warningList = byId('classification-warnings');
    const applyButton = byId('apply-category');
    warningList.replaceChildren();

    if (!result.category) {
      code.textContent = '—';
      label.textContent = '条件を選択すると推奨作業を判定します';
      reason.textContent = '判定後、推奨作業を見積明細へ追加できます。';
      applyButton.disabled = true;
      applyButton.textContent = '推奨作業を見積明細へ追加';
      syncPaymentWithClassification(result);
      return result;
    }

    code.textContent = result.category.code;
    label.textContent = result.category.label + (result.category.auto ? ' / ' + formatYen(result.category.price) + '〜' : ' / 個別見積');
    reason.textContent = result.category.reason;
    result.warnings.forEach(function (warning) {
      const item = document.createElement('li');
      item.textContent = warning;
      warningList.appendChild(item);
    });
    applyButton.disabled = !result.category.auto;
    applyButton.textContent = result.category.auto ? '推奨作業を見積明細へ追加' : '個別見積：範囲確認が必要';
    syncPaymentWithClassification(result);
    return result;
  }

  function makeUnitSelect(selected) {
    const select = document.createElement('select');
    select.className = 'item-unit';
    select.setAttribute('aria-label', '単位');
    ['式', '点', '個', '時間'].forEach(function (unit) {
      const option = document.createElement('option');
      option.value = unit;
      option.textContent = unit;
      option.selected = unit === selected;
      select.appendChild(option);
    });
    return select;
  }

  function createInput(className, type, value, label) {
    const input = document.createElement('input');
    input.className = className;
    input.type = type;
    input.value = value == null ? '' : value;
    input.setAttribute('aria-label', label);
    if (type === 'number') {
      input.min = '0';
      input.step = className === 'item-quantity' ? '0.1' : '1';
      input.inputMode = 'decimal';
    }
    return input;
  }

  function addLineItem(item) {
    const data = item || {};
    const row = document.createElement('tr');
    row.dataset.itemId = String(++itemSequence);
    if (data.categoryCode) row.dataset.categoryItem = data.categoryCode;

    const descriptionCell = document.createElement('td');
    descriptionCell.dataset.label = '内容';
    descriptionCell.appendChild(createInput('item-description', 'text', data.description || '', '内容'));
    const quantityCell = document.createElement('td');
    quantityCell.dataset.label = '数量';
    quantityCell.appendChild(createInput('item-quantity', 'number', data.quantity == null ? 1 : data.quantity, '数量'));
    const unitCell = document.createElement('td');
    unitCell.dataset.label = '単位';
    unitCell.appendChild(makeUnitSelect(data.unit || '式'));
    const priceCell = document.createElement('td');
    priceCell.dataset.label = '単価';
    priceCell.appendChild(createInput('item-price', 'number', data.price == null ? 0 : data.price, '単価'));
    const removeCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.className = 'remove-item';
    remove.type = 'button';
    remove.setAttribute('aria-label', '明細を削除');
    remove.textContent = '×';
    removeCell.appendChild(remove);
    row.append(descriptionCell, quantityCell, unitCell, priceCell, removeCell);
    itemContainer.appendChild(row);
    updatePreview();
    return row;
  }

  function readItems() {
    return Array.from(itemContainer.querySelectorAll('tr')).map(function (row) {
      return {
        description: row.querySelector('.item-description').value.trim(),
        quantity: normalizeNumber(row.querySelector('.item-quantity').value),
        unit: row.querySelector('.item-unit').value,
        price: normalizeNumber(row.querySelector('.item-price').value),
        categoryCode: row.dataset.categoryItem || ''
      };
    });
  }

  function applyCategory() {
    const result = updateClassification();
    if (!result.category || !result.category.auto) return;
    const existing = itemContainer.querySelector('[data-category-item]');
    const item = {
      description: result.category.label + ' 基本作業費',
      quantity: 1,
      unit: '式',
      price: result.category.price,
      categoryCode: result.category.code
    };
    if (existing) {
      existing.dataset.categoryItem = item.categoryCode;
      existing.querySelector('.item-description').value = item.description;
      existing.querySelector('.item-quantity').value = '1';
      existing.querySelector('.item-unit').value = '式';
      existing.querySelector('.item-price').value = String(item.price);
    } else {
      addLineItem(item);
    }
    setStatus(result.category.label + 'を明細へ反映しました。');
    updatePreview();
  }

  function readData() {
    const payment = getPaymentDetails(fields.paymentType.value, fields.customPayment.value);
    return {
      version: 2,
      quoteNumber: fields.quoteNumber.value.trim(),
      issueDate: fields.issueDate.value,
      clientName: fields.clientName.value.trim(),
      honorific: fields.honorific.value,
      projectName: fields.projectName.value.trim(),
      validUntil: fields.validUntil.value,
      delivery: fields.delivery.value.trim(),
      inquiryText: fields.inquiryText.value,
      purpose: fields.purpose.value,
      sourceType: fields.sourceType.value,
      fitting: fields.fitting.value,
      deliverable: fields.deliverable.value,
      safety: fields.safety.value,
      rush: fields.rush.value,
      taxRate: normalizeNumber(fields.taxRate.value),
      paymentType: fields.paymentType.value,
      customPayment: fields.customPayment.value.trim(),
      payment: payment.quoteLabel,
      paymentNote: payment.note,
      outputFormat: fields.outputFormat.value.trim(),
      notes: fields.notes.value,
      items: readItems()
    };
  }

  function setText(id, value) {
    byId(id).textContent = value;
  }

  function setPaymentNote(value) {
    const note = byId('preview-payment-note');
    note.replaceChildren();
    String(value || '').split('\n').forEach(function (line, index) {
      if (index) note.appendChild(document.createTextNode('\n'));
      const lineElement = document.createElement('span');
      lineElement.className = 'payment-note-line';
      const parts = line.split('最終データ');
      lineElement.appendChild(document.createTextNode(parts[0]));
      if (parts.length > 1) {
        const noBreak = document.createElement('span');
        noBreak.className = 'no-break';
        noBreak.textContent = '最終データ';
        lineElement.appendChild(noBreak);
        lineElement.appendChild(document.createTextNode(parts.slice(1).join('最終データ')));
      }
      note.appendChild(lineElement);
    });
  }

  function updatePreview() {
    const data = readData();
    const totals = calculateTotals(data.items, data.taxRate);
    setText('editor-subtotal', formatYen(totals.subtotal));
    setText('editor-tax', formatYen(totals.tax));
    setText('editor-total', formatYen(totals.total));
    setText('preview-number', data.quoteNumber || '—');
    setText('preview-date', formatDate(data.issueDate));
    setText('preview-client', data.clientName || '宛名未入力');
    setText('preview-honorific', data.honorific || '');
    setText('preview-project', data.projectName || '案件名未入力');
    setText('preview-grand-total', formatYen(totals.total));
    setText('preview-subtotal', formatYen(totals.subtotal));
    setText('preview-tax', formatYen(totals.tax));
    setText('preview-total', formatYen(totals.total));
    setText('preview-valid-until', formatDate(data.validUntil));
    setText('preview-delivery', data.delivery || '別途協議');
    setText('preview-payment', data.payment || DEFAULT_PAYMENT);
    setPaymentNote(data.paymentNote || PAYMENT_TERMS.prepaid.note);
    setText('preview-output-format', data.outputFormat || '別途協議');
    setText('preview-notes', data.notes || DEFAULT_NOTES);

    const previewItems = byId('preview-items');
    previewItems.replaceChildren();
    if (!data.items.length) {
      const row = document.createElement('tr');
      row.className = 'empty-row';
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = '見積明細を入力してください';
      row.appendChild(cell);
      previewItems.appendChild(row);
      return;
    }

    data.items.forEach(function (item) {
      const row = document.createElement('tr');
      const values = [
        item.description || '未入力',
        String(item.quantity),
        item.unit,
        formatYen(item.price),
        formatYen(item.quantity * item.price)
      ];
      values.forEach(function (value) {
        const cell = document.createElement('td');
        cell.textContent = value;
        cell.title = value;
        row.appendChild(cell);
      });
      previewItems.appendChild(row);
    });
  }

  function clearImagePreviews() {
    previewObjectUrls.forEach(function (url) { URL.revokeObjectURL(url); });
    previewObjectUrls = [];
    byId('capture-preview').replaceChildren();
    byId('capture-status').textContent = '画像未選択';
  }

  function showImages(files) {
    const images = Array.from(files || []).filter(function (file) { return file.type.startsWith('image/'); });
    clearImagePreviews();
    if (!images.length) return;
    const preview = byId('capture-preview');
    images.slice(0, 8).forEach(function (file) {
      const url = URL.createObjectURL(file);
      previewObjectUrls.push(url);
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = url;
      image.alt = file.name || '貼り付け画像';
      const caption = document.createElement('figcaption');
      caption.textContent = file.name || '貼り付け画像';
      figure.append(image, caption);
      preview.appendChild(figure);
    });
    byId('capture-status').textContent = images.length + '件を確認中';
  }

  function setStatus(message) {
    byId('action-status').textContent = message;
  }

  async function copySummary() {
    const summary = buildSummary(readData());
    try {
      await navigator.clipboard.writeText(summary);
    } catch (error) {
      const helper = document.createElement('textarea');
      helper.value = summary;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.appendChild(helper);
      helper.select();
      document.execCommand('copy');
      helper.remove();
    }
    setStatus('見積内容をクリップボードへコピーしました。');
  }

  function downloadJson() {
    const data = readData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = (data.quoteNumber || 'estimate') + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus('編集データを保存しました。');
  }

  function setFieldValue(key, value) {
    if (fields[key] && value != null) fields[key].value = String(value);
  }

  function inferPaymentType(payment) {
    const value = String(payment || '');
    if (/着手金50/.test(value)) return 'split';
    if (!value || /前払い|入金確認後に着手/.test(value)) return 'prepaid';
    return 'custom';
  }

  function loadData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.items)) throw new Error('見積データの形式が正しくありません。');
    const paymentType = data.paymentType || inferPaymentType(data.payment);
    quoteNumberIsAutomatic = !String(data.quoteNumber || '').trim();
    issuedQuoteNumber = '';
    apiClassificationResult = null;
    Object.keys(fields).forEach(function (key) {
      if (key !== 'taxRate' && key !== 'paymentType' && key !== 'customPayment') setFieldValue(key, data[key]);
    });
    setFieldValue('taxRate', data.taxRate == null ? 10 : data.taxRate);
    fields.paymentType.value = paymentType;
    fields.customPayment.value = data.customPayment || (paymentType === 'custom' ? data.payment || '' : '');
    if (quoteNumberIsAutomatic) refreshAutomaticQuoteNumber();
    paymentManuallyChanged = true;
    updatePaymentFields();
    itemContainer.replaceChildren();
    data.items.forEach(addLineItem);
    if (!data.items.length) updatePreview();
    updateClassification();
  }

  function resetForm() {
    if (!window.confirm('入力中の見積内容をリセットしますか？')) return;
    form.reset();
    itemContainer.replaceChildren();
    clearImagePreviews();
    apiClassificationResult = null;
    setApiClassificationStatus('現在は通信確認用のダミーAPIです。実APIへの送信はまだ行いません。');
    setInitialValues();
    paymentManuallyChanged = false;
    fields.paymentType.value = 'prepaid';
    fields.customPayment.value = '';
    updatePaymentFields();
    addLineItem();
    updateClassification();
    updatePreview();
    setStatus('入力内容をリセットしました。');
  }

  form.addEventListener('input', function (event) {
    if (event.target === fields.quoteNumber) {
      quoteNumberIsAutomatic = false;
      issuedQuoteNumber = '';
    }
    if (event.target === fields.issueDate) {
      issuedQuoteNumber = '';
      refreshAutomaticQuoteNumber();
    }
    if (classificationFields.includes(event.target)) clearApiClassification();
    if (event.target === fields.paymentType || event.target === fields.customPayment) paymentManuallyChanged = true;
    updateClassification();
    updatePreview();
  });
  form.addEventListener('change', function (event) {
    if (event.target === fields.issueDate) {
      issuedQuoteNumber = '';
      refreshAutomaticQuoteNumber();
    }
    if (classificationFields.includes(event.target)) clearApiClassification();
    if (event.target === fields.paymentType || event.target === fields.customPayment) paymentManuallyChanged = true;
    updateClassification();
    updatePreview();
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    updatePreview();
    printEstimate();
  });
  itemContainer.addEventListener('click', function (event) {
    const button = event.target.closest('.remove-item');
    if (!button) return;
    button.closest('tr').remove();
    updatePreview();
  });
  byId('add-item').addEventListener('click', function () { addLineItem(); });
  byId('apply-category').addEventListener('click', applyCategory);
  byId('classify-with-api').addEventListener('click', classifyWithApi);
  byId('source-images').addEventListener('change', function (event) { showImages(event.target.files); });
  byId('capture-zone').addEventListener('paste', function (event) {
    const files = Array.from(event.clipboardData.files || []);
    if (files.some(function (file) { return file.type.startsWith('image/'); })) {
      event.preventDefault();
      showImages(files);
    }
  });
  byId('copy-summary').addEventListener('click', copySummary);
  byId('save-json').addEventListener('click', downloadJson);
  byId('load-json-button').addEventListener('click', function () { byId('load-json').click(); });
  byId('load-json').addEventListener('change', function (event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener('load', function () {
      try {
        loadData(JSON.parse(String(reader.result)));
        setStatus('編集データを読み込み、入力内容を復元しました。');
      } catch (error) {
        setStatus(error.message || '編集データを読み込めませんでした。');
      }
      event.target.value = '';
    });
    reader.readAsText(file, 'utf-8');
  });
  byId('reset-estimate').addEventListener('click', resetForm);

  setInitialValues();
  updatePaymentFields();
  addLineItem();
  updateClassification();
  updatePreview();
})(typeof window !== 'undefined' ? window : globalThis);
