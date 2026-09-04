@echo off
REM One desk session on demand — intel, exits, scan, ledger, and research if due.
REM Usage: desk.cmd [portfolioId ...] [--no-research|--research]
REM --env-file loads .env (Alpaca/Finnhub keys etc.); a standalone tsx process won't otherwise.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\session.mts %* >> scripts\session.log 2>&1
