#include "esp_camera.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "IEEE";
const char* password = "ieee@123";
String SERVER_URL = "https://vault-cloudflare-8fu.pages.dev";
String CAMERA_API_KEY = "cameraapisecretkeyafagalglhlia";

// Camera Pin Configurations for XIAO ESP32S3 Sense
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

#define FLASH_LED_PIN     21 // LOW is ON, HIGH is OFF

bool g_livestream = false;
unsigned long g_last_frame = 0;
unsigned long g_last_poll = 0;
unsigned int poll_interval_ms = 2000;
const unsigned int LIVESTREAM_INTERVAL_MS = 200; 
const unsigned int NORMAL_INTERVAL_MS = 5000;

unsigned long g_last_heartbeat_send = 0;

void setup() {
  Serial.begin(115200); // Debug USB
  
  // Serial1 communicates with ESP32 WROOM via pins 44 (RX) and 43 (TX)
  Serial1.begin(115200, SERIAL_8N1, 44, 43); 

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, HIGH); // Start Off (High is Off for active-low onboard LED)

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_VGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  // The board/core combination used here fails camera init when two VGA
  // frame buffers are allocated, even though PSRAM is present. Keep the
  // known-good single-buffer configuration; capture retries handle transient
  // frame acquisition failures.
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 10;

  esp_err_t camera_error = esp_camera_init(&config);
  if (camera_error != ESP_OK) {
    Serial.printf("Cam Init Fail: 0x%lx (%s), PSRAM=%s, free=%u\n",
      static_cast<unsigned long>(camera_error), esp_err_to_name(camera_error),
      psramFound() ? "yes" : "no", ESP.getFreeHeap());
    Serial1.println("CAM_INIT_FAIL");
    return; 
  }

  sensor_t * s = esp_camera_sensor_get();
  s->set_vflip(s, 1);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
  }
  Serial.println("\n📶 Connected to WiFi.");
}

void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SERVER_URL + "/api/v1/esp/commands/pending";
  http.begin(client, url);
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(4000);
  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      if (doc["data"].is<JsonObject>()) {
         if (doc["data"]["livestream"].is<bool>()) {
           g_livestream = doc["data"]["livestream"].as<bool>();
         }
      } else if (doc["livestream"].is<bool>()) {
        g_livestream = doc["livestream"].as<bool>();
      }
    }
  }
  http.end();
}

bool uploadFrame(const char* path, uint8_t* data, size_t len) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("UPLOAD_ERROR: No WiFi");
    return false;
  }
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  String url = SERVER_URL + path;
  http.begin(client, url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(10000); // 10 second timeout for image upload
  int code = http.POST(data, len);
  bool ok = (code == 200);
  if (!ok) {
    if (code < 0) {
      Serial.println("UPLOAD_ERROR: " + http.errorToString(code));
    } else {
      Serial.println("UPLOAD_FAIL: HTTP " + String(code));
    }
  }
  http.end();
  return ok;
}

void loop() {
  unsigned long now = millis();
  
  // Recover WiFi connection if disconnected
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.disconnect();
    WiFi.begin(ssid, password);
    unsigned long start_reconnect = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start_reconnect < 5000) {
      delay(500);
    }
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    if (now - g_last_poll >= poll_interval_ms) {
      g_last_poll = now;
      pollCommands();
    }
  }

  // Heartbeat signal back to ESP32 controller
  if (now - g_last_heartbeat_send >= 3000) { 
    g_last_heartbeat_send = now;
    if (WiFi.status() == WL_CONNECTED) {
      Serial1.println("XIAO_WIFI_OK"); 
    } else {
      Serial1.println("XIAO_WIFI_DEAD");
    }
  }

  // Livestream handling
  if (g_livestream && now - g_last_frame >= LIVESTREAM_INTERVAL_MS) {
    g_last_frame = now;
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      uploadFrame("/api/v1/esp/livestream", fb->buf, fb->len);
      esp_camera_fb_return(fb);
    }
  }
  
  // Listen for commands from ESP32 WROOM controller
  if (Serial1.available()) {
    String cmd = Serial1.readStringUntil('\n');
    cmd.trim();
    
    // Manual Flash Light triggering
    if (cmd == "FLASH_ON") {
      digitalWrite(FLASH_LED_PIN, LOW); // Turn on onboard flash
    }
    else if (cmd == "FLASH_OFF") {
      digitalWrite(FLASH_LED_PIN, HIGH); // Turn off onboard flash
    }
    // Face Verification command
    else if (cmd == "FACE_VERIFY") {
      digitalWrite(FLASH_LED_PIN, LOW); // Turn on onboard flash
      delay(150); // Increased delay so sensor auto-exposure and lighting stabilize
      
      camera_fb_t *stale = esp_camera_fb_get();
      if (stale) esp_camera_fb_return(stale);

      camera_fb_t *fb = nullptr;
      for (int attempt = 0; attempt < 3 && !fb; attempt++) {
        fb = esp_camera_fb_get();
        if (!fb) delay(80);
      }

      digitalWrite(FLASH_LED_PIN, HIGH); // Turn off onboard flash

      if (fb) {
        Serial1.println("photo taken"); // Signal WROOM to turn off 12V LED flash relay immediately
        // Directly send to /api/v1/face/verify:
        // The backend automatically stores the image into Supabase Storage and D1 images gallery,
        // and performs Face++ verification in a single efficient HTTP call (no double-upload needed).
        if (WiFi.status() == WL_CONNECTED) {
          WiFiClientSecure client;
          client.setInsecure();
          HTTPClient http;
          http.begin(client, SERVER_URL + "/api/v1/face/verify");
          http.addHeader("Content-Type", "image/jpeg");
          http.addHeader("X-API-Key", CAMERA_API_KEY);
          http.setTimeout(10000); // 10 second timeout
          int code = http.POST(fb->buf, fb->len);
          if (code > 0) {
            if (code == 200) {
              String res = http.getString();
              DynamicJsonDocument doc(1024);
              deserializeJson(doc, res);
              bool granted = false;
              if (doc["data"].is<JsonObject>()) {
                granted = doc["data"]["granted"].as<bool>();
                String status = doc["data"]["status"].as<String>();
                if (granted) Serial1.println("FACE_SUCCESS");
                else if (status == "NO_FACE") Serial1.println("FACE_NO_FACE");
                else if (status == "NOT_AUTHORIZED") Serial1.println("FACE_NOT_AUTHORIZED");
                else Serial1.println("FACE_ERROR_HTTP");
              } else {
                granted = doc["granted"].as<bool>();
                String status = doc["status"].as<String>();
                if (granted) Serial1.println("FACE_SUCCESS");
                else if (status == "NO_FACE") Serial1.println("FACE_NO_FACE");
                else if (status == "NOT_AUTHORIZED") Serial1.println("FACE_NOT_AUTHORIZED");
                else Serial1.println("FACE_ERROR_HTTP");
              }
            } else {
              Serial1.println("FACE_ERROR_HTTP");
            }
          } else {
            Serial1.println("FACE_ERROR_NET");
          }
          http.end();
        } else {
          Serial1.println("FACE_ERROR_NET");
        }
        esp_camera_fb_return(fb);
      } else {
        Serial1.println("FACE_ERROR_CAM");
      }
    }
  }
}
