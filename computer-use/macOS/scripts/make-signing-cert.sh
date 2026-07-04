#!/bin/bash
#
# Create a stable self-signed code-signing identity for local development.
#
# Why this exists: TCC (Accessibility / Screen Recording) grants are bound to a
# code-signing identity + bundle path. An *ad-hoc* signature gets a fresh
# cdhash on every rebuild, so the grant resets each time — miserable during
# development. A stable self-signed certificate keeps the same designated
# requirement across rebuilds, so you grant permissions once.
#
# This identity is for LOCAL DEV ONLY. It does not pass Gatekeeper/notarization;
# distribution to other users requires a real Developer ID certificate.
#
# Usage: scripts/make-signing-cert.sh ["Identity Name"]
set -euo pipefail

CERT_NAME="${1:-NicoSoft CUA Dev}"
# Default to the login keychain (local dev). CI passes NSAI_CUA_KEYCHAIN pointing at an isolated temp
# keychain it created + unlocked + added to the search list (see .github/workflows/build.yml).
KEYCHAIN="${NSAI_CUA_KEYCHAIN:-$HOME/Library/Keychains/login.keychain-db}"
# Transit password for the PKCS#12 blob. A non-empty password is required:
# LibreSSL (the system openssl) writes a MAC that macOS's importer rejects when
# the password is empty. The key lands in the keychain unprotected regardless.
P12_PASS="nsai-cua-dev"

# A self-signed cert is not trust-anchored, so it never appears in the "-v"
# (valid) identity list even though codesign can sign with it. Detect against
# the full list instead.
if security find-identity -p codesigning 2>/dev/null | grep -qF "$CERT_NAME"; then
  echo "✓ code-signing identity '$CERT_NAME' already exists"
  exit 0
fi

echo "Creating self-signed code-signing identity '$CERT_NAME'…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Self-signed cert with the codeSigning extended key usage.
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 3650 \
  -subj "/CN=$CERT_NAME" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" \
  2>/dev/null

# Export with SHA1/3DES PBE so macOS's importer can read the blob. (On OpenSSL 3
# in PATH rather than LibreSSL, add `-legacy` if this ever fails to import.)
openssl pkcs12 -export -out "$TMP/identity.p12" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -passout "pass:$P12_PASS"

# Import the identity and pre-authorize codesign to use its private key.
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$P12_PASS" -T /usr/bin/codesign -A

# Best-effort: allow codesign to use the key without an interactive prompt.
# Requires the login keychain password; if it isn't supplied, codesign will
# instead prompt once on first use — click "Always Allow".
if [ -n "${LOGIN_KEYCHAIN_PASSWORD:-}" ]; then
  security set-key-partition-list -S apple-tool:,apple: -s \
    -k "$LOGIN_KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null 2>&1 || true
fi

if security find-identity -p codesigning 2>/dev/null | grep -qF "$CERT_NAME"; then
  echo "✓ created code-signing identity '$CERT_NAME'"
  echo "  (listed as CSSMERR_TP_NOT_TRUSTED — expected for a self-signed cert;"
  echo "   codesign can still sign with it, which is all we need locally.)"
else
  echo "⚠ '$CERT_NAME' import did not register. Fall back to ad-hoc signing"
  echo "  (package-app.sh does this automatically when no identity is found;"
  echo "  TCC will then reset on each rebuild)."
fi
