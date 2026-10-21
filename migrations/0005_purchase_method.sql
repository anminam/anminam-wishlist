ALTER TABLE wishes ADD COLUMN purchase_method TEXT NOT NULL DEFAULT 'unknown'
  CHECK (purchase_method IN ('unknown', 'self', 'gift', 'other'));
