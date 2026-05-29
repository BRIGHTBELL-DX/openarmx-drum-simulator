@echo off
cd /d "%~dp0"
echo.
echo  OpenArmX 드럼 로봇 시뮬레이터
echo  http://localhost:8083/drum_simulator/
echo  종료: Ctrl+C
echo.
python serve.py
pause
