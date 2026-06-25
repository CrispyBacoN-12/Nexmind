@echo off
REM Wrapper for Task Scheduler: manage open positions (no AI) from the project root.
REM Usage: manage.cmd [portfolioId ...]
REM --env-file loads .env (Alpaca keys etc.); a standalone tsx process won't otherwise.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\manage.mts %* >> scripts\scan.log 2>&1
