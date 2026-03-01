#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_NAME="skill-tree"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.local/bin}"

mkdir -p "${INSTALL_DIR}"
bun build --compile "${ROOT_DIR}/apps/cli/src/main.ts" --outfile "${INSTALL_DIR}/${BIN_NAME}"
chmod +x "${INSTALL_DIR}/${BIN_NAME}"

echo "Installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}"
