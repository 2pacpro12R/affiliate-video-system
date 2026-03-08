#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./deploy-vps.sh "https://thumbnailcreator.com?atp=fHsill"
#
# Optional env vars:
#   VPS_HOST (default: 187.124.82.67)
#   VPS_USER (default: root)
#   VPS_DIR  (default: /root/.affiliate-video-system)

URL="${1:-https://thumbnailcreator.com?atp=fHsill}"
VPS_HOST="${VPS_HOST:-187.124.82.67}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/root/.affiliate-video-system}"
TARGET="${VPS_USER}@${VPS_HOST}"

echo "[1/4] Preparing remote directory..."
ssh "$TARGET" "mkdir -p '$VPS_DIR'"

echo "[2/4] Uploading project files..."
scp pipeline.js package.json package-lock.json .env.example "$TARGET:$VPS_DIR/"

echo "[3/4] Installing dependencies on VPS..."
ssh "$TARGET" "cd '$VPS_DIR' && npm install"

echo "[4/4] Running pipeline..."
ssh "$TARGET" "cd '$VPS_DIR' && node pipeline.js '$URL'"

echo "[done] VPS pipeline run finished."
