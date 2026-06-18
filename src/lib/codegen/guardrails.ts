// Guardrails for letting an AI agent write into the project. Pure + testable.
// Philosophy: deny by default. Only specific dirs/extensions are writable, and
// safety-critical files can never be touched by the agent.

import path from "path";

export const ALLOWED_ROOTS = ["src/app", "src/components"];
export const ALLOWED_EXTENSIONS = [".tsx", ".ts", ".css"];

// Files the agent must never create/overwrite — core wiring + the pure-code
// trading safety layer. (Compared case-insensitively, normalized to forward slashes.)
export const PROTECTED = [
  "src/app/layout.tsx",
  "src/app/globals.css",
  "src/lib/db.ts",
  "src/lib/anthropic.ts",
  "src/lib/trading/ironrules.ts",
  "next.config.ts",
  "package.json",
  "prisma/schema.prisma",
];

export interface GuardResult {
  ok: boolean;
  reason?: string;
  /** Normalized relative path (forward slashes) when ok. */
  relPath?: string;
}

/** Normalize a candidate path to a project-relative POSIX path, or null if it escapes. */
function normalizeRel(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  if (path.isAbsolute(input)) return null;
  // Reject Windows drive-letter / UNC just in case.
  if (/^[a-zA-Z]:/.test(input) || input.startsWith("\\\\")) return null;

  const posix = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const norm = path.posix.normalize(posix);
  if (norm.startsWith("..") || norm.includes("/../") || norm === "..") return null;
  return norm.replace(/^\/+/, "");
}

/**
 * Validate that `relPath` may be written by the agent. Returns the normalized
 * relative path on success, or a human-readable reason on failure.
 */
export function validateTarget(relPath: string): GuardResult {
  const norm = normalizeRel(relPath);
  if (!norm) return { ok: false, reason: `unsafe or absolute path: ${relPath}` };

  const lower = norm.toLowerCase();

  if (PROTECTED.includes(lower)) return { ok: false, reason: `protected file may not be modified: ${norm}` };

  const ext = path.posix.extname(norm).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { ok: false, reason: `extension ${ext || "(none)"} not allowed (allowed: ${ALLOWED_EXTENSIONS.join(", ")})` };
  }

  const inRoot = ALLOWED_ROOTS.some((r) => norm === r || norm.startsWith(r + "/"));
  if (!inRoot) return { ok: false, reason: `path must live under: ${ALLOWED_ROOTS.join(", ")}` };

  return { ok: true, relPath: norm };
}

/** Resolve a validated relative path to an absolute path under `projectRoot`, re-checking containment. */
export function resolveWithinProject(projectRoot: string, relPath: string): GuardResult & { absPath?: string } {
  const v = validateTarget(relPath);
  if (!v.ok || !v.relPath) return v;
  const abs = path.resolve(projectRoot, v.relPath);
  const rootResolved = path.resolve(projectRoot);
  // Final containment check (defense in depth against symlink/normalization tricks).
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    return { ok: false, reason: `resolved path escapes project: ${relPath}` };
  }
  return { ok: true, relPath: v.relPath, absPath: abs };
}
