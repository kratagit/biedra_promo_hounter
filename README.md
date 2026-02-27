# biedra_promo_hounter

BiedraBOT — wyszukiwarka promocji w gazetkach Biedronki z OCR.

## Uruchamianie (tryb deweloperski)

```bash
npm install
npm start
```

Wymaga zainstalowanego Pythona 3 i Tesseracta w systemie.

## Budowanie

### Wymagania wspólne

- **Node.js** 18+
- **Python** 3.10+
- **pip** z pakietami z `requirements.txt` (`pip install -r requirements.txt`)
- **PyInstaller** (`pip install pyinstaller`)

---

### Linux

#### Dodatkowe wymagania

```bash
sudo apt install tesseract-ocr tesseract-ocr-pol
```

#### Budowanie

```bash
./scripts/build-linux.sh
```

Skrypt automatycznie:
1. Kompiluje `biedrona.py` do binarki przez PyInstaller → `python_dist/`
2. Kopiuje Tesseracta z bibliotekami + `pol.traineddata` → `tesseract_dist/`
3. Instaluje zależności npm
4. Buduje aplikację Electron (`AppImage`)

Wynik w katalogu `dist/`.

---

### Windows

#### Dodatkowe wymagania

- **Tesseract OCR** — zainstaluj z [UB-Mannheim](https://github.com/UB-Mannheim/tesseract/wiki)
  - Podczas instalacji zaznacz język **Polski**
  - Domyślna ścieżka: `C:\Program Files\Tesseract-OCR\`

#### Budowanie

```bat
scripts\build-windows.bat
```

Skrypt automatycznie:
1. Kompiluje `biedrona.py` do `.exe` przez PyInstaller → `python_dist\`
2. Kopiuje Tesseracta + DLL-e + `pol.traineddata` → `tesseract_dist\`
3. Instaluje zależności npm
4. Buduje portable `.exe` (bez instalacji)

Wynik w katalogu `dist\`.

---

### GitHub Actions (automatycznie)

Build odpala się automatycznie po pushu taga `v*` (np. `v1.0.0`).
Można też odpalić ręcznie z zakładki Actions → Build → "Run workflow".

```bash
git tag v1.0.0
git push origin v1.0.0
```

Workflow buduje jednocześnie Linux (AppImage) i Windows (portable .exe), a wyniki publikuje jako GitHub Release z plikami do pobrania.

---

## OCR cache

Skrypt zapisuje wyniki OCR do lokalnej bazy `ocr_cache.db` (SQLite + FTS5).

- strona gazetki jest OCR-owana tylko raz,
- przy kolejnych uruchomieniach wyszukiwanie słowa odbywa się po indeksie,
- OCR wykonywany jest tylko dla nowych stron, których nie ma jeszcze w cache.
- nieaktualne gazetki są automatycznie usuwane z cache i nie są brane pod uwagę.
