CREATE TABLE IF NOT EXISTS wishes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  image_key TEXT,
  price INTEGER,
  currency TEXT NOT NULL DEFAULT 'KRW',
  category TEXT,
  reason TEXT,
  source TEXT,
  purchased INTEGER NOT NULL DEFAULT 0 CHECK (purchased IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wishes_created_at ON wishes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishes_category ON wishes(category);
