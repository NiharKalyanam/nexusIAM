#!/bin/bash
set -e

echo "🔨 NexusIAM Rebuild"
echo "==================="

cd "$(dirname "$0")"

# Step 1: Build React on Mac (fast - no Docker VM sync issues)
echo "⚛️  Building React..."
cd frontend
rm -rf build
npm run build 2>&1 | tail -5
echo "✅ React built: $(ls build/static/js/main.*.js 2>/dev/null | head -1 | xargs basename 2>/dev/null)"
cd ..

# Step 2: Stop and restart (reuse existing images - much faster)
echo "🛑 Stopping..."
docker compose down 2>/dev/null || true

echo "🐳 Building and starting..."
DOCKER_BUILDKIT=0 docker compose build --no-cache frontend
docker compose up -d

echo ""
echo "✅ Done! http://localhost:3000"
echo ""
echo "To also rebuild backend: DOCKER_BUILDKIT=0 docker compose build --no-cache"
