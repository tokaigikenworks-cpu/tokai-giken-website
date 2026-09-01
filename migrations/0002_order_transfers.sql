CREATE TABLE IF NOT EXISTS order_transfers (
  record_id TEXT PRIMARY KEY,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  transfer_status TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  payload_sha256 TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_transfers_status
  ON order_transfers (transfer_status, created_at);
