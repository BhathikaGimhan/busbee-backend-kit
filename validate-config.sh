#!/bin/bash

# Firebase Configuration Validator
# Run this after updating your .env file to check if credentials are properly configured

echo "🔍 Checking Firebase Configuration..."
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found!"
    echo "Make sure you're in the busbee-backend directory"
    exit 1
fi

# Load environment variables
set -a
source .env
set +a

echo "📋 Configuration Status:"
echo ""

# Check Firebase Project ID
if [ -n "$FIREBASE_PROJECT_ID" ]; then
    echo "✅ FIREBASE_PROJECT_ID: $FIREBASE_PROJECT_ID"
else
    echo "❌ FIREBASE_PROJECT_ID: Not set"
fi

# Check Firebase API Key
if [ -n "$FIREBASE_API_KEY" ]; then
    echo "✅ FIREBASE_API_KEY: Configured"
else
    echo "❌ FIREBASE_API_KEY: Not set"
fi

# Check Firebase Private Key
if [ -n "$FIREBASE_PRIVATE_KEY" ]; then
    echo "✅ FIREBASE_PRIVATE_KEY: Configured"
else
    echo "❌ FIREBASE_PRIVATE_KEY: Not set"
fi

# Check Firebase Client Email
if [ -n "$FIREBASE_CLIENT_EMAIL" ]; then
    echo "✅ FIREBASE_CLIENT_EMAIL: $FIREBASE_CLIENT_EMAIL"
else
    echo "❌ FIREBASE_CLIENT_EMAIL: Not set"
fi

# Check JWT Secret
if [ -n "$JWT_SECRET" ]; then
    echo "✅ JWT_SECRET: Configured (${#JWT_SECRET} characters)"
else
    echo "❌ JWT_SECRET: Not set"
fi

echo ""
echo "🧪 Testing Firebase Connection..."

# Try to start the app briefly to test Firebase connection
timeout 10s npm run start 2>&1 | head -20

if [ $? -eq 0 ]; then
    echo "✅ Firebase connection successful!"
else
    echo "❌ Firebase connection failed. Check your credentials."
    echo "Make sure:"
    echo "  - Private key is wrapped in quotes"
    echo "  - \\n characters are preserved in private key"
    echo "  - Client email matches the service account"
fi

echo ""
echo "📖 If you need help, see: ../FIREBASE_SERVICE_ACCOUNT_SETUP.md"