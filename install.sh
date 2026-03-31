#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_NAME="skill-tree"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.local/bin}"

# shellcheck source=../packages/cli-core/scripts/install-binary.sh
source "${ROOT_DIR}/../packages/cli-core/scripts/install-binary.sh"

cargo build --release --manifest-path "${ROOT_DIR}/Cargo.toml"
install_binary "${ROOT_DIR}/target/release/${BIN_NAME}" "${INSTALL_DIR}/${BIN_NAME}"

echo "Installed ${BIN_NAME} to ${INSTALL_DIR}/${BIN_NAME}"
