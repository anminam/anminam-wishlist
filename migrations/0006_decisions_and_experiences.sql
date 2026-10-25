-- Private planning data is served only through authenticated admin endpoints.
CREATE TABLE wish_experiences (
  wish_id TEXT PRIMARY KEY REFERENCES wishes(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  usage TEXT CHECK (usage IN ('using', 'rarely', 'finished')),
  note TEXT NOT NULL DEFAULT '',
  remind_after TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE decision_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE decision_members (
  group_id TEXT NOT NULL REFERENCES decision_groups(id) ON DELETE CASCADE,
  wish_id TEXT NOT NULL REFERENCES wishes(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, wish_id)
);
CREATE INDEX idx_decision_members_wish ON decision_members(wish_id);
