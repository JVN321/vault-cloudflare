-- Migration: 0002_commands_temp_pins.sql

CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('LOCK','UNLOCK','PULSE')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','EXECUTED','EXPIRED','FAILED')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  executed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS temp_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin_sha256 TEXT NOT NULL,
  label TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','USED','REVOKED','EXPIRED')),
  max_uses INTEGER NOT NULL DEFAULT 1,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- New settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('master_pin_sha256', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('poll_interval_ms', '2000');
