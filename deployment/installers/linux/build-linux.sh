#!/usr/bin/env bash
# Builds a tar.gz and a .deb package. Usage: ./deployment/installers/linux/build-linux.sh 0.1.0
set -euo pipefail
VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
npm ci --no-audit --no-fund && npm run build && npm test

OUT="release/linux"; APP="$OUT/opt/ai-native-platform"
rm -rf "$OUT" && mkdir -p "$APP" "$OUT/usr/bin" "$OUT/DEBIAN"
cp -r dist config package.json "$APP/"
printf '#!/bin/sh\nexec node /opt/ai-native-platform/dist/apps/desktop-ide/cli.js "$@"\n' > "$OUT/usr/bin/ai-platform"
chmod 755 "$OUT/usr/bin/ai-platform"
cat > "$OUT/DEBIAN/control" <<CTRL
Package: ai-native-platform
Version: $VERSION
Architecture: all
Maintainer: gauravgupta0612
Depends: nodejs (>= 22)
Description: AI-Native Developer Platform (CLI and server)
CTRL
tar -czf "release/ai-native-platform-$VERSION-linux.tar.gz" -C "$OUT" opt usr
command -v dpkg-deb >/dev/null && dpkg-deb --build --root-owner-group "$OUT" "release/ai-native-platform_${VERSION}_all.deb" || echo "dpkg-deb not found: skipped .deb"
sha256sum release/*.tar.gz release/*.deb 2>/dev/null || true
