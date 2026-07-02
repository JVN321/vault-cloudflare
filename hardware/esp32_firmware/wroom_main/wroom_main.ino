#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "mbedtls/md.h"

const char* ssid = "YOUR_SSID";
const char* password = "YOUR_PASSWORD";
String SERVER_URL = "https://vault-cloudflare-8fu.pages.dev";
String CAMERA_API_KEY = "YOUR_API_KEY";

Preferences nvs;

// Configs
unsigned int poll_interval_ms = 2000;
unsigned int auto_lock_secs = 30;
String master_pin_sha256 = "";
bool motion_detection = false;
unsigned int upload_interval_ms = 5000;

// Relay pin (assuming GPIO 4 for the lock relay)
const int RELAY_PIN = 4;
bool is_locked = true;
unsigned long unlock_time = 0;
bool pulse_active = false;

// Timers
unsigned long last_poll_cmds = 0;
unsigned long last_poll_config = 0;

void lockDoor();
void unlockDoor();
void pulseDoor();

void setup() {
  Serial.begin(115200); // Debug and Keypad mock
  
  // Serial2 for communicating with XIAO ESP32
  // Standard WROOM ESP32 hardware Serial2 pins: RX = 16, TX = 17
  Serial2.begin(115200, SERIAL_8N1, 16, 17); 

  pinMode(RELAY_PIN, OUTPUT);
  lockDoor();

  nvs.begin("vault", false);
  master_pin_sha256 = nvs.getString("master_pin_sha256", "");
  poll_interval_ms = nvs.getUInt("poll_interval_ms", 2000);
  auto_lock_secs = nvs.getUInt("auto_lock_secs", 30);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print(".");
  }
  Serial.println("\n📶 Connected to WiFi.");
  
  fetchConfig();
  
  Serial.println("\n==========================================");
  Serial.println("        🔒 GATE ACCESS WROOM SYSTEM        ");
  Serial.println("==========================================");
  Serial.println(" MOCK COMMANDS:");
  Serial.println(" > PIN 1234");
  Serial.println(" > FACE");
  Serial.println("==========================================");
}

String sha256(const String &input) {
  byte hash[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)input.c_str(), input.length());
  mbedtls_md_finish(&ctx, hash);
  mbedtls_md_free(&ctx);
  String result = "";
  for (int i = 0; i < 32; i++) {
    if (hash[i] < 0x10) result += "0";
    result += String(hash[i], HEX);
  }
  return result;
}

void lockDoor() {
  digitalWrite(RELAY_PIN, LOW);
  is_locked = true;
  pulse_active = false;
  Serial.println("🚪 Door LOCKED");
}

void unlockDoor() {
  digitalWrite(RELAY_PIN, HIGH);
  is_locked = false;
  Serial.println("🚪 Door UNLOCKED");
}

void pulseDoor() {
  unlockDoor();
  pulse_active = true;
  unlock_time = millis();
  Serial.println("🚪 Door PULSING (Auto-lock pending)");
}

void fetchConfig() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SERVER_URL + "/api/v1/esp/config");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      if (doc["data"].is<JsonObject>()) {
        master_pin_sha256 = doc["data"]["master_pin_sha256"].as<String>();
        poll_interval_ms = doc["data"]["poll_interval_ms"].as<unsigned int>();
        auto_lock_secs = doc["data"]["auto_lock_seconds"].as<unsigned int>();
      } else {
        master_pin_sha256 = doc["master_pin_sha256"].as<String>();
        poll_interval_ms = doc["poll_interval_ms"].as<unsigned int>();
        auto_lock_secs = doc["auto_lock_seconds"].as<unsigned int>();
      }
      
      nvs.putString("master_pin_sha256", master_pin_sha256);
      nvs.putUInt("poll_interval_ms", poll_interval_ms);
      nvs.putUInt("auto_lock_secs", auto_lock_secs);
    }
  }
  http.end();
}

void ackCommand(int id, bool success) {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SERVER_URL + "/api/v1/esp/commands/" + String(id) + "/ack");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  String payload = success ? "{\"success\":true}" : "{\"success\":false}";
  http.POST(payload);
  http.end();
}

void pollCommands() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(SERVER_URL + "/api/v1/esp/commands/pending");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      JsonObject cmd;
      if (doc["data"]["command"].is<JsonObject>()) {
        cmd = doc["data"]["command"];
      } else if (doc["command"].is<JsonObject>()) {
        cmd = doc["command"];
      }
      
      if (!cmd.isNull()) {
        int id = cmd["id"].as<int>();
        String type = cmd["type"].as<String>();
        
        Serial.println("Received Remote Command: " + type);
        if (type == "UNLOCK") {
          unlockDoor();
        } else if (type == "LOCK") {
          lockDoor();
        } else if (type == "PULSE") {
          pulseDoor();
        }
        ackCommand(id, true);
      }
    }
  }
  http.end();
}

bool authenticatePin(String pin) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL + "/api/v1/esp/auth/pin");
    http.addHeader("Content-Type", "application/json");
    http.addHeader("X-API-Key", CAMERA_API_KEY);
    String payload = "{\"pin\":\"" + pin + "\"}";
    int code = http.POST(payload);
    
    if (code > 0) {
      if (code == 200) {
        String response = http.getString();
        DynamicJsonDocument doc(1024);
        deserializeJson(doc, response);
        http.end();
        if (doc["success"].as<bool>() && doc["data"]["granted"].as<bool>()) {
          return true;
        }
        return false;
      } else if (code == 401) {
        http.end();
        return false;
      } else {
        Serial.println("⚠️ Server error during PIN auth. Code: " + String(code) + ". Falling back to cache.");
      }
    } else {
      Serial.println("⚠️ Network error during PIN auth. Error: " + http.errorToString(code) + ". Falling back to cache.");
    }
    http.end();
  } else {
    Serial.println("⚠️ WiFi Disconnected. Falling back to cached master PIN.");
  }

  // Fallback to cached master PIN
  String hashed = sha256(pin);
  if (master_pin_sha256.length() > 0 && hashed == master_pin_sha256) {
    Serial.println("✅ Fallback auth successful via cached Master PIN.");
    return true;
  }
  return false;
}

void loop() {
  unsigned long now = millis();
  
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("⚠️ WiFi Disconnected. Attempting to reconnect...");
    WiFi.disconnect();
    WiFi.begin(ssid, password);
    unsigned long start_reconnect = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start_reconnect < 5000) {
      delay(500);
      Serial.print(".");
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\n📶 Reconnected to WiFi.");
    } else {
      Serial.println("\n❌ Reconnect failed. Running in offline mode.");
    }
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    if (now - last_poll_cmds >= poll_interval_ms) {
      last_poll_cmds = now;
      pollCommands();
    }
    
    if (now - last_poll_config >= 60000) {
      last_poll_config = now;
      fetchConfig();
    }
  }

  // Auto-lock for pulse
  if (pulse_active && (now - unlock_time >= (auto_lock_secs * 1000))) {
    lockDoor();
  }
  
  // Keypad mock from Serial Monitor
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input.startsWith("PIN ")) {
      String pin = input.substring(4);
      Serial.println("Authenticating PIN...");
      if (authenticatePin(pin)) {
        Serial.println("✅ PIN GRANTED. Door pulsing.");
        pulseDoor();
      } else {
        Serial.println("❌ PIN DENIED.");
      }
    } else if (input == "FACE") {
      Serial.println("📸 Triggering Face Verify via XIAO...");
      Serial2.println("FACE_VERIFY");
    } else if (input.length() > 0) {
      Serial.println("Unknown command. Use: PIN <num>, FACE, ENROLL <Name>");
    }
  }
  
  // Response from XIAO ESP32
  if (Serial2.available()) {
    String resp = Serial2.readStringUntil('\n');
    resp.trim();
    if (resp.startsWith("FACE_SUCCESS")) {
      Serial.println("✅ Face Recognized! Door pulsing.");
      pulseDoor();
    } else if (resp.startsWith("FACE_FAIL")) {
      Serial.println("❌ Face Unknown. Access Denied.");
    } else if (resp.startsWith("FACE_ERROR")) {
      Serial.println("⚠️ Face Verification API Error: " + resp);
    } else if (resp.startsWith("FACE_NET_ERROR")) {
      Serial.println("⚠️ Face Verification Network Error: " + resp);
    } else if (resp.startsWith("UPLOAD_FAIL") || resp.startsWith("UPLOAD_ERROR")) {
      Serial.println("⚠️ Background image upload failed: " + resp);
    } else {
      Serial.println("XIAO Response: " + resp);
    }
  }
}
