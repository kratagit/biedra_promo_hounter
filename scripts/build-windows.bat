@echo off
setlocal enabledelayedexpansion

echo === Biedronka Promo Hunter — Build Windows ===

cd /d "%~dp0\.."

REM ---------- 1. Python binary (PyInstaller) ----------
echo.
echo [1/4] Budowanie binarki Pythona (PyInstaller)...

where pyinstaller >nul 2>&1
if errorlevel 1 (
    echo   -^> Instaluje PyInstaller...
    pip install pyinstaller
)

if exist build_py rmdir /s /q build_py
if exist dist_py rmdir /s /q dist_py

pyinstaller ^
    --distpath dist_py ^
    --workpath build_py ^
    --noconfirm ^
    --onedir ^
    --name biedrona ^
    --hidden-import=PIL ^
    --hidden-import=PIL.Image ^
    --hidden-import=pytesseract ^
    biedrona.py

if exist python_dist rmdir /s /q python_dist
xcopy dist_py\biedrona python_dist\ /E /I /Q
echo   OK python_dist\ gotowy

REM ---------- 2. Tesseract (only Polish) ----------
echo.
echo [2/4] Kopiowanie Tesseracta (jezyk polski)...

set "TESS_SRC=C:\Program Files\Tesseract-OCR"
if not exist "%TESS_SRC%\tesseract.exe" (
    echo   BLAD: Tesseract nie znaleziony w "%TESS_SRC%"
    echo   Pobierz i zainstaluj: https://github.com/UB-Mannheim/tesseract/wiki
    echo   Upewnij sie, ze zainstalowales jezyk polski.
    exit /b 1
)

if exist tesseract_dist rmdir /s /q tesseract_dist
mkdir tesseract_dist\tessdata

REM Copy tesseract binary and required DLLs
copy "%TESS_SRC%\tesseract.exe" tesseract_dist\ >nul
for %%f in ("%TESS_SRC%\*.dll") do copy "%%f" tesseract_dist\ >nul

REM Copy Polish tessdata (+ eng as fallback)
if exist "%TESS_SRC%\tessdata\pol.traineddata" (
    copy "%TESS_SRC%\tessdata\pol.traineddata" tesseract_dist\tessdata\ >nul
    if exist "%TESS_SRC%\tessdata\osd.traineddata" copy "%TESS_SRC%\tessdata\osd.traineddata" tesseract_dist\tessdata\ >nul
    if exist "%TESS_SRC%\tessdata\eng.traineddata" copy "%TESS_SRC%\tessdata\eng.traineddata" tesseract_dist\tessdata\ >nul
    echo   OK tessdata skopiowane
) else (
    echo   BLAD: pol.traineddata nie znaleziony!
    echo   Uruchom ponownie instalator Tesseracta i zaznacz jezyk polski.
    exit /b 1
)

echo   OK tesseract_dist\ gotowy

REM ---------- 3. npm install ----------
echo.
echo [3/4] Instaluje zaleznosci npm...
call npm install
echo   OK node_modules gotowy

REM ---------- 4. Electron Builder ----------
echo.
echo [4/4] Budowanie aplikacji Electron (Windows)...
call npx electron-builder --win

echo.
echo === BUILD ZAKONCZONY ===
echo Wynik znajdziesz w katalogu: dist\
echo Plik portable (bez instalacji):
dir /b dist\*.exe 2>nul

endlocal
