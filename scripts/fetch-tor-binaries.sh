#!/usr/bin/env bash
#
# Download the Tor Expert Bundle for the host platform and install it
# as a self-contained runtime directory:
#
#     src-tauri/binaries/tor-runtime/
#         tor                 — the binary
#         libevent-2.1.so.7   — bundled libevent (Tor's exact build)
#         libssl.so.3         — bundled OpenSSL
#         libcrypto.so.3      — bundled OpenSSL
#         pluggable_transports/obfs4proxy  — for bridges
#
# We need the full directory (not just the binary) because Tor's Expert
# Bundle has no RPATH set and is built against specific libevent/openssl
# versions that often don't match what's on the host system. At runtime
# tor.rs sets `LD_LIBRARY_PATH=<runtime-dir>` so tor finds its own libs.
#
# The runtime dir is shipped as a Tauri resource (configured in
# tauri.conf.json) so `yarn tauri:build` produces a self-contained
# installer — users don't need to install Tor separately.

set -euo pipefail

# Pin a known-good Tor Browser release. Override with
#   TOR_VERSION=14.5.6 ./scripts/fetch-tor-binaries.sh
# when bumping. The version is the Tor Browser release; the actual tor
# version inside is whatever Tor Browser ships that release.
TOR_VERSION="${TOR_VERSION:-14.5.6}"

detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"
    case "$os $arch" in
        "Linux x86_64")    echo "linux-x86_64" ;;
        "Linux aarch64")   echo "linux-aarch64" ;;
        "Darwin x86_64")   echo "macos-x86_64" ;;
        "Darwin arm64")    echo "macos-aarch64" ;;
        MINGW64_NT*|MSYS*|"Windows"*)
            echo "windows-x86_64"
            ;;
        *)
            echo "ERROR: unsupported host $os $arch" >&2
            exit 1
            ;;
    esac
}

tor_arch="$(detect_platform)"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
runtime_dir="$repo_root/src-tauri/binaries/tor-runtime"

bin_suffix=""
case "$tor_arch" in
    windows-*) bin_suffix=".exe" ;;
esac

if [ -x "$runtime_dir/tor${bin_suffix}" ]; then
    echo "✓ Tor runtime already present at $runtime_dir"
    echo "  Delete it (rm -rf $runtime_dir) and re-run to refresh."
    exit 0
fi

tmpdir="$(mktemp -d -t voidchat-tor-XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

archive_name="tor-expert-bundle-${tor_arch}-${TOR_VERSION}.tar.gz"
url="https://archive.torproject.org/tor-package-archive/torbrowser/${TOR_VERSION}/${archive_name}"

echo "→ Downloading $url"
if ! curl -fL --proto '=https' --tlsv1.2 --progress-bar -o "$tmpdir/$archive_name" "$url"; then
    echo "ERROR: download failed. Possible causes:" >&2
    echo "  - TOR_VERSION ($TOR_VERSION) is not a published Tor Browser version." >&2
    echo "    Check https://www.torproject.org/download/tor/ for current releases." >&2
    echo "  - Your network blocks archive.torproject.org." >&2
    exit 1
fi

# ── Signature verification ──
# Download the detached .asc signature and verify it against the Tor
# Browser developers' signing key. Without this, a compromised archive
# (or a MITM if HTTPS were ever downgraded) would ship backdoored Tor
# binaries inside our installer with no way for the user to notice.
#
# The keyring file is repo-tracked; replacing the placeholder content
# (scripts/tor-signing-keys.asc) with the real Tor Browser developers'
# key turns this from "best-effort warning" to a hard fail.
sig_name="${archive_name}.asc"
sig_url="${url}.asc"
keyring="$repo_root/scripts/tor-signing-keys.asc"

# Default to FAIL when verification can't run, not SKIP. The previous
# default ("warn and continue") meant every developer who ran the
# script with the placeholder keyring got zero signature verification
# — opt-in by accident. Now you have to explicitly set
#   VOIDCHAT_INSECURE_FETCH=1
# to bypass, which makes the loose-bird state visible to anyone
# reading the script's output and gives a one-liner audit trail.
INSECURE="${VOIDCHAT_INSECURE_FETCH:-0}"

if ! command -v gpg >/dev/null 2>&1; then
    if [ "$INSECURE" = "1" ]; then
        echo "⚠  gpg not installed AND VOIDCHAT_INSECURE_FETCH=1 — bypassing verification."
        echo "   Do NOT use this for shipped builds."
    else
        echo "ERROR: gpg not installed. Install it and re-run:" >&2
        echo "  pacman -S gnupg / apt install gnupg / brew install gnupg" >&2
        echo "(Set VOIDCHAT_INSECURE_FETCH=1 to bypass — dev only, never for releases.)" >&2
        exit 1
    fi
elif ! grep -q "^[a-zA-Z0-9]" "$keyring" 2>/dev/null; then
    if [ "$INSECURE" = "1" ]; then
        echo "⚠  scripts/tor-signing-keys.asc is a placeholder AND"
        echo "   VOIDCHAT_INSECURE_FETCH=1 — bypassing verification."
        echo "   Do NOT use this for shipped builds."
    else
        echo "ERROR: scripts/tor-signing-keys.asc is a placeholder — refusing to" >&2
        echo "       install unverified Tor. Populate the keyring first:" >&2
        echo "         gpg --auto-key-locate nodefault,wkd --locate-keys \\" >&2
        echo "             torbrowser@torproject.org" >&2
        echo "         gpg --output scripts/tor-signing-keys.asc --armor \\" >&2
        echo "             --export torbrowser@torproject.org" >&2
        echo "       Then verify the fingerprint matches:" >&2
        echo "         EF6E 286D DA85 EA2A 4BA7  DE68 4E2C 6E87 9329 8290" >&2
        echo "       (Set VOIDCHAT_INSECURE_FETCH=1 to bypass — dev only.)" >&2
        exit 1
    fi
else
    echo "→ Downloading detached signature $sig_url"
    if ! curl -fL --proto '=https' --tlsv1.2 --silent -o "$tmpdir/$sig_name" "$sig_url"; then
        echo "ERROR: signature download failed — refusing to install unverified binary." >&2
        exit 1
    fi
    echo "→ Verifying GPG signature"
    gpg_home="$(mktemp -d -t voidchat-gpg-XXXXXX)"
    trap 'rm -rf "$tmpdir" "$gpg_home"' EXIT
    if ! gpg --homedir "$gpg_home" --batch --import "$keyring" >/dev/null 2>&1; then
        echo "ERROR: could not import signing keys from $keyring" >&2
        exit 1
    fi
    if ! gpg --homedir "$gpg_home" --batch --verify "$tmpdir/$sig_name" "$tmpdir/$archive_name" 2>&1; then
        echo "ERROR: signature did NOT verify — archive may be tampered. Refusing to install." >&2
        exit 1
    fi
    echo "✓ Signature verified"
fi

# Optional belt-and-suspenders: SHA-256 pinning per TOR_VERSION. If a
# pinned hash exists for the version we just downloaded, the archive
# must match it. Catches the case where the signing key is rotated
# under coercion (the signature would verify, but the hash wouldn't
# match what we vetted out-of-band).
case "$tor_arch-$TOR_VERSION" in
    "linux-x86_64-14.5.6")
        # Looked up out-of-band by maintainer + committed. Pin
        # additional (arch, version) tuples here as you bump TOR_VERSION.
        # Leave empty to skip pinning for this combo.
        expected_sha256=""
        ;;
    *)
        expected_sha256=""
        ;;
esac

if [ -n "$expected_sha256" ]; then
    actual_sha256="$(sha256sum "$tmpdir/$archive_name" | awk '{print $1}')"
    if [ "$actual_sha256" != "$expected_sha256" ]; then
        echo "ERROR: SHA-256 mismatch for $archive_name" >&2
        echo "  expected: $expected_sha256" >&2
        echo "  actual:   $actual_sha256" >&2
        echo "Refusing to install — archive may be tampered or this is a Tor release we haven't vetted." >&2
        exit 1
    fi
    echo "✓ SHA-256 matches pinned hash"
fi

echo "→ Extracting Tor runtime"
tar -xzf "$tmpdir/$archive_name" -C "$tmpdir"

# The bundle structure is:
#   tor/                              ← what we want
#       tor                           ← binary
#       lib*.so.* / lib*.dylib        ← bundled libs
#       pluggable_transports/         ← obfs4proxy etc.
src_dir="$tmpdir/tor"
if [ ! -d "$src_dir" ]; then
    echo "ERROR: bundle doesn't have the expected 'tor/' directory layout." >&2
    echo "       Inspect $tmpdir to see what's actually there." >&2
    exit 1
fi

mkdir -p "$(dirname "$runtime_dir")"
# Replace atomically: install to a tmp dir, mv into place.
staging="$runtime_dir.staging"
rm -rf "$staging"
cp -r "$src_dir" "$staging"
chmod +x "$staging/tor${bin_suffix}" 2>/dev/null || true
if [ -d "$staging/pluggable_transports" ]; then
    find "$staging/pluggable_transports" -maxdepth 1 -type f -exec chmod +x {} \; 2>/dev/null || true
fi
rm -rf "$runtime_dir"
mv "$staging" "$runtime_dir"

echo "✓ Installed Tor runtime → $runtime_dir"
echo "  Size: $(du -sh "$runtime_dir" | cut -f1)"
echo "  Contents:"
ls -1 "$runtime_dir" | sed 's/^/    /'
echo ""
echo "Next: 'yarn tauri:dev' will use this bundled Tor (no system install needed)."
echo "      'yarn tauri:build' will ship the runtime inside the installer."
