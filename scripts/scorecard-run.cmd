@echo off
REM Wrapper for Task Scheduler: scorecard daily run (scan + chart agent, logs setups) from the project root.
REM Fires several times in the 10:30-11:30 ET window; the script does nothing outside it or once the day is done.
REM --env-file loads .env (Alpaca/Finnhub keys, DISCORD_WEBHOOK_URL); a bare tsx process sees none of them.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\scorecard-run.mts >> scripts\scorecard-run.log 2>&1
