@echo off
REM Wrapper for Task Scheduler: run the scan from the project root and log output.
REM Usage: scan.cmd [portfolioId ...]
REM --env-file loads .env (Alpaca keys etc.); a standalone tsx process won't otherwise.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\scan.mts %* >> scripts\scan.log 2>&1
