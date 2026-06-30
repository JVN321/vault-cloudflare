#!/bin/bash
# test_verify.sh
# Run this script to test the face verification endpoint.

API_URL="http://localhost:8788"
#API_URL="https://vault-cloudflare-8fu.pages.dev"

# Read API_KEY from .dev.vars
if [ -f ".dev.vars" ]; then
  API_KEY=$(grep "^CAMERA_API_KEY=" .dev.vars | sed 's/^.*=//' | tr -d '"')
else
  API_KEY="test_key_123"
fi

if [ ! -f "test_face.jpg" ]; then
  echo "Error: test_face.jpg not found. Please ensure it exists."
  exit 1
fi

echo "Verifying face..."
VERIFY_RESPONSE=$(curl -s -X POST "${API_URL}/api/v1/face/verify?api_key=${API_KEY}" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@test_face.jpg")

echo "Verify Response: $VERIFY_RESPONSE"
