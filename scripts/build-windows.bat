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
    --collect-all=rapidocr_onnxruntime ^
    biedrona.py

if exist python_dist rmdir /s /q python_dist
xcopy dist_py\biedrona python_dist\ /E /I /Q
echo   OK python_dist\ gotowy

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
