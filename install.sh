#!/usr/bin/env bash
# Instalador de Lexema CLI para Linux y macOS.
# Uso:
#   curl -fsSL https://lexemalabs.shop/install.sh | bash
#
# Sube este archivo a la raíz del sitio de lexemalabs.shop (el mismo proyecto
# de Cloudflare Pages) para que quede disponible en https://lexemalabs.shop/install.sh

set -euo pipefail

# --- Configura esto con tu repositorio real ---
REPO="diegoabdo/lexema-cli"
BIN_NAME="lexema"
INSTALL_DIR="/usr/local/bin"
# -----------------------------------------------

os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Linux) platform="linux" ;;
  Darwin) platform="macos" ;;
  *)
    echo "Sistema operativo no soportado por este script: $os" >&2
    echo "Descarga el binario manualmente desde https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
esac

case "$arch" in
  x86_64|amd64) arch_suffix="x64" ;;
  arm64|aarch64) arch_suffix="arm64" ;;
  *)
    echo "Arquitectura no soportada: $arch" >&2
    exit 1
    ;;
esac

# macOS x64 y arm64 se publican; Linux solo se publica x64 en el workflow por defecto.
if [ "$platform" = "linux" ] && [ "$arch_suffix" = "arm64" ]; then
  echo "No hay binario de Linux arm64 publicado todavía. Compílalo tú mismo o pide soporte." >&2
  exit 1
fi

asset="${BIN_NAME}-${platform}-${arch_suffix}"

latest_url="https://api.github.com/repos/${REPO}/releases/latest"
echo "Buscando la última versión en ${latest_url}..."

download_url="$(curl -fsSL "$latest_url" | grep "browser_download_url.*${asset}" | cut -d '"' -f 4 | head -n 1)"

if [ -z "$download_url" ]; then
  echo "No se encontró un binario llamado '${asset}' en el último Release de ${REPO}." >&2
  echo "Revisa https://github.com/${REPO}/releases" >&2
  exit 1
fi

tmp_file="$(mktemp)"
echo "Descargando ${download_url}..."
curl -fsSL "$download_url" -o "$tmp_file"
chmod +x "$tmp_file"

if [ -w "$INSTALL_DIR" ]; then
  mv "$tmp_file" "${INSTALL_DIR}/${BIN_NAME}"
else
  echo "Se requieren permisos de administrador para instalar en ${INSTALL_DIR}"
  sudo mv "$tmp_file" "${INSTALL_DIR}/${BIN_NAME}"
fi

echo "✔ Lexema CLI instalado en ${INSTALL_DIR}/${BIN_NAME}"
echo "Prueba con: ${BIN_NAME} ask \"Hola\""
