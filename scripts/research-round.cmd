@echo off
REM Wrapper for Task Scheduler: run one AI research round from the project root and log output.
REM Usage: research-round.cmd [symbol] [interval] [range]
REM --env-file loads .env (ANTHROPIC_API_KEY etc.); a standalone tsx process won't otherwise.
cd /d "C:\Users\Kannithi\CLAUDE WEB\nexmind"
node --env-file=.env --import tsx scripts\research-round.mts %* >> scripts\research-round.log 2>&1
