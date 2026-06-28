-- Migration: 0003_face_image_retention.sql

INSERT OR IGNORE INTO settings (key, value) VALUES ('image_retention_days', '30');
INSERT OR IGNORE INTO settings (key, value) VALUES ('face_confidence_threshold', '60');
INSERT OR IGNORE INTO settings (key, value) VALUES ('faceset_id', 'VAULT_FACESET');
