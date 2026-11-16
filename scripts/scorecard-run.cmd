@echo off
REM Wrapper for Task Scheduler: scorecard LOCAL FALLBACK capture (scan + chart agent, no AI) from the project root.
REM The GitHub Actions workflow is the primary capture; a session claim stops both from logging one session.
REM Setups are logged as pending; scorecard-score.mts has the AI review them later.
REM The task fires several times a day, and only the firings inside the 10:30-11:30 ET window do anything.
REM The script does nothing outside the window, on a weekend, or once the day already has a ran / no_session row.
REM --env-file loads .env (Alpaca/Finnhub keys, DISCORD_WEBHOOK_URL); a bare tsx process sees none of them.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\scorecard-run.mts >> scripts\scorecard-run.log 2>&1
