CREATE TABLE IF NOT EXISTS inquiries (
  inquiry_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  submission_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT NOT NULL,
  deadline TEXT,
  message TEXT NOT NULL,
  object_name TEXT,
  vehicle TEXT,
  budget TEXT,
  has_3d_data TEXT,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'processing'
);

CREATE INDEX IF NOT EXISTS idx_inquiries_received_at ON inquiries(received_at);
CREATE INDEX IF NOT EXISTS idx_inquiries_status ON inquiries(status);
