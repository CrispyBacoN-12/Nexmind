@echo off
REM Wrapper for Task Scheduler: scorecard nightly scorer (scores logged setups, live snapshot, morning Discord) from the project root.
REM Runs at 07:00 ICT Tue-Sat, after the US close. Read-only toward the market; it never places an order.
REM --env-file loads .env (Alpaca keys, DATABASE_URL, DISCORD_WEBHOOK_URL); a bare tsx process sees none of them.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\scorecard-score.mts >> scripts\scorecard-score.log 2>&1
