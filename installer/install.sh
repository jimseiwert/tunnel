#!/usr/bin/env bash
# Conduit CLI installer — macOS and Linux
# Usage: curl -fsSL https://get.conduitrelay.com/conduit | bash

set -euo pipefail

REPO="jimseiwert/conduit"
BINARY="conduit"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"
INSTALL_DIR="${CONDUIT_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
mkdir -p "$INSTALL_DIR"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

case "$OS" in
  linux)  PLATFORM="linux-${ARCH}" ;;
  darwin) PLATFORM="macos-${ARCH}" ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

# Get latest release tag
echo "Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"tag_name": "(.+)".*/\1/')
if [ -z "$TAG" ]; then
  echo "Failed to fetch latest release tag" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY}-${PLATFORM}"
SUMS_URL="https://github.com/${REPO}/releases/download/${TAG}/SHA256SUMS"
echo "Downloading ${BINARY} ${TAG} for ${PLATFORM}..."
curl -fsSL -o "/tmp/${BINARY}" "$URL"

# Verify SHA256 against the published SHA256SUMS
echo "Verifying checksum..."
SUMS=$(curl -fsSL "$SUMS_URL" || true)
EXPECTED=$(printf '%s\n' "$SUMS" | grep " ${BINARY}-${PLATFORM}$" | awk '{print $1}' || true)
if [ -z "$EXPECTED" ]; then
  echo "Could not find a checksum for ${BINARY}-${PLATFORM} in SHA256SUMS" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "/tmp/${BINARY}" | awk '{print $1}')
else
  ACTUAL=$(shasum -a 256 "/tmp/${BINARY}" | awk '{print $1}')
fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch! expected ${EXPECTED}, got ${ACTUAL}" >&2
  rm -f "/tmp/${BINARY}"
  exit 1
fi
chmod +x "/tmp/${BINARY}"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "/tmp/${BINARY}" "${INSTALL_DIR}/${BINARY}"
else
  echo "Installing to $INSTALL_DIR (requires sudo)..."
  sudo mv "/tmp/${BINARY}" "${INSTALL_DIR}/${BINARY}"
fi

echo ""
echo "Conduit CLI installed successfully → ${INSTALL_DIR}/${BINARY}"

# Remind the user if the install dir isn't on their PATH
if [[ ":$PATH:" != *":${INSTALL_DIR}:"* ]]; then
  echo ""
  echo "  Add this to your shell profile to put conduit on your PATH:"
  echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

echo ""
echo "Run: conduit --help"
