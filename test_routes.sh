#!/bin/bash
# test_routes.sh
# Run this script to test various backend routes

API_URL="http://localhost:8788"

echo "======================================"
echo "Testing System Config (GET /api/v1/settings)"
echo "======================================"
curl -s -X GET "${API_URL}/api/v1/settings" | jq || echo "Failed"
echo -e "\n"

echo "======================================"
echo "Testing Users (GET /api/v1/users)"
echo "======================================"
curl -s -X GET "${API_URL}/api/v1/users" | jq || echo "Failed"
echo -e "\n"

echo "======================================"
echo "Testing Commands (POST /api/v1/commands)"
echo "======================================"
curl -s -X POST "${API_URL}/api/v1/commands" \
  -H "Content-Type: application/json" \
  -d '{"type":"PULSE"}' | jq || echo "Failed"
echo -e "\n"

echo "======================================"
echo "Testing User Creation (POST /api/v1/users)"
echo "======================================"
curl -s -X POST "${API_URL}/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser123", "email": "test@vault.local", "name": "Test Runner", "password": "secure"}' | jq || echo "Failed"
echo -e "\n"

echo "======================================"
echo "Testing Images List (GET /api/v1/images)"
echo "======================================"
curl -s -X GET "${API_URL}/api/v1/images" | jq || echo "Failed"
echo -e "\n"

echo "Done!"
