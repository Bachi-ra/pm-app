@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org からインストールしてください。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 初回起動のため必要なパッケージをインストールします...
  call npm install
)

echo.
echo 進行管理アプリを起動します。終了するにはこのウィンドウを閉じてください。
echo.
call npm start

pause
