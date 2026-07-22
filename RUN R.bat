@echo off
:restart
node src/Index.js

if %errorlevel% neq 0 (
    echo Process crashed. Restarting...
    timeout /t 3 >nul
    goto restart
)

echo Process exited normally.
pause