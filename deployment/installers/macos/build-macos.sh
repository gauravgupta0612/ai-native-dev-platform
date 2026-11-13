#!/usr/bin/env bash
# Builds a macOS .pkg (needs Xcode command line tools). Usage: ./deployment/installers/macos/build-macos.sh 0.1.0
# For distribution: sign with your Developer ID (SIGN_ID env) and notarize with `xcrun notarytool`.
set -euo pipefail
VERSION="${1:-0.1.0}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
npm ci --no-audit --no-fund && npm run build && npm test

OUT="release/macos/root"; APP="$OUT/usr/local/ai-native-platform"
rm -rf release/macos && mkdir -p "$APP" "$OUT/usr/local/bin"
cp -r dist config package.json "$APP/"
printf '#!/bin/sh\nexec node /usr/local/ai-native-platform/dist/apps/desktop-ide/cli.js "$@"\n' > "$OUT/usr/local/bin/ai-platform"
chmod 755 "$OUT/usr/local/bin/ai-platform"
pkgbuild --root "$OUT" --identifier com.ainative.platform --version "$VERSION" ${SIGN_ID:+--sign "$SIGN_ID"} "release/ai-native-platform-$VERSION.pkg"
shasum -a 256 release/*.pkg
