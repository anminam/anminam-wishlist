ALTER TABLE wishes ADD COLUMN planned_month TEXT;
ALTER TABLE wishes ADD COLUMN review_after TEXT;

CREATE INDEX IF NOT EXISTS idx_wishes_planned_month
  ON wishes(planned_month, status);
