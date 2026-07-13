# V.A.U.L.T Hardware Pinout Guide

This document outlines the wiring configuration and pinouts for both microcontrollers in the V.A.U.L.T gate access control system: the **ESP32 WROOM (Main Controller)** and the **Seeed Studio XIAO ESP32S3 (Camera Module)**.

---

## 1. Inter-ESP Communication (UART Crossover)

The Main Controller and the Camera Module communicate via a direct hardware UART connection.

| ESP32 WROOM (Main) Pin | Direction | XIAO ESP32S3 (Camera) Pin | Signal Description |
| :--- | :---: | :--- | :--- |
| **GPIO 16 (RX2)** | $\leftarrow$ | **GPIO 43 (TX1)** | Camera UART Transmit to Main RX |
| **GPIO 17 (TX2)** | $\rightarrow$ | **GPIO 44 (RX1)** | Main UART Transmit to Camera RX |
| **GND** | $\longleftrightarrow$ | **GND** | Common Ground (Critical for serial stability) |

---

## 2. ESP32 WROOM (Main Controller) Pinout

The Main Controller handles the display, user keypad, solenoid lock, door sensor, exit button, and power relays.

### A. Peripherals & Relays
| Component | GPIO | Config / Direction | Notes |
| :--- | :---: | :---: | :--- |
| **Solenoid Lock Relay** | **GPIO 4** | OUTPUT (Active Low) | Channel 1 Relay: Triggers the 12V lock |
| **Flash Light Relay** | **GPIO 5** | OUTPUT (Active Low) | Channel 2 Relay: Controls the external 12V LED flash strip |
| **Manual Exit Button** | **GPIO 12** | INPUT_PULLUP | Physical button to trigger manual unlock |

### B. ST7735 1.8" TFT Display (SPI)
| TFT Pin | ESP32 Pin | SPI Function | Description |
| :--- | :---: | :---: | :--- |
| **VCC** | **3.3V** | Power | Power supply |
| **GND** | **GND** | Ground | Common Ground |
| **CS** | **GPIO 15** | SPI Chip Select | Display select |
| **RST** | **GPIO 21** | Reset | Hardware reset pin |
| **A0 / DC** | **GPIO 22** | Data / Command | Register selection |
| **SDA / MOSI** | **GPIO 23** | SPI Master Out | Hardware VSPI MOSI |
| **SCL / SCK** | **GPIO 18** | SPI Clock | Hardware VSPI SCK |
| **LED** | **3.3V** | Backlight | Display backlight (always on) |

### C. 4x4 Keypad Matrix
Rows and columns are mapped in a matrix configuration to capture user input.

| Keypad Line | ESP32 Pin | Config / Direction | Matrix Mapping |
| :--- | :---: | :---: | :--- |
| **Row 0** | **GPIO 13** | OUTPUT (Scan) | Keys: `1`, `2`, `3`, `A` |
| **Row 1** | **GPIO 19** | OUTPUT (Scan) | Keys: `4`, `5`, `6`, `B` |
| **Row 2** | **GPIO 14** | OUTPUT (Scan) | Keys: `7`, `8`, `9`, `C` |
| **Row 3** | **GPIO 27** | OUTPUT (Scan) | Keys: `*`, `0`, `#`, `D` |
| **Col 0** | **GPIO 26** | INPUT_PULLUP | Column 1 scan |
| **Col 1** | **GPIO 25** | INPUT_PULLUP | Column 2 scan |
| **Col 2** | **GPIO 33** | INPUT_PULLUP | Column 3 scan |
| **Col 3** | **GPIO 32** | INPUT_PULLUP | Column 4 scan |

---

## 3. Seeed Studio XIAO ESP32S3 Sense Pinout

The XIAO ESP32S3 Sense handles face recognition scanning, image capture, and local status indication.

### A. Onboard Camera & Flash
| Peripheral | GPIO | Config / Direction | Description |
| :--- | :---: | :---: | :--- |
| **Camera Sensor** | *Various* | Dedicated Bus | Pre-wired internal parallel interface (OV2640) |
| **Onboard Flash LED** | **GPIO 21** | OUTPUT (Active Low) | Onboard indicator flash LED (Low = ON, High = OFF) |

### B. Camera Sensor Internal Pin Mapping (Quick Reference)
These pins are internally connected on the Seeed Studio XIAO ESP32S3 expansion/sensing board:

* **XCLK (Clock)**: GPIO 10
* **SCCB Data (SDA)**: GPIO 40
* **SCCB Clock (SCL)**: GPIO 39
* **VSYNC (Vertical Sync)**: GPIO 38
* **HREF (Horizontal Reference)**: GPIO 47
* **PCLK (Pixel Clock)**: GPIO 13
* **Data Pins (D0-D7)**: GPIO 15, 17, 18, 16, 14, 12, 11, 48
* **Power-down (PWDN) / Reset (RST)**: Not connected (`-1`)

---

## 4. Complete System Wiring Cheat Sheet

| Main WROOM Pin | External Component Connection | Description |
| :---: | :--- | :--- |
| **GPIO 4** | Lock Relay Module IN | Active high to unlock the gate |
| **GPIO 5** | Flash Light Relay Module IN | Active high to power 12V LED strip |
| **GPIO 12** | Exit Button Pin 1 (Pin 2 to GND) | Internal pull-up detects pull to GND |
| **GPIO 13** | Keypad Row 0 | Keypad connector pin 1 |
| **GPIO 14** | Keypad Row 2 | Keypad connector pin 3 |
| **GPIO 15** | TFT CS Pin | SPI Chip Select |
| **GPIO 16** | XIAO ESP32S3 TX (GPIO 43) | UART Serial RX from camera |
| **GPIO 17** | XIAO ESP32S3 RX (GPIO 44) | UART Serial TX to camera |
| **GPIO 18** | TFT SCK / SCL Pin | SPI Clock |
| **GPIO 19** | Keypad Row 1 | Keypad connector pin 2 |
| **GPIO 21** | TFT RST / RESET Pin | Display Reset |
| **GPIO 22** | TFT DC / A0 Pin | SPI Data/Command |
| **GPIO 23** | TFT SDA / MOSI Pin | SPI Data |
| **GPIO 25** | Keypad Col 1 | Keypad connector pin 6 |
| **GPIO 26** | Keypad Col 0 | Keypad connector pin 5 |
| **GPIO 27** | Keypad Row 3 | Keypad connector pin 4 |
| **GPIO 32** | Keypad Col 3 | Keypad connector pin 8 |
| **GPIO 33** | Keypad Col 2 | Keypad connector pin 7 |
| **3.3V / 5V** | TFT VCC, Relay VCC, Keypad Common, XIAO 5V | System Power Lines |
| **GND** | All Ground pins | Common ground reference |
