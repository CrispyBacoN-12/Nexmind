// Compile-check the project after an apply. If TypeScript fails, the caller
// rolls the change back so a bad generation can't break the running app.

import { exec } from "child_process";
import { promisify } from "util";

const pexec = promisify(exec);

export interface VerifyResult {
  ok: boolean;
  output: string;
}

/**
 * Run `tsc --noEmit` over the project. Returns ok=false with the compiler
 * output when there are type/syntax errors. The project is expected to be
 * clean, so any failure after an apply implicates the just-written files.
 */
export async function typecheck(projectRoot: string): Promise<VerifyResult> {
  try {
    await pexec("npx --no-install tsc --noEmit", {
      cwd: projectRoot,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    });
    return { ok: true, output: "" };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
    if (err.killed) return { ok: false, output: "type check timed out" };
    const output = `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message || "type check failed";
    return { ok: false, output };
  }
}

/** Keep only the lines that mention one of the written paths (for a focused error message). */
export function focusErrors(output: string, paths: string[]): string {
  if (!output) return "";
  const norm = paths.map((p) => p.replace(/\\/g, "/"));
  const lines = output.split(/\r?\n/);
  const relevant = lines.filter((l) => norm.some((p) => l.replace(/\\/g, "/").includes(p)));
  return (relevant.length ? relevant : lines.slice(0, 20)).join("\n").slice(0, 4000);
}
