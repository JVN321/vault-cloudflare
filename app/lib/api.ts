// app/lib/api.ts – Frontend API client functions (calls Worker endpoints)
import type {
  ApiResponse,
  VaultUser,
  AccessLogEntry,
  SensorData,
  ImageMeta,
  SystemConfig,
  TempPin,
} from "./types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) throw new Error(json.error);
  return json.data;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const authApi = {
  signIn: (email: string, password: string) =>
    request<{ user: VaultUser }>("/v1/auth/signin", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  signOut: () =>
    request<void>("/v1/auth/signout", { method: "POST" }),

  me: () => request<{ user: VaultUser }>("/v1/auth/me"),

  updatePin: (currentPin: string, newPin: string) =>
    request<void>("/v1/settings/master-pin", {
      method: "PATCH",
      body: JSON.stringify({ pin: newPin }),
    }),
};

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const usersApi = {
  list: () => request<VaultUser[]>("/v1/users"),

  get: (id: number) => request<VaultUser>(`/v1/users/${id}`),

  create: (data: Partial<VaultUser> & { password: string }) =>
    request<VaultUser>("/v1/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  enrollFace: (name: string, objectKey: string) =>
    request<VaultUser>("/v1/users/enroll-face", {
      method: "POST",
      body: JSON.stringify({ name, objectKey }),
    }),

  update: (id: number, data: Partial<VaultUser>) =>
    request<VaultUser>(`/v1/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  updateAccess: (
    id: number,
    data: { status?: string; allowedAuthMethods?: string[] }
  ) =>
    request<VaultUser>(`/v1/users/${id}/access`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  remove: (id: number) =>
    request<void>(`/v1/users/${id}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Access logs
// ---------------------------------------------------------------------------
export const logsApi = {
  list: (limit = 50) =>
    request<AccessLogEntry[]>(`/v1/access-logs?limit=${limit}`),

  create: (data: {
    userId?: number;
    method: string;
    success: boolean;
    location?: string;
    action?: string;
  }) =>
    request<AccessLogEntry>("/v1/access-logs", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};

// ---------------------------------------------------------------------------
// System config / settings
// ---------------------------------------------------------------------------
export const settingsApi = {
  get: () => request<SystemConfig>("/v1/settings"),
  update: (config: Partial<SystemConfig>) =>
    request<SystemConfig>("/v1/settings", {
      method: "PATCH",
      body: JSON.stringify(config),
    }),
};

// ---------------------------------------------------------------------------
// Temporary codes
// ---------------------------------------------------------------------------
export const tempPinsApi = {
  list: () => request<TempPin[]>("/v1/temp-pins"),
  create: (data: {
    pin: string;
    label?: string;
    expiresAt: string;
    maxUses?: number;
  }) =>
    request<TempPin>("/v1/temp-pins", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  revoke: (id: number) =>
    request<null>(`/v1/temp-pins/${id}`, { method: "DELETE" }),
  revokeAll: () =>
    request<null>("/v1/temp-pins", { method: "DELETE" }),
};


// ---------------------------------------------------------------------------
// Images (ESP32 camera feed)
// ---------------------------------------------------------------------------
export const imagesApi = {
  list: (limit = 50, motionOnly = false) =>
    request<ImageMeta[]>(`/v1/images?limit=${limit}${motionOnly ? "&motion=1" : ""}`),
  latest: () => request<ImageMeta | null>("/v1/images/latest"),
  getUrl: (objectKey: string) => `${BASE}/v1/images/serve/${encodeURIComponent(objectKey)}`,
  getDownloadUrl: (objectKey: string) =>
    `${BASE}/v1/images/serve/${encodeURIComponent(objectKey)}?download=1`,
  delete: (id: number) => request<void>(`/v1/images/${id}`, { method: "DELETE" }),
  cleanup: () => request<{ deleted: number; cutoff: string }>("/v1/images/cleanup", { method: "POST" }),
};

// ---------------------------------------------------------------------------
// Sensor readings
// ---------------------------------------------------------------------------
export const sensorApi = {
  latest: () => request<SensorData | null>("/v1/sensor/latest"),
};

// ---------------------------------------------------------------------------
// Hardware Commands
// ---------------------------------------------------------------------------
export const commandsApi = {
  send: (type: "LOCK" | "UNLOCK" | "PULSE") =>
    request<{ id: number }>("/v1/commands", {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
};

