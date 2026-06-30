#!/bin/bash
# simulate_livestream.sh
# Simulates an ESP32 sending a continuous stream of JPEG frames to the backend.

API_URL="https://vault-cloudflare-8fu.pages.dev"

# Read API_KEY from .dev.vars
if [ -f ".dev.vars" ]; then
  API_KEY=$(grep "^CAMERA_API_KEY=" .dev.vars | sed 's/^.*=//' | tr -d '"')
else
  API_KEY="test_key_123"
fi

if [ ! -f "test_face.jpg" ]; then
  echo "Error: test_face.jpg not found. Please provide an image to use as the livestream frame."
  exit 1
fi

echo "Starting livestream simulation to $API_URL..."
echo "Press Ctrl+C to stop."
echo "IMPORTANT: Make sure you have clicked 'Start Live View' in your dashboard, otherwise the server will reject these frames to save bandwidth!"
echo ""

FRAME_COUNT=0

while true; do
  RESPONSE=$(curl -s -X POST "${API_URL}/api/v1/esp/livestream?api_key=${API_KEY}" \
    -H "Content-Type: image/jpeg" \
    --data-binary "@test_face.jpg")
  
  FRAME_COUNT=$((FRAME_COUNT+1))
  
  # Parse the response slightly to see if it was accepted
  if echo "$RESPONSE" | grep -q '"accepted":true'; then
    echo -ne "Frame $FRAME_COUNT sent -> ACCEPTED \r"
  else
    echo -ne "Frame $FRAME_COUNT sent -> REJECTED (Turn on live view in dashboard!) \r"
  fi
  
  # Wait 500ms before sending the next frame (approx 2 FPS)
  sleep 0.5
done
