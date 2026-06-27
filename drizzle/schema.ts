import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", {
    enum: ["ADMIN", "MANAGER", "EMPLOYEE", "VISITOR"],
  })
    .notNull()
    .default("VISITOR"),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED", "INACTIVE"] })
    .notNull()
    .default("ACTIVE"),
  department: text("department"),
  allowedAuthMethods: text("allowed_auth_methods")
    .notNull()
    .default("[]"), // JSON-encoded string[]
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Credentials (PIN, QR, FACE, RFID, BARCODE)
// ---------------------------------------------------------------------------
export const credentials = sqliteTable("credentials", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialType: text("credential_type", {
    enum: ["FACE", "PIN", "QR", "BARCODE", "RFID"],
  }).notNull(),
  credentialValue: text("credential_value").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Temporary access codes
// ---------------------------------------------------------------------------
export const temporaryCodes = sqliteTable("temporary_codes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  location: text("location").notNull(),
  accessType: text("access_type").notNull(),
  validFrom: text("valid_from").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status", { enum: ["ACTIVE", "USED", "EXPIRED"] })
    .notNull()
    .default("ACTIVE"),
  notes: text("notes"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------
export const cameras = sqliteTable("cameras", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().unique(),
  location: text("location"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Sensor readings from ESP32/cameras
// ---------------------------------------------------------------------------
export const sensorReadings = sqliteTable("sensor_readings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cameraId: integer("camera_id").references(() => cameras.id, {
    onDelete: "set null",
  }),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
  temperature: real("temperature"),
  humidity: real("humidity"),
  voltage: real("voltage"),
  motion: integer("motion", { mode: "boolean" }).notNull().default(false),
});

// ---------------------------------------------------------------------------
// Images stored in R2 (only metadata in D1)
// ---------------------------------------------------------------------------
export const images = sqliteTable("images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cameraId: integer("camera_id").references(() => cameras.id, {
    onDelete: "set null",
  }),
  objectKey: text("object_key").notNull(), // R2 key
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
  motionDetected: integer("motion_detected", { mode: "boolean" })
    .notNull()
    .default(false),
  fileSize: integer("file_size"),
  mimeType: text("mime_type").default("image/jpeg"),
});

// ---------------------------------------------------------------------------
// Access logs
// ---------------------------------------------------------------------------
export const accessLogs = sqliteTable("access_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  method: text("method", {
    enum: ["FACE", "PIN", "QR", "BARCODE", "RFID", "TEMP_CODE"],
  }).notNull(),
  success: integer("success", { mode: "boolean" }).notNull(),
  location: text("location"),
  action: text("action", { enum: ["ENTRY", "EXIT"] }).default("ENTRY"),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Security events
// ---------------------------------------------------------------------------
export const securityEvents = sqliteTable("security_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  eventType: text("event_type", {
    enum: [
      "MOTION_DETECTED",
      "PERSON_DETECTED",
      "UNAUTHORIZED_ACCESS",
      "MULTIPLE_FAILED_ATTEMPTS",
      "CAMERA_OFFLINE",
      "DOOR_FORCED_OPEN",
    ],
  }).notNull(),
  description: text("description"),
  imageId: integer("image_id").references(() => images.id, {
    onDelete: "set null",
  }),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// System settings / config
// ---------------------------------------------------------------------------
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// System logs
// ---------------------------------------------------------------------------
export const systemLogs = sqliteTable("system_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  logLevel: text("log_level", {
    enum: ["INFO", "WARNING", "ERROR", "SECURITY"],
  }).notNull(),
  message: text("message").notNull(),
  timestamp: text("timestamp")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Auth sessions (cookie-based, stored server-side)
// ---------------------------------------------------------------------------
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // UUID
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Credential = typeof credentials.$inferSelect;
export type Camera = typeof cameras.$inferSelect;
export type SensorReading = typeof sensorReadings.$inferSelect;
export type NewSensorReading = typeof sensorReadings.$inferInsert;
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type AccessLog = typeof accessLogs.$inferSelect;
export type NewAccessLog = typeof accessLogs.$inferInsert;
export type SecurityEvent = typeof securityEvents.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type TemporaryCode = typeof temporaryCodes.$inferSelect;
