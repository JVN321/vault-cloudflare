// app/lib/types.ts – Shared types between frontend and backend
export type ApiResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

export type AuthMethod = "FACE" | "PIN" | "QR" | "BARCODE" | "RFID" | "TEMP_CODE";
export type UserRole = "ADMIN" | "MANAGER" | "EMPLOYEE" | "VISITOR";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "INACTIVE";
export type AccessAction = "ENTRY" | "EXIT";
export type TempCodeStatus = "ACTIVE" | "USED" | "EXPIRED";

// Frontend display types (mirrors DB types but with friendlier field names)
export interface VaultUser {
  id: number;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  department: string | null;
  allowedAuthMethods: AuthMethod[];
  createdAt: string;
}

export interface AccessLogEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  method: AuthMethod;
  success: boolean;
  location: string | null;
  action: AccessAction | null;
  timestamp: string;
}

export interface SensorData {
  cameraId?: number;
  temperature?: number;
  humidity?: number;
  voltage?: number;
  motion?: boolean;
}

export interface ImageMeta {
  id: number;
  cameraId: number | null;
  objectKey: string;
  timestamp: string;
  motionDetected: boolean;
}

export interface SystemConfig {
  allowFaceAuth: boolean;
  allowPinAuth: boolean;
  allowQrAuth: boolean;
  allowBarcodeAuth: boolean;
  allowRfidAuth: boolean;
  failedAttemptLimit: number;
  autoLockSeconds: number;
  realtimeAlerts: boolean;
  motionDetection: boolean;
}

export interface TempCode {
  id: number;
  code: string;
  location: string;
  accessType: string;
  validFrom: string;
  expiresAt: string;
  status: TempCodeStatus;
  notes: string | null;
}
