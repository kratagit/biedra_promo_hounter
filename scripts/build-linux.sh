#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Biedronka Promo Hunter — Build Linux ==="

# ---------- 0. Activate venv ----------
VENV_DIR="$PROJECT_DIR/.venv"
if [ -f "$VENV_DIR/bin/activate" ]; then
    echo "[0] Aktywuję venv (.venv)..."
    source "$VENV_DIR/bin/activate"
elif [ -f "$PROJECT_DIR/venv/bin/activate" ]; then
    echo "[0] Aktywuję venv (venv)..."
    source "$PROJECT_DIR/venv/bin/activate"
else
    echo "  ✗ Nie znaleziono virtualenv (.venv/ ani venv/)!"
    echo "    Utwórz: python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# ---------- 1. Python binary (PyInstaller) ----------
echo ""
echo "[1/3] Budowanie binarki Pythona (PyInstaller)..."

if ! command -v pyinstaller &> /dev/null; then
    echo "  → Instaluję PyInstaller..."
    pip install pyinstaller
fi

rm -rf build_py dist_py
pyinstaller \
    --distpath dist_py \
    --workpath build_py \
    --noconfirm \
    --onedir \
    --name biedrona \
    --hidden-import=PIL \
    --hidden-import=PIL.Image \
    --hidden-import=certifi \
    --collect-data certifi \
    biedrona.py

rm -rf python_dist
cp -r dist_py/biedrona python_dist
echo "  ✓ python_dist/ gotowy"

# ---------- 2. npm install ----------
echo ""
echo "[2/3] Instaluję zależności npm..."
npm install
echo "  ✓ node_modules gotowy"

# ---------- 3. Electron Builder ----------
echo ""
echo "[3/3] Budowanie aplikacji Electron (Linux)..."
npx electron-builder --linux

echo ""
echo "=== BUILD ZAKOŃCZONY ==="
echo "Wynik znajdziesz w katalogu: dist/"
ls -lh dist/*.AppImage dist/*.deb 2>/dev/null || echo "(brak plików wyjściowych — sprawdź logi)"
