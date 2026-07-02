#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
String SERVER_URL = "https://vault-cloudflare-8fu.pages.dev";
String CAMERA_API_KEY = "YOUR_API_KEY";

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

#define FLASH_LED_PIN     21 // Verify if XIAO has this flash pin

bool g_livestream = false;
unsigned long g_last_frame = 0;
unsigned long g_last_poll = 0;
unsigned int poll_interval_ms = 2000;
const unsigned int LIVESTREAM_INTERVAL_MS = 200; // ~5 fps
const unsigned int NORMAL_INTERVAL_MS = 5000;

void setup() {
  Serial.begin(115200);
  // Serial1 for communicating with WROOM ESP32
  // Using pins D6 (43) for TX and D7 (44) for RX on XIAO ESP32-S3
  Serial1.begin(115200, SERIAL_8N1, 44, 43); 

  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, HIGH);

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
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 10;

  if (esp_camera_init(&config) != ESP_OK) { 
    Serial.println("❌ Cam Init Fail"); 
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
  HTTPClient http;
  String url = SERVER_URL + "/api/v1/esp/commands/pending";
  http.begin(url);
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      if (doc["data"]["livestream"].is<bool>()) {
        g_livestream = doc["data"]["livestream"].as<bool>();
      } else {
        g_livestream = doc["livestream"].as<bool>();
      }
    }
  }
  http.end();
}

bool uploadFrame(const char* path, uint8_t* data, size_t len) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial1.println("UPLOAD_ERROR: No WiFi");
    return false;
  }
  HTTPClient http;
  String url = SERVER_URL + path;
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  int code = http.POST(data, len);
  bool ok = (code == 200);
  if (!ok) {
    if (code < 0) {
      Serial1.println("UPLOAD_ERROR: " + http.errorToString(code));
    } else {
      Serial1.println("UPLOAD_FAIL: HTTP " + String(code));
    }
  }
  http.end();
  return ok;
}

void loop() {
  unsigned long now = millis();
  
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

  uint32_t frame_interval = g_livestream ? LIVESTREAM_INTERVAL_MS : NORMAL_INTERVAL_MS;
  if (now - g_last_frame >= frame_interval) {
    g_last_frame = now;
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      if (g_livestream) {
        uploadFrame("/api/v1/esp/livestream", fb->buf, fb->len);
      }
      esp_camera_fb_return(fb);
    }
  }
  
  // Handle commands from WROOM via Serial1
  if (Serial1.available()) {
    String cmd = Serial1.readStringUntil('\n');
    cmd.trim();
    if (cmd == "FACE_VERIFY") {
      digitalWrite(FLASH_LED_PIN, LOW); // Flash on
      delay(150);
      camera_fb_t *fb = esp_camera_fb_get();
      digitalWrite(FLASH_LED_PIN, HIGH); // Flash off
      
      if (fb) {
        // Dual-upload: Save frame to R2 Image Gallery first
        uploadFrame("/api/v1/upload?camera_id=1", fb->buf, fb->len);

        if (WiFi.status() == WL_CONNECTED) {
          HTTPClient http;
          http.begin(SERVER_URL + "/api/v1/face/verify");
          http.addHeader("Content-Type", "image/jpeg");
          http.addHeader("X-API-Key", CAMERA_API_KEY);
          int code = http.POST(fb->buf, fb->len);
          if (code > 0) {
            if (code == 200) {
              String res = http.getString();
              DynamicJsonDocument doc(1024);
              deserializeJson(doc, res);
              bool granted = false;
              if (doc["data"].is<JsonObject>()) {
                granted = doc["data"]["granted"].as<bool>();
              } else {
                granted = doc["granted"].as<bool>();
              }
              if (granted) {
                Serial1.println("FACE_SUCCESS");
              } else {
                Serial1.println("FACE_FAIL");
              }
            } else {
              Serial1.println("FACE_ERROR: HTTP " + String(code));
            }
          } else {
            Serial1.println("FACE_NET_ERROR: " + http.errorToString(code));
          }
          http.end();
        } else {
          Serial1.println("FACE_NET_ERROR: No WiFi");
        }
        esp_camera_fb_return(fb);
      } else {
        Serial1.println("FACE_ERROR: Camera capture failed");
      }
    } 
  }
}
