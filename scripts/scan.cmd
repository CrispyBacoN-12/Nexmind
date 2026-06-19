@echo off
REM Wrapper for Task Scheduler: run the scan from the project root and log output.
REM Usage: scan.cmd [portfolioId ...]
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
npx tsx scripts\scan.mts %* >> scripts\scan.log 2>&1
