#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SD_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$SD_DIR/backend"
FRONTEND_DIR="$SD_DIR/frontend"
SERVICE_NAME="streaming-dictation"

cd "$BACKEND_DIR"

if [ ! -f .env ]; then
  echo "ERROR: .env file not found at $BACKEND_DIR/.env"
  echo "Copy from .env.example and fill in values:"
  echo "  cp .env.example .env"
  exit 1
fi

echo "Installing backend dependencies..."
npm install --production=false

echo "Building TypeScript backend..."
npm run build

echo "Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install

echo "Building frontend..."
npm run build

cd "$BACKEND_DIR"

echo "Restarting $SERVICE_NAME service..."
systemctl restart "$SERVICE_NAME"

sleep 2

echo ""
echo "Service status:"
systemctl status "$SERVICE_NAME" --no-pager || true
echo ""
echo "Recent logs:"
journalctl -u "$SERVICE_NAME" -n 20 --no-pager
