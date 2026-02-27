#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Biedronka Promo Hunter — Build Linux ==="

# ---------- 1. Python binary (PyInstaller) ----------
echo ""
echo "[1/4] Budowanie binarki Pythona (PyInstaller)..."

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
    --hidden-import=pytesseract \
    biedrona.py

rm -rf python_dist
cp -r dist_py/biedrona python_dist
echo "  ✓ python_dist/ gotowy"

# ---------- 2. Tesseract (only Polish) ----------
echo ""
echo "[2/4] Kopiowanie Tesseracta (język polski)..."

TESS_BIN=$(which tesseract 2>/dev/null || true)
if [ -z "$TESS_BIN" ]; then
    echo "  ✗ Tesseract nie znaleziony! Zainstaluj: sudo apt install tesseract-ocr tesseract-ocr-pol"
    exit 1
fi

rm -rf tesseract_dist
mkdir -p tesseract_dist/tessdata

# Copy binary
cp "$TESS_BIN" tesseract_dist/tesseract
chmod +x tesseract_dist/tesseract

# Copy required shared libraries
echo "  → Kopiuję zależności bibliotek..."
mkdir -p tesseract_dist/lib
ldd "$TESS_BIN" | grep "=> /" | awk '{print $3}' | while read lib; do
    cp "$lib" tesseract_dist/lib/ 2>/dev/null || true
done

# Create wrapper script that sets LD_LIBRARY_PATH
mv tesseract_dist/tesseract tesseract_dist/tesseract.bin
cat > tesseract_dist/tesseract << 'WRAPPER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
export LD_LIBRARY_PATH="$DIR/lib:$LD_LIBRARY_PATH"
exec "$DIR/tesseract.bin" "$@"
WRAPPER
chmod +x tesseract_dist/tesseract

# Copy Polish tessdata
TESSDATA_DIRS=(
    "/usr/share/tesseract-ocr/5/tessdata"
    "/usr/share/tesseract-ocr/4.00/tessdata"
    "/usr/share/tesseract-ocr/tessdata"
    "/usr/share/tessdata"
    "/usr/local/share/tessdata"
)

TESSDATA_FOUND=false
for td in "${TESSDATA_DIRS[@]}"; do
    if [ -f "$td/pol.traineddata" ]; then
        cp "$td/pol.traineddata" tesseract_dist/tessdata/
        cp "$td/osd.traineddata" tesseract_dist/tessdata/ 2>/dev/null || true
        # eng jest potrzebny jako fallback
        cp "$td/eng.traineddata" tesseract_dist/tessdata/ 2>/dev/null || true
        TESSDATA_FOUND=true
        echo "  ✓ tessdata skopiowane z $td"
        break
    fi
done

if [ "$TESSDATA_FOUND" = false ]; then
    echo "  ✗ Nie znaleziono pol.traineddata! Zainstaluj: sudo apt install tesseract-ocr-pol"
    exit 1
fi

echo "  ✓ tesseract_dist/ gotowy"

# ---------- 3. npm install ----------
echo ""
echo "[3/4] Instaluję zależności npm..."
npm install
echo "  ✓ node_modules gotowy"

# ---------- 4. Electron Builder ----------
echo ""
echo "[4/4] Budowanie aplikacji Electron (Linux)..."
npx electron-builder --linux

echo ""
echo "=== BUILD ZAKOŃCZONY ==="
echo "Wynik znajdziesz w katalogu: dist/"
ls -lh dist/*.AppImage dist/*.deb 2>/dev/null || echo "(brak plików wyjściowych — sprawdź logi)"
