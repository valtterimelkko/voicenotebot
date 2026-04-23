#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="/root/voicenotebot/streaming-dictation/backend"
SERVICE_NAME="streaming-dictation"

cd "$BACKEND_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env file not found at $BACKEND_DIR/.env"
  echo "Copy from .env.example and fill in values:"
  echo "  cp .env.example .env"
  exit 1
fi

echo "Installing dependencies..."
npm install --production=false

echo "Building TypeScript..."
npm run build

echo "Restarting $SERVICE_NAME service..."
systemctl restart "$SERVICE_NAME"

sleep 2

echo ""
echo "Service status:"
systemctl status "$SERVICE_NAME" --no-pager || true
echo ""
echo "Recent logs:"
journalctl -u "$SERVICE_NAME" -n 20 --no-pager
