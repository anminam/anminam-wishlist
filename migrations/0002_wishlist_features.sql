CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  slug TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'private')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE wishes ADD COLUMN status TEXT NOT NULL DEFAULT 'wanted'
  CHECK (status IN ('wanted', 'purchased', 'archived'));
ALTER TABLE wishes ADD COLUMN priority INTEGER NOT NULL DEFAULT 2
  CHECK (priority BETWEEN 1 AND 3);
ALTER TABLE wishes ADD COLUMN target_price INTEGER;
ALTER TABLE wishes ADD COLUMN purchased_at TEXT;
ALTER TABLE wishes ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (visibility IN ('public', 'unlisted', 'private'));
ALTER TABLE wishes ADD COLUMN share_slug TEXT;
ALTER TABLE wishes ADD COLUMN collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL;
ALTER TABLE wishes ADD COLUMN track_price INTEGER NOT NULL DEFAULT 0
  CHECK (track_price IN (0, 1));
ALTER TABLE wishes ADD COLUMN last_price_checked_at TEXT;

UPDATE wishes
SET status = CASE WHEN purchased = 1 THEN 'purchased' ELSE 'wanted' END,
    purchased_at = CASE WHEN purchased = 1 THEN updated_at ELSE NULL END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wishes_share_slug
  ON wishes(share_slug) WHERE share_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wishes_status_created
  ON wishes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishes_collection
  ON wishes(collection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wishes_price_tracking
  ON wishes(track_price, status, last_price_checked_at);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wish_tags (
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (wish_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_wish_tags_tag ON wish_tags(tag_id, wish_id);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  guest_token_hash TEXT NOT NULL,
  guest_name TEXT,
  message TEXT,
  expires_at TEXT NOT NULL,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_active_wish
  ON reservations(wish_id) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON reservations(expires_at) WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS price_history (
  id TEXT PRIMARY KEY,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KRW',
  captured_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_price_history_wish_time
  ON price_history(wish_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  wish_id TEXT REFERENCES wishes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('price_drop', 'target_reached', 'reservation')),
  message TEXT NOT NULL,
  value INTEGER,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (wish_id, type, value)
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications(read_at, created_at DESC);
