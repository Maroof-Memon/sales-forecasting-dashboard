@echo off
echo ========================================================
echo   Sales Forecasting and Business Dashboard (Flask)
echo ========================================================
echo.
echo 1. Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo Please install Python 3.9+ from https://python.org and check "Add Python to PATH".
    pause
    exit /b
)

echo 2. Installing dependencies from requirements.txt...
pip install -r requirements.txt

echo 3. Launching Flask server...
echo.
echo Open your browser at: http://127.0.0.1:5000
echo.
python app.py
pause
