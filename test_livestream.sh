#!/usr/bin/env bash
# =============================================================================
# test_livestream.sh — V.A.U.L.T Livestream & Data Retention Integration Tests
# =============================================================================
# Tests the full livestream cycle + retention/poll settings via PATCH /settings
#
# Prerequisites: wrangler pages dev must be running on port 8788
# Usage:  bash test_livestream.sh
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
BASE="http://localhost:8788/api/v1"
CAMERA_API_KEY="test_key_123"
ADMIN_EMAIL="admin@vault.local"
ADMIN_PASSWORD="admin1234"

# Colours
GRN="\033[0;32m"; RED="\033[0;31m"; YLW="\033[0;33m"; BLU="\033[0;34m"; RST="\033[0m"

PASS=0; FAIL=0

# ── Helpers ──────────────────────────────────────────────────────────────────
pass() { echo -e "${GRN}  ✓ $1${RST}"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  ✗ $1${RST}"; FAIL=$((FAIL+1)); }
info() { echo -e "${BLU}▶ $1${RST}"; }
warn() { echo -e "${YLW}  ⚠ $1${RST}"; }
sep()  { echo -e "${BLU}────────────────────────────────────────────────────${RST}"; }

# Perform a curl call and output the body.
# Usage: api GET /path [extra curl args...]
api() {
  local method=$1 path=$2; shift 2
  curl -s -X "$method" "${BASE}${path}" \
    -H "Content-Type: application/json" \
    -b /tmp/vault_test_cookies \
    -c /tmp/vault_test_cookies \
    "$@"
}

esp() {
  local method=$1 path=$2; shift 2
  curl -s -X "$method" "${BASE}${path}" \
    -H "X-API-Key: ${CAMERA_API_KEY}" \
    "$@"
}

jq_val() { echo "$1" | jq -r "$2" 2>/dev/null; }
assert_eq() {
  local label=$1 got=$2 want=$3
  if [ "$got" = "$want" ]; then pass "$label (got: $got)";
  else fail "$label (expected: $want, got: $got)"; fi
}

# ── Generate a minimal 1×1 white JPEG ────────────────────────────────────────
JPEG_FILE="/tmp/vault_test_frame.jpg"
python3 - <<'PYEOF'
import struct, zlib, base64, sys

# Minimal valid JPEG (1×1 white pixel)
jpeg = bytes([
  0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,
  0x00,0x01,0x00,0x00,0xFF,0xDB,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,
  0x07,0x07,0x07,0x09,0x09,0x08,0x0A,0x0C,0x14,0x0D,0x0C,0x0B,0x0B,0x0C,0x19,0x12,
  0x13,0x0F,0x14,0x1D,0x1A,0x1F,0x1E,0x1D,0x1A,0x1C,0x1C,0x20,0x24,0x2E,0x27,0x20,
  0x22,0x2C,0x23,0x1C,0x1C,0x28,0x37,0x29,0x2C,0x30,0x31,0x34,0x34,0x34,0x1F,0x27,
  0x39,0x3D,0x38,0x32,0x3C,0x2E,0x33,0x34,0x32,0xFF,0xC0,0x00,0x0B,0x08,0x00,0x01,
  0x00,0x01,0x01,0x01,0x11,0x00,0xFF,0xC4,0x00,0x1F,0x00,0x00,0x01,0x05,0x01,0x01,
  0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,
  0x05,0x06,0x07,0x08,0x09,0x0A,0x0B,0xFF,0xC4,0x00,0xB5,0x10,0x00,0x02,0x01,0x03,
  0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7D,0x01,0x02,0x03,0x00,
  0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,
  0x81,0x91,0xA1,0x08,0x23,0x42,0xB1,0xC1,0x15,0x52,0xD1,0xF0,0x24,0x33,0x62,0x72,
  0x82,0x09,0x0A,0x16,0x17,0x18,0x19,0x1A,0x25,0x26,0x27,0x28,0x29,0x2A,0x34,0x35,
  0x36,0x37,0x38,0x39,0x3A,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x53,0x54,0x55,
  0x56,0x57,0x58,0x59,0x5A,0x63,0x64,0x65,0x66,0x67,0x68,0x69,0x6A,0x73,0x74,0x75,
  0x76,0x77,0x78,0x79,0x7A,0x83,0x84,0x85,0x86,0x87,0x88,0x89,0x8A,0x92,0x93,0x94,
  0x95,0x96,0x97,0x98,0x99,0x9A,0xA2,0xA3,0xA4,0xA5,0xA6,0xA7,0xA8,0xA9,0xAA,0xB2,
  0xB3,0xB4,0xB5,0xB6,0xB7,0xB8,0xB9,0xBA,0xC2,0xC3,0xC4,0xC5,0xC6,0xC7,0xC8,0xC9,
  0xCA,0xD2,0xD3,0xD4,0xD5,0xD6,0xD7,0xD8,0xD9,0xDA,0xE1,0xE2,0xE3,0xE4,0xE5,0xE6,
  0xE7,0xE8,0xE9,0xEA,0xF1,0xF2,0xF3,0xF4,0xF5,0xF6,0xF7,0xF8,0xF9,0xFA,0xFF,0xDA,
  0x00,0x08,0x01,0x01,0x00,0x00,0x3F,0x00,0xFB,0x25,0xFF,0xD9
])
with open('/tmp/vault_test_frame.jpg', 'wb') as f:
    f.write(jpeg)
print('JPEG written')
PYEOF

echo ""
info "V.A.U.L.T Livestream & Retention Test Suite"
sep

# =============================================================================
# 1. Auth — sign in and grab session cookie
# =============================================================================
info "1. Auth — signing in as $ADMIN_EMAIL"
SIGNIN=$(api POST /auth/signin -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}")
SIGNIN_OK=$(jq_val "$SIGNIN" '.success')
assert_eq "Sign-in succeeds" "$SIGNIN_OK" "true"
ROLE=$(jq_val "$SIGNIN" '.data.user.role')
assert_eq "Admin role returned" "$ROLE" "ADMIN"
sep

# =============================================================================
# 2. Settings — read current values
# =============================================================================
info "2. Settings — reading current config"
SETTINGS=$(api GET /settings)
SETTINGS_OK=$(jq_val "$SETTINGS" '.success')
assert_eq "GET /settings succeeds" "$SETTINGS_OK" "true"

RETENTION=$(jq_val "$SETTINGS" '.data.imageRetentionDays')
POLL=$(jq_val "$SETTINGS" '.data.pollIntervalMs')
LIVESTREAM_STATE=$(jq_val "$SETTINGS" '.data.livestreamActive')
info "  imageRetentionDays=$RETENTION  pollIntervalMs=$POLL  livestreamActive=$LIVESTREAM_STATE"
sep

# =============================================================================
# 3. Settings — update retention + poll interval
# =============================================================================
info "3. Settings — updating imageRetentionDays=14 and pollIntervalMs=1500"
PATCH1=$(api PATCH /settings -d '{"imageRetentionDays":14,"pollIntervalMs":1500}')
PATCH1_OK=$(jq_val "$PATCH1" '.success')
assert_eq "PATCH /settings succeeds" "$PATCH1_OK" "true"
NEW_RET=$(jq_val "$PATCH1" '.data.imageRetentionDays')
NEW_POLL=$(jq_val "$PATCH1" '.data.pollIntervalMs')
assert_eq "imageRetentionDays saved as 14" "$NEW_RET" "14"
assert_eq "pollIntervalMs saved as 1500" "$NEW_POLL" "1500"

# Restore to defaults
info "  Restoring defaults (30 days / 2000 ms)"
api PATCH /settings -d '{"imageRetentionDays":30,"pollIntervalMs":2000}' > /dev/null
pass "Defaults restored"
sep

# =============================================================================
# 4. Livestream — initially off
# =============================================================================
info "4. Livestream — verify flag starts off"
SETTINGS2=$(api GET /settings)
LS_INIT=$(jq_val "$SETTINGS2" '.data.livestreamActive')
assert_eq "livestreamActive starts false" "$LS_INIT" "false"
sep

# =============================================================================
# 5. Livestream — turn ON
# =============================================================================
info "5. Livestream — enable via POST /livestream"
LS_ON=$(api POST /livestream -d '{"active":true}')
LS_ON_OK=$(jq_val "$LS_ON" '.success')
LS_ON_VAL=$(jq_val "$LS_ON" '.data.livestreamActive')
assert_eq "POST /livestream {active:true} succeeds" "$LS_ON_OK" "true"
assert_eq "livestreamActive is now true" "$LS_ON_VAL" "true"
sep

# =============================================================================
# 6. ESP32 — poll pending commands — should see livestream:true
# =============================================================================
info "6. ESP32 — poll /esp/commands/pending (expect livestream:true)"
POLL_RESP=$(esp GET /esp/commands/pending)
POLL_OK=$(jq_val "$POLL_RESP" '.success')
POLL_LS=$(jq_val "$POLL_RESP" '.data.livestream')
POLL_CMD=$(jq_val "$POLL_RESP" '.data.command')
assert_eq "GET /esp/commands/pending succeeds" "$POLL_OK" "true"
assert_eq "livestream flag is true in poll response" "$POLL_LS" "true"
info "  command in response: $POLL_CMD"
sep

# =============================================================================
# 7. ESP32 — upload a livestream frame
# =============================================================================
info "7. ESP32 — uploading livestream frame to /esp/livestream"
FRAME_RESP=$(esp POST /esp/livestream \
  -H "Content-Type: image/jpeg" \
  --data-binary "@${JPEG_FILE}")
FRAME_OK=$(jq_val "$FRAME_RESP" '.success')
FRAME_ACCEPTED=$(jq_val "$FRAME_RESP" '.data.accepted')
FRAME_KEY=$(jq_val "$FRAME_RESP" '.data.objectKey')
assert_eq "POST /esp/livestream succeeds" "$FRAME_OK" "true"
assert_eq "Frame accepted=true" "$FRAME_ACCEPTED" "true"
assert_eq "objectKey is livestream/frame-latest.jpg" "$FRAME_KEY" "livestream/frame-latest.jpg"
sep

# =============================================================================
# 8. Dashboard — serve the latest frame
# =============================================================================
info "8. Dashboard — fetching latest frame via GET /livestream/frame"
HTTP_CODE=$(curl -s -o /tmp/vault_frame_out -w "%{http_code}" "${BASE}/livestream/frame")
CTYPE=$(curl -sI "${BASE}/livestream/frame" | grep -i content-type | tr -d '\r' | awk '{print $2}')
assert_eq "GET /livestream/frame returns 200" "$HTTP_CODE" "200"
assert_eq "Content-Type is image/jpeg" "$CTYPE" "image/jpeg"
FRAME_SIZE=$(wc -c < /tmp/vault_frame_out)
if [ "$FRAME_SIZE" -gt 10 ]; then pass "Frame has content ($FRAME_SIZE bytes)";
else fail "Frame appears empty ($FRAME_SIZE bytes)"; fi
sep

# =============================================================================
# 9. Livestream — turn OFF
# =============================================================================
info "9. Livestream — disable via POST /livestream"
LS_OFF=$(api POST /livestream -d '{"active":false}')
LS_OFF_OK=$(jq_val "$LS_OFF" '.success')
LS_OFF_VAL=$(jq_val "$LS_OFF" '.data.livestreamActive')
assert_eq "POST /livestream {active:false} succeeds" "$LS_OFF_OK" "true"
assert_eq "livestreamActive is now false" "$LS_OFF_VAL" "false"
sep

# =============================================================================
# 10. ESP32 — poll again — should see livestream:false
# =============================================================================
info "10. ESP32 — poll again (expect livestream:false)"
POLL2=$(esp GET /esp/commands/pending)
POLL2_LS=$(jq_val "$POLL2" '.data.livestream')
assert_eq "livestream flag is false after stop" "$POLL2_LS" "false"
sep

# =============================================================================
# 11. ESP32 — frame upload rejected when livestream off
# =============================================================================
info "11. ESP32 — frame upload should be rejected when livestream is off"
REJ=$(esp POST /esp/livestream \
  -H "Content-Type: image/jpeg" \
  --data-binary "@${JPEG_FILE}")
REJ_OK=$(jq_val "$REJ" '.success')
REJ_ACCEPTED=$(jq_val "$REJ" '.data.accepted')
REJ_REASON=$(jq_val "$REJ" '.data.reason')
assert_eq "Request still returns success:true envelope" "$REJ_OK" "true"
assert_eq "accepted=false when livestream off" "$REJ_ACCEPTED" "false"
assert_eq "reason=livestream_off" "$REJ_REASON" "livestream_off"
sep

# =============================================================================
# 12. Auth — sign out
# =============================================================================
info "12. Auth — signing out"
SIGNOUT=$(api POST /auth/signout)
SIGNOUT_OK=$(jq_val "$SIGNOUT" '.success')
assert_eq "Sign-out succeeds" "$SIGNOUT_OK" "true"

# Confirm session is revoked
ME=$(api GET /auth/me)
ME_OK=$(jq_val "$ME" '.success')
assert_eq "GET /auth/me returns false after signout" "$ME_OK" "false"
sep

# =============================================================================
# Summary
# =============================================================================
TOTAL=$(( PASS + FAIL ))
echo ""
echo -e "${BLU}══════════════════════════════════════${RST}"
echo -e "  Results: ${GRN}${PASS} passed${RST} / ${RED}${FAIL} failed${RST} / ${TOTAL} total"
echo -e "${BLU}══════════════════════════════════════${RST}"

# Clean up temp files
rm -f /tmp/vault_test_cookies /tmp/vault_test_frame.jpg /tmp/vault_frame_out

[ "$FAIL" -eq 0 ]
