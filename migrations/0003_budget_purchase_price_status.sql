ALTER TABLE wishes ADD COLUMN purchase_price INTEGER;
ALTER TABLE wishes ADD COLUMN last_price_check_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (last_price_check_status IN ('unknown', 'pending', 'success', 'unavailable', 'error'));

CREATE TABLE IF NOT EXISTS monthly_budgets (
  month TEXT PRIMARY KEY,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE wishes
SET purchase_price = price
WHERE status = 'purchased' AND purchase_price IS NULL;
