const LOCKED_TRANSFER_STATUSES = new Set(['ready', 'processed', 'pending', 'error']);

export function isOrderTransferLockedStatus(status) {
  return LOCKED_TRANSFER_STATUSES.has(String(status || '').trim().toLowerCase());
}

export async function queryOrderTransferLock(env = {}, recordId) {
  if (!env.CONTACT_DB || typeof env.CONTACT_DB.prepare !== 'function') {
    return { available: false, locked: false, status: 'not_started' };
  }

  const row = await env.CONTACT_DB.prepare(
    'SELECT transfer_status FROM order_transfers WHERE record_id = ?1'
  ).bind(recordId).first();
  const status = String(row && row.transfer_status || 'not_started').trim().toLowerCase();
  return {
    available: true,
    locked: isOrderTransferLockedStatus(status),
    status
  };
}
