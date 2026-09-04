// `npm run dev` — the web app AND one desk session, in one command.
//
// Everything here is local: the desk only trades while this machine is on, and
// the machine is on when the owner is working on it. So the moment the dev
// server comes up is exactly the moment the desk should catch up on what it
// missed — no Task Scheduler entry can do better than that.
//
// The session runs BESIDE the dev server, not before it: it takes minutes
// (HAWK/SAGE across the universe) and the web app must not wait on it. Its
// output goes to scripts/session.log rather than the terminal, so Next's
// compile output stays readable — `npm run desk` is there when you want to
// watch a session live.
//
//   npm run dev                 # web + desk session (skipped if one ran recently)
//   npm run dev -- --no-scan    # web only, for pure UI work
//   DESK_SCAN=0 npm run dev     # same, via env
//
// A dev server gets restarted a dozen times an hour; --if-stale keeps that from
// re-spending analyst calls on a bar that has not moved.
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const STALE_MINUTES = 30;
const PORT = "3275";

const args = process.argv.slice(2);
const passthrough = args.filter((a) => a !== "--no-scan");
const scan = !args.includes("--no-scan") && process.env.DESK_SCAN !== "0";

if (scan) {
  const logFile = createWriteStream("scripts/session.log", { flags: "a" });
  const session = spawn(
    process.execPath,
    ["--env-file=.env", "--import", "tsx", "scripts/session.mts", `--if-stale=${STALE_MINUTES}`],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  session.stdout.pipe(logFile);
  session.stderr.pipe(logFile);
  session.on("error", (e) => console.log(`[desk] could not start session: ${e.message}`));
  session.on("exit", (code) => console.log(`[desk] session finished (exit ${code}) — see scripts/session.log`));
  console.log(`[desk] session running in the background -> scripts/session.log`);
} else {
  console.log("[desk] session skipped (--no-scan)");
}

// next dev in the foreground: its exit code is the command's exit code, and
// Ctrl-C reaches it because it shares this terminal.
const next = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", PORT, ...passthrough],
  { stdio: "inherit" },
);
next.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 0); });
