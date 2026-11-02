@echo off
REM Wrapper for Task Scheduler: scorecard daily run (scan + chart agent, logs setups) from the project root.
REM The task fires twice a day, and only one of those firings lands in the 10:30-11:30 ET window in any season
REM (the other is a no-op), so in EDT a failed 10:30 run has no in-window retry. The script does nothing
REM outside the window, on a weekend, or once the day already has a ran / no_session row.
REM --env-file loads .env (Alpaca/Finnhub keys, DISCORD_WEBHOOK_URL); a bare tsx process sees none of them.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\scorecard-run.mts >> scripts\scorecard-run.log 2>&1
