/**
 * 見積ツールの未対応案件キュー用Apps Script追加コード。
 *
 * 既存doPost(e)でSecret検証とenvironmentから対象シートを決定した後、
 * 次のように呼び出してください。
 *
 * if (payload.action === 'listPendingInquiries' || payload.action === 'claimInquiry') {
 *   return jsonResponse_(handlePendingQueueAction_(payload, targetSheet));
 * }
 *
 * targetSheetはenvironmentに応じてサーバー側で決定済みの
 * 案件一覧_PREVIEWまたは案件一覧_PRODUCTIONを渡してください。
 * ブラウザから渡されたシート名は使用しないでください。
 */
function handlePendingQueueAction_(payload, targetSheet) {
  if (payload.action === 'listPendingInquiries') {
    return listPendingInquiries_(targetSheet, payload.limit);
  }
  if (payload.action === 'claimInquiry') {
    return claimInquiry_(targetSheet, payload.recordId);
  }
  return { ok: false, error: 'unsupported_action' };
}

function pendingQueueHeaderMap_(headers) {
  return headers.reduce(function (map, name, index) {
    map[String(name || '').trim()] = index;
    return map;
  }, {});
}

function pendingQueueRowRecord_(headers, row) {
  var record = {};
  headers.forEach(function (name, index) {
    var key = String(name || '').trim();
    if (key) record[key] = row[index];
  });

  if (record.attachmentMetaJson) {
    try {
      record.attachmentMetadata = JSON.parse(String(record.attachmentMetaJson));
    } catch (error) {
      record.attachmentMetadata = [];
    }
  }
  return record;
}

function pendingQueueTimestamp_(record) {
  var value = new Date(record.inquiryReceivedAt || record.createdAt || '').getTime();
  return isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function listPendingInquiries_(sheet, requestedLimit) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: true, count: 0, items: [] };

  var headers = values[0].map(String);
  var map = pendingQueueHeaderMap_(headers);
  if (map.recordId == null || map.status == null) {
    return { ok: false, error: 'required_headers_missing' };
  }

  var limit = Math.max(1, Math.min(100, Number(requestedLimit) || 100));
  var items = values.slice(1).map(function (row) {
    return pendingQueueRowRecord_(headers, row);
  }).filter(function (record) {
    return String(record.recordId || '').trim() && String(record.status || '').trim() === '未対応';
  }).sort(function (left, right) {
    return pendingQueueTimestamp_(left) - pendingQueueTimestamp_(right);
  });

  return {
    ok: true,
    count: items.length,
    items: items.slice(0, limit)
  };
}

function claimInquiry_(sheet, recordId) {
  var normalizedRecordId = String(recordId || '').trim();
  if (!normalizedRecordId) return { ok: false, error: 'invalid_record_id' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var range = sheet.getDataRange();
    var values = range.getValues();
    if (values.length < 2) return { ok: false, error: 'record_not_found' };

    var headers = values[0].map(String);
    var map = pendingQueueHeaderMap_(headers);
    if (map.recordId == null || map.status == null) {
      return { ok: false, error: 'required_headers_missing' };
    }

    for (var index = 1; index < values.length; index += 1) {
      if (String(values[index][map.recordId] || '').trim() !== normalizedRecordId) continue;

      var currentStatus = String(values[index][map.status] || '').trim();
      if (currentStatus !== '未対応') {
        return { ok: false, error: 'already_claimed', status: currentStatus };
      }

      values[index][map.status] = '確認中';
      sheet.getRange(index + 1, map.status + 1).setValue('確認中');
      if (map.updatedAt != null) {
        var updatedAt = new Date().toISOString();
        values[index][map.updatedAt] = updatedAt;
        sheet.getRange(index + 1, map.updatedAt + 1).setValue(updatedAt);
      }
      SpreadsheetApp.flush();

      return {
        ok: true,
        action: 'claimed',
        record: pendingQueueRowRecord_(headers, values[index])
      };
    }
    return { ok: false, error: 'record_not_found' };
  } finally {
    lock.releaseLock();
  }
}
