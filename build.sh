#!/bin/sh
# build.sh — package the pure-Java Void Chat stack into a self-contained
# distribution. JDK-native tooling only (javac/jdeps/jar/jlink/jpackage);
# the zero-dependency rule applies to the build too. Requires JDK 21+.
#
#   ./build.sh             → dist/ (jar + trimmed runtime + launchers)
#   ./build.sh --package   → additionally dist/package/VoidChat (jpackage app-image)
#
# Ships: voidchat (GUI host+client), voidchat-relay (headless relay;
# VOIDCHAT_TOR=1 publishes it as an onion). Tor itself is NOT bundled in
# v0.1 — install the system tor (pacman/apt/brew) or set VOIDCHAT_TOR_BINARY.
set -eu

VERSION="0.1.0"
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIST="$ROOT/dist"

echo "== Void Chat Java build v$VERSION =="
rm -rf "$DIST"
mkdir -p "$DIST/classes"

# ── 1. Compile production sources (tests/bench/interop tools excluded) ──
find "$ROOT/seal-java" "$ROOT/relay-java" "$ROOT/client-java" -maxdepth 1 -name '*.java' \
    ! -name '*Test*.java' \
    ! -name 'Bench.java' \
    ! -name 'SealInterop.java' \
    ! -name 'SignInterop.java' \
    ! -name 'SealReverse.java' \
    ! -path "$ROOT/seal-java/Base58.java" \
    > "$DIST/sources.txt"
# (seal-java/Base58.java is a byte-identical copy of relay-java's — the
#  modules each build standalone in dev; the dist compiles them together.)
if ! diff -q "$ROOT/seal-java/Base58.java" "$ROOT/relay-java/Base58.java" > /dev/null; then
    echo "BUILD GATE FAILED: seal-java/Base58.java diverged from relay-java/Base58.java"
    exit 1
fi
javac -d "$DIST/classes" @"$DIST/sources.txt"
echo "compiled $(wc -l < "$DIST/sources.txt") sources"

# ── 2. Purity gate: nothing beyond java.base + java.desktop ─────────────
DEPS=$(jdeps --multi-release base -summary "$DIST/classes" 2>/dev/null \
        | awk '{print $NF}' | sort -u | grep -v '^classes$' || true)
for d in $DEPS; do
    case "$d" in
        # java.datatransfer = clipboard (Copy invite); required transitively
        # by java.desktop, so it adds nothing to the runtime image.
        java.base|java.desktop|java.datatransfer) ;;
        *) echo "PURITY GATE FAILED: unexpected module dependency '$d'"; exit 1 ;;
    esac
done
echo "jdeps purity gate: java.base + java.desktop(+datatransfer) only"

# ── 3. Jar (GUI is Main-Class; relay runs via launcher -cp) ─────────────
cat > "$DIST/MANIFEST.MF" <<EOF
Main-Class: VoidChatApp
Implementation-Title: Void Chat (Java)
Implementation-Version: $VERSION
EOF
jar --create --file "$DIST/voidchat.jar" --manifest "$DIST/MANIFEST.MF" -C "$DIST/classes" .
echo "jar: $(du -h "$DIST/voidchat.jar" | cut -f1) voidchat.jar"

# ── 4. Trimmed runtime ───────────────────────────────────────────────────
jlink --add-modules java.base,java.desktop \
      --strip-debug --no-header-files --no-man-pages --compress zip-6 \
      --output "$DIST/runtime"
echo "runtime: $(du -sh "$DIST/runtime" | cut -f1) (java.base + java.desktop)"

# ── 5. Launchers ─────────────────────────────────────────────────────────
cat > "$DIST/voidchat" <<'EOF'
#!/bin/sh
# Void Chat — GUI (host + client). Hosting/joining .onion needs a tor
# binary: install system tor or set VOIDCHAT_TOR_BINARY.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/runtime/bin/java" -cp "$DIR/voidchat.jar" VoidChatApp "$@"
EOF
cat > "$DIST/voidchat-relay" <<'EOF'
#!/bin/sh
# Void Chat — headless relay. Env: SOCKET_PORT (3001), VOIDCHAT_DATA_DIR
# (./data), VOIDCHAT_TOR=1 to publish as a v3 onion (needs tor).
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/runtime/bin/java" -cp "$DIR/voidchat.jar" Main "$@"
EOF
chmod +x "$DIST/voidchat" "$DIST/voidchat-relay"
echo "$VERSION" > "$DIST/VERSION"
rm -rf "$DIST/classes" "$DIST/sources.txt" "$DIST/MANIFEST.MF"

# ── 6. Optional native app-image ─────────────────────────────────────────
if [ "${1:-}" = "--package" ]; then
    mkdir -p "$DIST/jpkg-in"
    cp "$DIST/voidchat.jar" "$DIST/jpkg-in/"
    jpackage --type app-image \
             --name VoidChat \
             --app-version "$VERSION" \
             --input "$DIST/jpkg-in" \
             --main-jar voidchat.jar \
             --runtime-image "$DIST/runtime" \
             --dest "$DIST/package"
    rm -rf "$DIST/jpkg-in"
    echo "app-image: $DIST/package/VoidChat"
fi

echo "== done: $DIST =="
echo "   GUI:   $DIST/voidchat"
echo "   Relay: $DIST/voidchat-relay"
