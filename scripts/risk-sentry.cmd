@echo off
REM Wrapper for Task Scheduler: daily Risk Sentry check (read-only, no AI) from the project root.
REM --env-file loads .env (Alpaca/Finnhub keys, DISCORD_WEBHOOK_URL); a bare tsx process sees none of them.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\risk-sentry.mts >> scripts\risk-sentry.log 2>&1
