-- Shared catalog ---------------------------------------------------------

CREATE TABLE works (
  id INTEGER PRIMARY KEY,
  normalised_title TEXT NOT NULL,
  normalised_primary_author TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_works_title_author ON works (normalised_title, normalised_primary_author);

CREATE TABLE editions (
  id INTEGER PRIMARY KEY,
  work_id INTEGER REFERENCES works (id),
  owner_user_id INTEGER REFERENCES users (id), -- set only for private, fully manual editions
  isbn13 TEXT,
  isbn10 TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  authors TEXT,            -- JSON array
  publisher TEXT,
  publish_date TEXT,
  format TEXT,
  page_count INTEGER,
  language TEXT,
  description TEXT,
  subjects TEXT,           -- JSON array
  series_name TEXT,
  series_number TEXT,
  cover_key TEXT,
  field_provenance TEXT,   -- JSON: { field: { source, at } }
  fetched_at TEXT
);
CREATE INDEX idx_editions_isbn13 ON editions (isbn13);
CREATE INDEX idx_editions_isbn10 ON editions (isbn10);
CREATE INDEX idx_editions_work ON editions (work_id);
CREATE INDEX idx_editions_owner ON editions (owner_user_id);

-- Users and per-user data --------------------------------------------------

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE copies (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  edition_id INTEGER NOT NULL REFERENCES editions (id),
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned', 'wishlist')),
  read_status TEXT NOT NULL DEFAULT 'unread',
  rating INTEGER,
  notes TEXT,
  location TEXT,
  lent_to TEXT,
  lent_at TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_copies_user ON copies (user_id, added_at);
CREATE INDEX idx_copies_edition ON copies (edition_id);
CREATE INDEX idx_copies_user_status ON copies (user_id, status);
CREATE INDEX idx_copies_user_read ON copies (user_id, read_status);

CREATE TABLE copy_overrides (
  copy_id INTEGER NOT NULL REFERENCES copies (id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value TEXT,
  locked INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (copy_id, field)
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE copy_tags (
  copy_id INTEGER NOT NULL REFERENCES copies (id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (copy_id, tag_id)
);
CREATE INDEX idx_copy_tags_tag ON copy_tags (tag_id);

CREATE TABLE custom_covers (
  copy_id INTEGER PRIMARY KEY REFERENCES copies (id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL
);

CREATE TABLE scan_usage (
  user_id INTEGER NOT NULL REFERENCES users (id),
  date TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE review_queue (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  detected TEXT NOT NULL,   -- JSON
  candidates TEXT,          -- JSON
  confidence REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_review_user ON review_queue (user_id, created_at);
