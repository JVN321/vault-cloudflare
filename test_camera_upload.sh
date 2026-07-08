#!/bin/bash
# test_camera_upload.sh
# Run this script to test the camera image upload and face enrollment endpoint.
# Make sure your backend is running on http://localhost:8788

#API_URL="http://localhost:8788"
 API_URL="https://vault-cloudflare-8fu.pages.dev"
# Read API_KEY from .dev.vars
if [ -f ".dev.vars" ]; then
  # Use grep and sed to safely extract the value even if it has quotes
  API_KEY=$(grep "^CAMERA_API_KEY=" .dev.vars | sed 's/^.*=//' | tr -d '"')
else
  API_KEY="test_key_123"
fi

# 1. Upload a picture (ESP32 simulation)
# Replace 'test_face.jpg' with a real image containing a face.
echo "1. Uploading image to ESP32 doorbell endpoint..."
if [ ! -f "test_face.jpg" ]; then
  echo "Error: test_face.jpg not found. Please create or download a test image with a face in it and save it as test_face.jpg"
  exit 1
fi

UPLOAD_RESPONSE=$(curl -s -X POST "${API_URL}/api/v1/upload?api_key=${API_KEY}" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@test_face.jpg")

echo "Upload Response: $UPLOAD_RESPONSE"

# Extract the objectKey from the response using jq
OBJECT_KEY=$(echo "$UPLOAD_RESPONSE" | jq -r '.data.objectKey')

if [ -z "$OBJECT_KEY" ] || [ "$OBJECT_KEY" == "null" ]; then
  echo "Failed to get objectKey from upload response."
  exit 1
fi

echo "Uploaded Image Key: $OBJECT_KEY"
echo ""



# 2. Test the enroll-face endpoint using the uploaded image
echo "2. Enrolling face using the uploaded image for user john-5514..."
ENROLL_RESPONSE=$(curl -s -X POST "${API_URL}/api/v1/face/enroll?api_key=${API_KEY}&name=john-5514" \
  -H "Content-Type: image/jpeg" \
  --data-binary "@test_face.jpg")

echo "Enroll Response: $ENROLL_RESPONSE"
echo ""

echo "Test complete!"
