#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "mbedtls/md.h"
#include <vector>
#include <Keypad.h>
#include <Adafruit_GFX.h>    // Core graphics library
#include <Adafruit_ST7735.h> // Hardware-specific library for ST7735
#include <SPI.h>

// WiFi & API Configs
const char* ssid = "jvn";
const char* password = "olalalala";
String SERVER_URL = "https://vault-cloudflare-8fu.pages.dev";
String CAMERA_API_KEY = "cameraapisecretkeyafagalglhlia";

Preferences nvs;

// Configs (overridden by fetchConfig from server)
unsigned int poll_interval_ms = 2000;
unsigned int auto_lock_secs = 20;       
unsigned long unlock_duration_ms = 10000; 
String master_pin_sha256 = "";
bool motion_detection = false;
unsigned int upload_interval_ms = 5000;

// Temp pins structure
struct TempPin {
  int id;
  String sha256;
};
std::vector<TempPin> temp_pins;

// Hardware Pin Definitions
const int LOCK_RELAY_PIN = 4;   // Channel 1: Solenoid Lock
const int FLASH_RELAY_PIN = 5;  // Channel 2: 12V LED Strip for camera flash
const int REED_PIN = 22;        // Door Reed Sensor (detects open/closed)

// FIXED: Swapped Button to 12 to free up 19 for the Keypad matrix
const int BUTTON_PIN = 12;      

#define BUTTON_ENABLED 0

// TFT LCD Pins (ST7735 1.8" TFT)
#define TFT_CS     15
#define TFT_RST    21
#define TFT_DC     22

// MOSI = GPIO 23, SCK = GPIO 18 (VSPI default hardware pins)
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_RST);

// Keypad Configuration
const byte KEYPAD_ROWS = 4;
const byte KEYPAD_COLS = 4;
char keys[KEYPAD_ROWS][KEYPAD_COLS] = {
  {'1','2','3','A'},
  {'4','5','6','B'},
  {'7','8','9','C'},
  {'*','0','#','D'}
};

// FIXED: Row 2 is now GPIO 19. GPIO 12 has been completely removed from the keypad.
byte rowPins[KEYPAD_ROWS] = {13, 19, 14, 27}; 
byte colPins[KEYPAD_COLS] = {26, 25, 33, 32};
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, KEYPAD_ROWS, KEYPAD_COLS);

// Global operational variables
bool is_locked = true;
bool auto_relock_active = false;
unsigned long auto_relock_at_ms = 0;
String entered_pin = "";
bool last_reed_state = false;
unsigned long flash_start_time = 0;
bool flash_active = false;
const unsigned long FLASH_TIMEOUT_MS = 10000;

bool initial_fetch_done = false;
unsigned long last_wifi_check = 0;
bool was_connected = false;

// Display States
enum DisplayState {
  STATE_STANDBY,
  STATE_COUNTDOWN,  // Countdown before scan
  STATE_SCANNING,   // Xiao capturing photo
  STATE_VERIFYING,  // Xiao verifying face
  STATE_GRANTED,
  STATE_DENIED,
  STATE_ENROLLING
};
DisplayState current_display_state = STATE_STANDBY;
unsigned long display_state_change_ms = 0;

// Countdown logic
unsigned long countdown_start_ms = 0;

// FreeRTOS Task and Mutex for non-blocking HTTP requests
TaskHandle_t networkTaskHandle;
SemaphoreHandle_t tempPinsMutex;
SemaphoreHandle_t logMutex;

// Volatile network action flags
volatile bool net_pending_unlock = false;
volatile bool net_pending_lock = false;
volatile bool net_pending_toggle = false;

// Log queue
String pin_to_log = "";

// Forward Declarations
void lockDoor();
void unlockDoor();
void unlockWithTimer();  
void toggleDoor();       
void queuePinLog(String pin);
void networkTask(void * parameter);
void backgroundPollCommands();
void backgroundAckCommand(int id, bool success);
void backgroundFetchTempPins();
void backgroundFetchConfig();
void backgroundLogPinAuth(String pin);
bool authenticatePin(String pin);
void updateDisplay(bool forceRedraw = false);
void setDisplayState(DisplayState newState);
void drawHeader();
String sha256(const String &input);
void handleKeypadInput(char key);
void triggerFaceScan();

void setup() {
  Serial.begin(115200); 
  Serial.setTimeout(50); 
  
  while (!Serial) {
    delay(10); 
  }
  
  Serial.println("--- Gate Controller Booting ---");
  
  // Serial2 for communicating with XIAO ESP32
  Serial2.begin(115200, SERIAL_8N1, 16, 17); 
  Serial2.setTimeout(50); 

  // Initialize Peripheral Pins
  pinMode(LOCK_RELAY_PIN, OUTPUT);
  pinMode(FLASH_RELAY_PIN, OUTPUT);
  pinMode(REED_PIN, INPUT_PULLUP);
  pinMode(BUTTON_PIN, INPUT_PULLUP); 

  // Default output states
  digitalWrite(LOCK_RELAY_PIN, LOW);   
  digitalWrite(FLASH_RELAY_PIN, LOW);  
  is_locked = true;

  // --- MANUAL TFT HARD RESET ---
  pinMode(TFT_RST, OUTPUT);
  digitalWrite(TFT_RST, HIGH);
  delay(10);
  digitalWrite(TFT_RST, LOW);  // Force display into reset
  delay(50);                   // Wait for display to clear
  digitalWrite(TFT_RST, HIGH); // Wake up display
  delay(150);                  // Wait for ST7735 controller to boot internally
  // -----------------------------

  // Initialize TFT LCD
  tft.initR(INITR_BLACKTAB);  
  tft.setRotation(1);         
  tft.setTextWrap(false);     
  tft.fillScreen(ST77XX_BLACK);

  // Set initial display state
  last_reed_state = (digitalRead(REED_PIN) == HIGH);
  setDisplayState(STATE_STANDBY);

  // Load from NVS (Using keys <= 15 chars for compatibility)
  nvs.begin("vault", false);
  master_pin_sha256  = nvs.getString("mst_pin_sha", "");
  poll_interval_ms   = nvs.getUInt("poll_int",     2000);
  unlock_duration_ms = nvs.getULong("unlock_dur_ms",     10000);
  nvs.end();

  // Create Mutexes
  tempPinsMutex = xSemaphoreCreateMutex();
  logMutex = xSemaphoreCreateMutex();

  // Start WiFi
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  WiFi.setAutoReconnect(true);
  Serial.println("\n📶 Connecting to WiFi in background...");

  // Start Background Network Task on Core 0
  xTaskCreatePinnedToCore(
    networkTask,
    "NetworkTask",
    8192,
    NULL,
    1,
    &networkTaskHandle,
    0
  );

  Serial.println("\n==========================================");
  Serial.println("        🔒 GATE ACCESS WROOM SYSTEM        ");
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
    char hex[3];
    sprintf(hex, "%02x", hash[i]);
    result += hex;
  }
  return result;
}

void setDisplayState(DisplayState newState) {
  current_display_state = newState;
  display_state_change_ms = millis();
  
  Serial.print("📺 Display State -> ");
  switch (current_display_state) {
    case STATE_STANDBY:   Serial.println("STANDBY (LOCKED)"); break;
    case STATE_COUNTDOWN: Serial.println("COUNTDOWN"); break;
    case STATE_SCANNING:  Serial.println("SCANNING (FACE ID)"); break;
    case STATE_VERIFYING: Serial.println("VERIFYING (FACE ID)"); break;
    case STATE_GRANTED:   Serial.println("ACCESS GRANTED"); break;
    case STATE_DENIED:    Serial.println("ACCESS DENIED"); break;
    case STATE_ENROLLING: Serial.println("FACE ENROLLING"); break;
  }
  updateDisplay(true); 
}

void drawHeader() {
  bool online = (WiFi.status() == WL_CONNECTED);
  tft.fillRect(0, 0, 160, 24, ST77XX_BLUE);
  tft.setTextSize(1);

  tft.setTextColor(ST77XX_WHITE, ST77XX_BLUE);
  tft.setCursor(5, 8);
  tft.print("VAULT GATE");

  tft.fillCircle(120, 12, 4, online ? ST77XX_GREEN : 0xFBE0);

  if (online) {
    tft.setTextColor(ST77XX_GREEN, ST77XX_BLUE);
    tft.setCursor(127, 8);
    tft.print("ONLINE");
  } else {
    tft.setTextColor(0xFBE0, ST77XX_BLUE); 
    tft.setCursor(127, 8);
    tft.print("OFFLN");
  }
}

void updateDisplay(bool forceRedraw) {
  static DisplayState last_drawn_state = (DisplayState)-1;
  static int last_pin_length = -1;
  static bool last_wifi_online = false;

  bool wifi_online = (WiFi.status() == WL_CONNECTED);
  bool state_changed = (current_display_state != last_drawn_state);
  bool wifi_changed  = (wifi_online != last_wifi_online);

  if (wifi_changed || forceRedraw) {
    drawHeader();
    last_wifi_online = wifi_online;
  }

  if (state_changed || forceRedraw) {
    tft.fillRect(0, 24, 160, 104, ST77XX_BLACK);
    tft.setTextSize(1);
    
    switch (current_display_state) {
      case STATE_STANDBY:
        tft.setCursor(10, 35);
        tft.setTextColor(ST77XX_RED, ST77XX_BLACK);
        tft.setTextSize(2);
        tft.print("LOCKED");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(10, 60);
        tft.print("Enter PIN:");
        tft.setTextColor(ST77XX_CYAN, ST77XX_BLACK);
        tft.setCursor(10, 105);
        tft.print("Press [A] for Face ID");
        break;

      case STATE_COUNTDOWN:
        tft.setTextColor(ST77XX_CYAN, ST77XX_BLACK);
        tft.setCursor(15, 35);
        tft.setTextSize(2);
        tft.print("GET READY");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(15, 60);
        tft.print("Face ID in progress");
        break;

      case STATE_SCANNING:
        tft.setTextColor(ST77XX_CYAN, ST77XX_BLACK);
        tft.setCursor(20, 40);
        tft.setTextSize(2);
        tft.print("SCANNING");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(25, 70);
        tft.print("Look at Camera...");
        tft.setCursor(15, 90);
        tft.setTextColor(ST77XX_YELLOW, ST77XX_BLACK);
        tft.print("Capturing Photo...");
        break;

      case STATE_VERIFYING:
        tft.setTextColor(ST77XX_MAGENTA, ST77XX_BLACK);
        tft.setCursor(15, 40);
        tft.setTextSize(2);
        tft.print("VERIFYING");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(15, 70);
        tft.print("Pic Captured!");
        tft.setCursor(15, 90);
        tft.setTextColor(ST77XX_CYAN, ST77XX_BLACK);
        tft.print("Verifying Face...");
        break;

      case STATE_GRANTED:
        tft.setTextColor(ST77XX_GREEN, ST77XX_BLACK);
        tft.setCursor(15, 40);
        tft.setTextSize(2);
        tft.print("GRANTED");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(20, 70);
        tft.print("Welcome Inside!");
        tft.setTextColor(ST77XX_GREEN, ST77XX_BLACK);
        tft.setCursor(20, 90);
        tft.print("Solenoid Unlocked");
        break;

      case STATE_DENIED:
        tft.setTextColor(ST77XX_RED, ST77XX_BLACK);
        tft.setCursor(20, 40);
        tft.setTextSize(2);
        tft.print("DENIED");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(25, 70);
        tft.print("Invalid Entry!");
        tft.setTextColor(ST77XX_RED, ST77XX_BLACK);
        tft.setCursor(25, 90);
        tft.print("Access Rejected");
        break;

      case STATE_ENROLLING:
        tft.setTextColor(ST77XX_MAGENTA, ST77XX_BLACK);
        tft.setCursor(15, 40);
        tft.setTextSize(2);
        tft.print("ENROLLING");
        tft.setTextSize(1);
        tft.setTextColor(ST77XX_WHITE, ST77XX_BLACK);
        tft.setCursor(10, 70);
        tft.print("Registering New Face");
        tft.setCursor(10, 90);
        tft.print("Please wait...");
        break;
    }

    last_drawn_state = current_display_state;
    last_pin_length = -1; 
  }

  // 3. Draw dynamic PIN Text (STANDBY only)
  if (current_display_state == STATE_STANDBY) {
    if ((int)entered_pin.length() != last_pin_length) {
      
      tft.setCursor(10, 80);
      tft.setTextColor(ST77XX_YELLOW, ST77XX_BLACK); // The black background securely overwrites old text
      tft.setTextSize(2);
      
      // Copy the entered PIN, then pad it with spaces to overwrite any deleted characters
      String display_text = entered_pin;
      while(display_text.length() < 8) { // 8 is your max PIN length
        display_text += " ";
      }
      
      tft.print(display_text);
      
      last_pin_length = entered_pin.length();
    }
  }

  // 4. Draw dynamic Countdown Number (COUNTDOWN only)
  if (current_display_state == STATE_COUNTDOWN) {
    int current_sec = 3 - (int)((millis() - countdown_start_ms) / 1000);
    if (current_sec < 1) current_sec = 1;
    static int last_drawn_sec = -1;
    if (state_changed || forceRedraw) {
      last_drawn_sec = -1;
    }
    if (current_sec != last_drawn_sec) {
      tft.fillRect(60, 80, 40, 30, ST77XX_BLACK);
      tft.setCursor(70, 80);
      tft.setTextColor(ST77XX_YELLOW, ST77XX_BLACK);
      tft.setTextSize(3);
      tft.print(current_sec);
      last_drawn_sec = current_sec;
    }
  }
}

// Background network task runner
void networkTask(void * parameter) {
  unsigned long last_poll = 0;
  unsigned long last_temp = 0;
  unsigned long last_config = 0;
  
  while (true) {
    if (WiFi.status() == WL_CONNECTED) {
      unsigned long now = millis();
      
      // 1. Poll pending commands
      if (now - last_poll >= poll_interval_ms) {
        last_poll = now;
        backgroundPollCommands();
      }
      
      // 2. Poll temporary pins
      if (now - last_temp >= 30000 || last_temp == 0) {
        last_temp = now;
        backgroundFetchTempPins();
      }
      
      // 3. Poll config
      if (now - last_config >= 60000 || last_config == 0) {
        last_config = now;
        backgroundFetchConfig();
      }
      
      // 4. Log pending PIN authentications
      String local_pin = "";
      if (xSemaphoreTake(logMutex, pdMS_TO_TICKS(10)) == pdTRUE) {
        if (pin_to_log.length() > 0) {
          local_pin = pin_to_log;
          pin_to_log = ""; // Consume
        }
        xSemaphoreGive(logMutex);
      }
      if (local_pin.length() > 0) {
        backgroundLogPinAuth(local_pin);
      }
    }
    
    vTaskDelay(pdMS_TO_TICKS(100)); // Sleep for 100ms to allow other processes
  }
}

void backgroundPollCommands() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL + "/api/v1/esp/commands/pending");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(2000);
  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      JsonObject data = doc["data"];
      if (!data.isNull() && !data["command"].isNull()) {
        JsonObject cmd = data["command"];
        int id       = cmd["id"].as<int>();
        String type  = cmd["type"].as<String>();
        if (type == "UNLOCK") {
          net_pending_unlock = true;
        } else if (type == "LOCK") {
          net_pending_lock = true;
        } else if (type == "PULSE" || type == "TOGGLE") {
          net_pending_toggle = true;
        }
        backgroundAckCommand(id, true);
      }
    }
  }
  http.end();
}

void backgroundAckCommand(int id, bool success) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL + "/api/v1/esp/commands/" + String(id) + "/ack");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(2000);
  String payload = success ? "{\"success\":true}" : "{\"success\":false}";
  http.POST(payload);
  http.end();
}

void backgroundFetchTempPins() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL + "/api/v1/esp/temp-pins");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(2000);
  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      JsonArray arr = doc["data"].as<JsonArray>();
      if (!arr.isNull()) {
        if (xSemaphoreTake(tempPinsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
          temp_pins.clear();
          for (JsonObject obj : arr) {
            TempPin tp;
            tp.id     = obj["id"].as<int>();
            tp.sha256 = obj["sha256"].as<String>();
            temp_pins.push_back(tp);
          }
          xSemaphoreGive(tempPinsMutex);
          Serial.printf("[backgroundFetchTempPins] Loaded %d temp PINs.\n", temp_pins.size());
        }
      }
    }
  }
  http.end();
}

void backgroundFetchConfig() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL + "/api/v1/esp/config");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(2000);
  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(1536);
    DeserializationError error = deserializeJson(doc, payload);
    if (!error) {
      JsonObject data = doc["data"];
      if (!data.isNull()) {
        String  fetched_pin   = data["master_pin_sha256"].as<String>();
        unsigned int fetched_poll = data["poll_interval_ms"] | poll_interval_ms;
        unsigned long fetched_unlock = data["unlock_duration_ms"] | unlock_duration_ms;
        unsigned int als = data["auto_lock_seconds"] | 0;
        if (als > 0) fetched_unlock = (unsigned long)als * 1000;

        Preferences prefs;
        prefs.begin("vault", false);
        if (fetched_pin.length() > 0 && fetched_pin != master_pin_sha256) {
          master_pin_sha256 = fetched_pin;
          prefs.putString("mst_pin_sha", master_pin_sha256);
        }
        if (fetched_poll != poll_interval_ms) {
          poll_interval_ms = fetched_poll;
          prefs.putUInt("poll_int", poll_interval_ms);
        }
        if (fetched_unlock != unlock_duration_ms) {
          unlock_duration_ms = fetched_unlock;
          prefs.putULong("unlock_dur_ms", unlock_duration_ms);
        }
        prefs.end();
      }
    }
  }
  http.end();
}

void backgroundLogPinAuth(String pin) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, SERVER_URL + "/api/v1/esp/auth/pin");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  http.setTimeout(2000);
  String payload = "{\"pin\":\"" + pin + "\"}";
  http.POST(payload);
  http.end();
}

void queuePinLog(String pin) {
  if (xSemaphoreTake(logMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    pin_to_log = pin;
    xSemaphoreGive(logMutex);
  }
}

bool authenticatePin(String pin) {
  String hashed = sha256(pin);
  if (hashed == master_pin_sha256) {
    return true;
  }
  bool matched = false;
  if (xSemaphoreTake(tempPinsMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
    for (auto it = temp_pins.begin(); it != temp_pins.end(); ++it) {
      if (hashed == it->sha256) {
        temp_pins.erase(it); 
        matched = true;
        break;
      }
    }
    xSemaphoreGive(tempPinsMutex);
  }
  return matched;
}

void triggerFaceScan() {
  Serial.println("📸 Starting Face Scan Countdown...");
  
  // Set starting time and transition to COUNTDOWN state
  countdown_start_ms = millis();
  setDisplayState(STATE_COUNTDOWN);
  
  // Turn on WROOM 12V LED flash strip immediately so user is illuminated
  digitalWrite(FLASH_RELAY_PIN, HIGH);
  flash_active = true;
  flash_start_time = millis();
}

void handleKeypadInput(char key) {
  // Print keypress to Serial Monitor for debugging
  Serial.print("🎛️ Keypad Input: ");
  Serial.println(key);

  if (key >= '0' && key <= '9') {
    if (entered_pin.length() < 8) {
      entered_pin += key;
      updateDisplay(false); 
    }
  } 
  else if (key == '#') {
    if (entered_pin.length() > 0) {
      if (authenticatePin(entered_pin)) {
        unlockWithTimer();
        queuePinLog(entered_pin);
      } else {
        setDisplayState(STATE_DENIED);
        queuePinLog(entered_pin);
      }
      entered_pin = "";
    }
  } 
  else if (key == '*') {
    entered_pin = "";
    updateDisplay(false);
  }
  else if (key == 'A') {
    triggerFaceScan();
  }
  else if (key == 'B') {
    setDisplayState(STATE_ENROLLING);
    Serial2.println("FACE_ENROLL Keypad_User");
  }
}

void lockDoor() {
  digitalWrite(LOCK_RELAY_PIN, LOW); 
  is_locked = true;
  Serial.println("🔒 Door Solenoid LOCKED");
  
  // Reset display state to STANDBY when locking door
  setDisplayState(STATE_STANDBY);
}

void unlockDoor() {
  digitalWrite(LOCK_RELAY_PIN, HIGH); 
  is_locked = false;
  Serial.println("🔓 Door Solenoid UNLOCKED");
}

void unlockWithTimer() {
  unlockDoor();
  setDisplayState(STATE_GRANTED);
  auto_relock_active = true;
  auto_relock_at_ms = millis() + unlock_duration_ms;
}

void toggleDoor() {
  if (is_locked) {
    unlockDoor();
    setDisplayState(STATE_GRANTED);
  } else {
    lockDoor();
    setDisplayState(STATE_STANDBY);
  }
}

void loop() {
  unsigned long now = millis();
  
  // 1. Check background network action flags
  if (net_pending_unlock) {
    net_pending_unlock = false;
    unlockWithTimer();
  }
  if (net_pending_lock) {
    net_pending_lock = false;
    lockDoor();
  }
  if (net_pending_toggle) {
    net_pending_toggle = false;
    toggleDoor();
  }

  // 2. Scan Keypad sequentially (Runs every 10ms with zero lag)
  char key = keypad.getKey();
  if (key) {
    handleKeypadInput(key);
  }

  // 3. Handle Face Scan Countdown
  if (current_display_state == STATE_COUNTDOWN) {
    updateDisplay(false); // Call updateDisplay to redraw countdown numbers!
    if (millis() - countdown_start_ms >= 3000) {
      setDisplayState(STATE_SCANNING);
      Serial2.println("FACE_VERIFY");
    }
  }


#if BUTTON_ENABLED
  static unsigned long last_button_press = 0;
  if (digitalRead(BUTTON_PIN) == LOW) {
    if (millis() - last_button_press > 1000) {
      unlockWithTimer();
      last_button_press = millis();
    }
  }
#endif

  // 4. WiFi connection management (non-blocking)
  if (WiFi.status() != WL_CONNECTED) {
    if (was_connected) {
      was_connected = false;
      updateDisplay(false); 
    }
    if (millis() - last_wifi_check >= 10000) {
      WiFi.disconnect();
      WiFi.begin(ssid, password);
      last_wifi_check = millis();
    }
  } else {
    if (!was_connected) {
      was_connected = true;
      updateDisplay(false); 
    }
  }

  // 5. Auto-relock timer check
  if (auto_relock_active && !is_locked && millis() >= auto_relock_at_ms) {
    lockDoor();
    auto_relock_active = false;
  }

  // 6. Turn off Flash relay if timeout exceeded (with safety return to standby)
  if (flash_active && (millis() - flash_start_time >= FLASH_TIMEOUT_MS)) {
    digitalWrite(FLASH_RELAY_PIN, LOW); 
    flash_active = false;
    if (current_display_state == STATE_SCANNING || current_display_state == STATE_COUNTDOWN || current_display_state == STATE_VERIFYING) {
      setDisplayState(STATE_STANDBY);
    }
  }

  // 7. Automatic transition back to standby screen from temporary screen states (Granted/Denied)
  if (current_display_state == STATE_DENIED && (millis() - display_state_change_ms >= 3000)) {
    setDisplayState(STATE_STANDBY);
  }
  if (current_display_state == STATE_ENROLLING && (millis() - display_state_change_ms >= 10000)) {
    setDisplayState(STATE_STANDBY); 
  }
  
  // 8. Serial Monitor command inputs (for testing/mocking)
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input.startsWith("PIN ")) {
      String pin = input.substring(4);
      if (authenticatePin(pin)) {
        unlockWithTimer();
        queuePinLog(pin);
      } else {
        setDisplayState(STATE_DENIED);
        queuePinLog(pin);
      }
    } else if (input == "FACE") {
      triggerFaceScan();
    } else if (input.startsWith("ENROLL ")) {
      String name = input.substring(7);
      setDisplayState(STATE_ENROLLING);
      Serial2.println("FACE_ENROLL " + name);
    }
  }
  
  // 9. UART response processing from XIAO ESP32S3 camera
  if (Serial2.available()) {
    String resp = Serial2.readStringUntil('\n');
    resp.trim();
    
    if (resp.length() > 0) {
      Serial.print("🎥 Received from XIAO: ");
      Serial.println(resp);
    }
    
    // Only process face verification results if we are actually scanning or verifying
    if (current_display_state == STATE_SCANNING || current_display_state == STATE_VERIFYING) {
      if (resp == "photo taken") {
        digitalWrite(FLASH_RELAY_PIN, LOW); 
        flash_active = false;
        setDisplayState(STATE_VERIFYING); // Transition to Verifying State
      } 
      else if (resp == "FACE_SUCCESS") {
        unlockWithTimer();
      } 
      else if (resp == "FACE_FAIL") {
        setDisplayState(STATE_DENIED);
      } 
      else if (resp == "FACE_ERROR" || resp.startsWith("FACE_NET_ERROR") || resp.startsWith("UPLOAD_")) {
        setDisplayState(STATE_DENIED);
      }
    } 
    
    // Only process face enrollment results if we are actually enrolling
    if (current_display_state == STATE_ENROLLING) {
      if (resp == "ENROLL_SUCCESS") {
        setDisplayState(STATE_STANDBY);
      } 
      else if (resp == "ENROLL_FAIL") {
        setDisplayState(STATE_DENIED);
      }
    }
  }

  delay(10); 
}
