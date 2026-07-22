@echo off 
nodemon src/Index.js 
pause



@REM @echo off
@REM :loop
@REM echo Starting server...
@REM nodemon src/Index.js

@REM echo.
@REM echo Server crashed or stopped.
@REM timeout /t 2 >nul
@REM goto loop