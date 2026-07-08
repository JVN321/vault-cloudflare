
export function ok<T>(data: T) {
  return Response.json({ success: true, data });
}

export function err(message: string, status = 400) {
  return Response.json({ success: false, error: message }, { status });
}

export async function hashPassword(plain: string): Promise<string> {
  const enc = new TextEncoder().encode(plain);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  return arrayBufferToBase64(hashBuffer);
}

export async function verifyPassword(plain: string, hashBase64: string): Promise<boolean> {
  const newHash = await hashPassword(plain);
  return newHash === hashBase64;
}

export async function sha256Hex(plain: string): Promise<string> {
  const enc = new TextEncoder().encode(plain);
  const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function generateTempCode(): string {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VLT-${seg()}-${seg()}`;
}

export async function facePlusPlus(endpoint: string, apiKey: string, apiSecret: string, data: Record<string, string>, retries = 3): Promise<any> {
  const form = new FormData();
  form.append("api_key", apiKey);
  form.append("api_secret", apiSecret);
  for (const [k, v] of Object.entries(data)) form.append(k, v);

  const res = await fetch(`https://api-us.faceplusplus.com/facepp/v3/${endpoint}`, {
    method: "POST",
    body: form,
  });
  const json = await res.json();
  if (!res.ok) {
    const errorMsg = (json as any).error_message || "Face++ API error";
    if (errorMsg === "CONCURRENCY_LIMIT_EXCEEDED" && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return facePlusPlus(endpoint, apiKey, apiSecret, data, retries - 1);
    }
    throw new Error(errorMsg);
  }
  return json;
}

export const DEFAULT_SETTINGS: Record<string, string> = {
  allowFaceAuth: "true",
  allowPinAuth: "true",
  allowQrAuth: "true",
  allowBarcodeAuth: "false",
  allowRfidAuth: "true",
  failedAttemptLimit: "3",
  autoLockSeconds: "30",
  realtimeAlerts: "true",
  motionDetection: "false",
  master_pin_sha256: "",
  poll_interval_ms: "2000",
  image_retention_days: "30",
  face_confidence_threshold: "40",
  faceset_id: "VAULT_FACESET",
  faceplusplusApiKey: "",
  faceplusplusApiSecret: "",
  livestream_active: "false",
};

export function parseSettings(map: Record<string, string>): Record<string, unknown> {
  return {
    allowFaceAuth: map["allowFaceAuth"] === "true",
    allowPinAuth: map["allowPinAuth"] === "true",
    allowQrAuth: map["allowQrAuth"] === "true",
    allowBarcodeAuth: map["allowBarcodeAuth"] === "true",
    allowRfidAuth: map["allowRfidAuth"] === "true",
    failedAttemptLimit: Number(map["failedAttemptLimit"] ?? "3"),
    autoLockSeconds: Number(map["autoLockSeconds"] ?? "30"),
    realtimeAlerts: map["realtimeAlerts"] === "true",
    motionDetection: map["motionDetection"] === "true",
    faceplusplusApiKey: map["faceplusplusApiKey"] || "",
    faceplusplusApiSecret: map["faceplusplusApiSecret"] || "",
    faceplusplusFaceset: map["faceset_id"] || "VAULT_FACESET",
    faceConfidenceThreshold: Number(map["face_confidence_threshold"] ?? "40"),
    imageRetentionDays: Number(map["image_retention_days"] ?? "30"),
    pollIntervalMs: Number(map["poll_interval_ms"] ?? "2000"),
    livestreamActive: map["livestream_active"] === "true",
  };
}
