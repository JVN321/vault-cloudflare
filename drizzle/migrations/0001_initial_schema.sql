-- Migration: 0001_initial_schema.sql
-- Cloudflare D1 (SQLite) initial schema for vault-cloudflare

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'VISITOR' CHECK(role IN ('ADMIN','MANAGER','EMPLOYEE','VISITOR')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  department TEXT,
  allowed_auth_methods TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_type TEXT NOT NULL CHECK(credential_type IN ('FACE','PIN','QR','BARCODE','RFID')),
  credential_value TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS temporary_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  location TEXT NOT NULL,
  access_type TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','USED','EXPIRED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cameras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  location TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  temperature REAL,
  humidity REAL,
  voltage REAL,
  motion INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  camera_id INTEGER REFERENCES cameras(id) ON DELETE SET NULL,
  object_key TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  motion_detected INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER,
  mime_type TEXT DEFAULT 'image/jpeg'
);

CREATE TABLE IF NOT EXISTS access_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK(method IN ('FACE','PIN','QR','BARCODE','RFID','TEMP_CODE')),
  success INTEGER NOT NULL,
  location TEXT,
  action TEXT DEFAULT 'ENTRY' CHECK(action IN ('ENTRY','EXIT')),
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'MOTION_DETECTED','PERSON_DETECTED','UNAUTHORIZED_ACCESS',
    'MULTIPLE_FAILED_ATTEMPTS','CAMERA_OFFLINE','DOOR_FORCED_OPEN'
  )),
  description TEXT,
  image_id INTEGER REFERENCES images(id) ON DELETE SET NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_level TEXT NOT NULL CHECK(log_level IN ('INFO','WARNING','ERROR','SECURITY')),
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Default system config
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('allowFaceAuth', 'true'),
  ('allowPinAuth', 'true'),
  ('allowQrAuth', 'true'),
  ('allowBarcodeAuth', 'false'),
  ('allowRfidAuth', 'true'),
  ('failedAttemptLimit', '3'),
  ('autoLockSeconds', '30'),
  ('realtimeAlerts', 'true'),
  ('motionDetection', 'false');

-- Default admin camera
INSERT OR IGNORE INTO cameras (name, api_key, location) VALUES
  ('Main Entry CAM-01', 'cam-default-api-key-change-me', 'Main Entrance');
