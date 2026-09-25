#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ==================== CONFIGURATION ====================
const char* ssid     = "realme";
const char* password = "123456789";
String SERVER_URL = "https://vault-cloudflare-8fu.pages.dev";
String CAMERA_API_KEY = "cameraapisecretkeyafagalglhlia";

// ==================== CAMERA PINOUT (XIAO ESP32-S3 SENSE) ====================
#define PWDN_GPIO_NUM     -1
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM     10
#define SIOD_GPIO_NUM     40
#define SIOC_GPIO_NUM     39
#define Y9_GPIO_NUM       48
#define Y8_GPIO_NUM       11
#define Y7_GPIO_NUM       12
#define Y6_GPIO_NUM       14
#define Y5_GPIO_NUM       16
#define Y4_GPIO_NUM       18
#define Y3_GPIO_NUM       17
#define Y2_GPIO_NUM       15
#define VSYNC_GPIO_NUM    38
#define HREF_GPIO_NUM     47
#define PCLK_GPIO_NUM     13

#define FLASH_LED_PIN     21 // Onboard Flash LED (Active-Low: LOW is ON, HIGH is OFF)

bool g_livestream = false;
unsigned long g_last_frame = 0;
unsigned long g_last_poll = 0;
unsigned int poll_interval_ms = 2000;
const unsigned int LIVESTREAM_INTERVAL_MS = 500; // ~2 fps matches Cloudflare dashboard polling

unsigned long g_last_heartbeat_send = 0;

// Helper: General HTTP frame upload (e.g. Gallery / Snapshot)
bool uploadFrame(const char* path, uint8_t* data, size_t len) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SERVER_URL + String(path);
  if (url.indexOf('?') >= 0) {
    url += "&api_key=" + CAMERA_API_KEY;
  } else {
    url += "?api_key=" + CAMERA_API_KEY;
  }
  http.begin(client, url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(6000);
  int code = http.POST(data, len);
  bool ok = (code == 200);
  if (!ok) {
    Serial.printf("\n❌ uploadFrame failed! HTTP Code: %d\n", code);
  }
  http.end();
  return ok;
}

// Helper: Cloudflare Dashboard Livestream frame upload
bool uploadLivestreamFrame(uint8_t* data, size_t len) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SERVER_URL + "/api/v1/esp/livestream?api_key=" + CAMERA_API_KEY;
  http.begin(client, url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(3500);
  int code = http.POST(data, len);
  if (code == 200) {
    String res = http.getString();
    // If Cloudflare tells us the dashboard stopped watching, turn off streaming immediately
    if (res.indexOf("\"accepted\":false") >= 0 || res.indexOf("livestream_off") >= 0) {
      g_livestream = false;
      Serial.println("\n⏹️ [XIAO] Cloudflare Livestream ended by dashboard.");
    }
  } else if (code > 0) {
    Serial.printf("\n⚠️ Livestream frame HTTP %d\n", code);
  }
  http.end();
  return (code == 200);
}

// Capture photo with illumination, upload to Cloudflare / Supabase Storage, and verify with Face++
void triggerCaptureAndVerify() {
  Serial.println("\n📸 [XIAO] Starting Photo Capture for Face Verification...");
  digitalWrite(FLASH_LED_PIN, LOW); // Flash ON
  delay(150); // Stabilize exposure

  // Drop stale frame so we get fresh illuminated picture
  camera_fb_t *stale = esp_camera_fb_get();
  if (stale) esp_camera_fb_return(stale);

  camera_fb_t *fb = esp_camera_fb_get();
  digitalWrite(FLASH_LED_PIN, HIGH); // Flash OFF

  if (!fb) {
    Serial.println("❌ Camera frame capture FAILED!");
    Serial1.println("FACE_ERROR_CAM");
    return;
  }

  Serial.printf("✅ Photo Captured! Size: %u bytes\n", (unsigned int)fb->len);
  Serial1.println("photo taken"); // Signal WROOM controller immediately

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("❌ WiFi not connected! Cannot upload to Cloudflare / Supabase.");
    Serial1.println("FACE_ERROR_NET");
    esp_camera_fb_return(fb);
    return;
  }

  String verifyUrl = SERVER_URL + "/api/v1/face/verify?api_key=" + CAMERA_API_KEY;
  Serial.print("🚀 Uploading to Cloudflare / Supabase / Face++: ");
  Serial.println(verifyUrl);

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, verifyUrl);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(12000);

  int code = http.POST(fb->buf, fb->len);
  Serial.printf("📡 HTTP Status Code: %d\n", code);

  if (code > 0) {
    String res = http.getString();
    Serial.println("📦 Server Response: " + res);
    if (code == 200) {
      DynamicJsonDocument doc(1024);
      deserializeJson(doc, res);
      bool granted = false;
      String status = "";
      String name = "Unknown";
      float conf = 0.0;
      if (doc["data"].is<JsonObject>()) {
        granted = doc["data"]["granted"] | false;
        status = doc["data"]["status"] | "";
        name = doc["data"]["name"] | "Unknown";
        conf = doc["data"]["confidence"] | 0.0;
      } else {
        granted = doc["granted"] | false;
        status = doc["status"] | "";
        name = doc["name"] | "Unknown";
        conf = doc["confidence"] | 0.0;
      }

      Serial.printf("🎯 Face Verification Result: %s (User: %s, Conf: %.1f%%, Access Granted: %s)\n", 
                    status.c_str(), name.c_str(), conf, granted ? "YES" : "NO");

      if (granted) Serial1.println("FACE_SUCCESS");
      else if (status == "NO_FACE") Serial1.println("FACE_NO_FACE");
      else if (status == "NOT_AUTHORIZED") Serial1.println("FACE_NOT_AUTHORIZED");
      else Serial1.println("FACE_ERROR_HTTP");
    } else {
      Serial1.println("FACE_ERROR_HTTP");
    }
  } else {
    Serial.printf("❌ HTTP POST failed! Error: %s\n", http.errorToString(code).c_str());
    Serial1.println("FACE_ERROR_NET");
  }
  http.end();
  esp_camera_fb_return(fb);
}

// Upload picture to Gallery
void triggerGalleryUpload() {
  Serial.println("\n📸 [XIAO] Uploading Snapshot to Gallery (/api/v1/upload)...");
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("❌ Camera frame capture failed");
    return;
  }

  bool ok = uploadFrame("/api/v1/upload?camera_id=1", fb->buf, fb->len);
  if (ok) {
    Serial.println("✅ Image uploaded to Cloudflare & Supabase Storage successfully!");
  } else {
    Serial.println("❌ Upload to /api/v1/upload failed");
  }
  esp_camera_fb_return(fb);
}

// Poll Cloudflare backend to check if dashboard turned on livestream or issued commands
void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SERVER_URL + "/api/v1/esp/commands/pending?api_key=" + CAMERA_API_KEY;
  http.begin(client, url);
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(3000);
  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      bool prev_livestream = g_livestream;
      if (doc["data"].is<JsonObject>()) {
        g_livestream = doc["data"]["livestream"] | false;
      } else {
        g_livestream = doc["livestream"] | false;
      }
      if (g_livestream != prev_livestream) {
        Serial.printf("\n📹 Cloudflare Dashboard Livestream: %s\n", 
                      g_livestream ? "STARTING (Streaming to Cloudflare)" : "STOPPED");
      }
    }
  }
  http.end();
}

void setup() {
  Serial.begin(115200); // Debug USB (Serial Monitor at 115200 baud)
  Serial.setTimeout(50);
  
  // Serial1 communicates with ESP32 WROOM via pins 44 (RX) and 43 (TX) at 9600 baud for stable signal integrity
  pinMode(44, INPUT_PULLUP);
  Serial1.begin(9600, SERIAL_8N1, 44, 43); 
  Serial1.setTimeout(50);

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, HIGH); // Start Off (High is Off for active-low onboard LED)

  // Configure Camera with known working settings
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size   = FRAMESIZE_VGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode    = CAMERA_GRAB_LATEST;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count     = 2;

  if (esp_camera_init(&config) != ESP_OK) {
    Serial.println("❌ Camera Init Failed");
    Serial1.println("CAM_INIT_FAIL");
    return;
  }

  sensor_t * s = esp_camera_sensor_get();
  s->set_vflip(s, 1);

  Serial.println("📶 Connecting to WiFi: " + String(ssid) + " ...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  unsigned long start_wifi = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start_wifi < 10000) { 
    delay(500); 
    Serial.print("."); 
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n📶 Connected! IP: %s (RSSI: %d dBm)\n", 
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    Serial.println("\n⚠️ WiFi Connection timeout! Will retry in background.");
  }

  Serial.println("==================================================");
  Serial.println("  V.A.U.L.T XIAO Camera Connected to Cloudflare   ");
  Serial.println("  Type 'SNAP'      -> Test Face Verification     ");
  Serial.println("  Type 'UPLOAD'    -> Test Gallery Upload        ");
  Serial.println("  Type 'STATUS'    -> Check WiFi & Livestream    ");
  Serial.println("  Type 'STREAM_ON' -> Manually start stream      ");
  Serial.println("  Type 'STREAM_OFF'-> Manually stop stream       ");
  Serial.println("==================================================");
}

void loop() {
  unsigned long now = millis();

  // Non-blocking WiFi reconnection
  static unsigned long last_wifi_reconnect_attempt = 0;
  if (WiFi.status() != WL_CONNECTED) {
    if (now - last_wifi_reconnect_attempt >= 10000) {
      last_wifi_reconnect_attempt = now;
      Serial.println("🔄 Reconnecting WiFi...");
      WiFi.disconnect();
      WiFi.begin(ssid, password);
    }
  }
  
  // 1. Poll Cloudflare commands (adjust interval if streaming)
  unsigned long current_poll_interval = g_livestream ? 6000 : poll_interval_ms;
  if (WiFi.status() == WL_CONNECTED) {
    if (now - g_last_poll >= current_poll_interval) {
      g_last_poll = now;
      pollCommands();
    }
  }

  // 2. Cloudflare Dashboard Livestream handling
  if (g_livestream && (now - g_last_frame >= LIVESTREAM_INTERVAL_MS)) {
    g_last_frame = now;
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      bool ok = uploadLivestreamFrame(fb->buf, fb->len);
      if (ok) {
        Serial.print(".");
      }
      esp_camera_fb_return(fb);
    }
  }

  // 3. Heartbeat signal back to ESP32 WROOM controller
  if (now - g_last_heartbeat_send >= 3000) { 
    g_last_heartbeat_send = now;
    if (WiFi.status() == WL_CONNECTED) {
      Serial1.println("XIAO_WIFI_OK"); 
    } else {
      Serial1.println("XIAO_WIFI_DEAD");
    }
  }
  
  // 4. Listen for commands from USB Serial Monitor (for direct PC testing)
  if (Serial.available()) {
    String usbCmd = Serial.readStringUntil('\n');
    usbCmd.trim();
    if (usbCmd.equalsIgnoreCase("SNAP") || usbCmd.equalsIgnoreCase("VERIFY") || usbCmd.equalsIgnoreCase("FACE") || usbCmd.equalsIgnoreCase("CAPTURE")) {
      Serial.println("🧪 [USB Command] Triggering Face Verification Capture...");
      triggerCaptureAndVerify();
    } else if (usbCmd.equalsIgnoreCase("UPLOAD") || usbCmd.equalsIgnoreCase("GALLERY")) {
      Serial.println("🧪 [USB Command] Triggering Gallery Upload...");
      triggerGalleryUpload();
    } else if (usbCmd.equalsIgnoreCase("STATUS") || usbCmd.equalsIgnoreCase("WIFI")) {
      Serial.printf("📶 WiFi: %s | IP: %s | RSSI: %d dBm | Livestream: %s\n", 
                    WiFi.status() == WL_CONNECTED ? "CONNECTED" : "DISCONNECTED",
                    WiFi.localIP().toString().c_str(), WiFi.RSSI(),
                    g_livestream ? "ACTIVE" : "OFF");
    } else if (usbCmd.equalsIgnoreCase("STREAM_ON")) {
      g_livestream = true;
      Serial.println("📹 Manually started Cloudflare Livestream.");
    } else if (usbCmd.equalsIgnoreCase("STREAM_OFF")) {
      g_livestream = false;
      Serial.println("⏹️ Manually stopped Cloudflare Livestream.");
    } else if (usbCmd.equalsIgnoreCase("FLASH_ON")) {
      digitalWrite(FLASH_LED_PIN, LOW);
      Serial.println("💡 Flash ON");
    } else if (usbCmd.equalsIgnoreCase("FLASH_OFF")) {
      digitalWrite(FLASH_LED_PIN, HIGH);
      Serial.println("💡 Flash OFF");
    }
  }

  // 5. Listen for commands from ESP32 WROOM controller via UART (Serial1)
  if (Serial1.available()) {
    String cmd = Serial1.readStringUntil('\n');
    cmd.trim();
    
    if (cmd.length() > 0) {
      Serial.print("📩 [UART from WROOM]: ");
      Serial.println(cmd);
    }
    
    if (cmd == "FLASH_ON") {
      digitalWrite(FLASH_LED_PIN, LOW); // Flash ON
    }
    else if (cmd == "FLASH_OFF") {
      digitalWrite(FLASH_LED_PIN, HIGH); // Flash OFF
    }
    else if (cmd == "FACE_VERIFY") {
      triggerCaptureAndVerify();
    }
  }
}
