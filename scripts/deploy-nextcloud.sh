#!/usr/bin/env bash
#
# Build KeeNet for the Nextcloud app and deploy it into the app's bundled
# build directory. The Nextcloud app (custom_apps/keenet) serves this build
# same-origin from /apps/keenet/app/, so it is built with that absolute base.
#
# Usage:  scripts/deploy-nextcloud.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/server/thederf/srv/nextcloud-files/custom_apps/keenet"
DIST_DIR="$APP_DIR/keenet-dist"
NC_CONTAINER="compose-nextcloud-1"

cd "$REPO"

echo "==> Generating offline icon bundle"
node scripts/gen-icons.mjs

echo "==> Building KeeNet (base=/apps/keenet/app/)"
VITE_BASE_URL=/apps/keenet/app/ npx vite build --outDir dist-nc --emptyOutDir

echo "==> Syncing build into $DIST_DIR"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
# Sourcemaps are not needed in the embed (and would leak source); drop them.
rsync -a --exclude='*.map' dist-nc/ "$DIST_DIR/"
chmod -R a+rX "$APP_DIR"

echo "==> Bumping app cache so Nextcloud re-reads the new build"
# config.php is owned by the web-server user (uid 33), so occ runs as 33
# directly. Do NOT flip config.php ownership — leaving it non-www-data (or with
# perms that block uid 33) makes Nextcloud read an empty config and fail with
# "Configuration was not read or initialized correctly, not overwriting".
docker exec -u 33 "$NC_CONTAINER" php occ maintenance:repair --include-expensive >/dev/null 2>&1 || true

echo "==> Done. KeeNet is served at https://cloud.thederf.com/apps/keenet/"
