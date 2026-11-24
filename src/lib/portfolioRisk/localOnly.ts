// /portfolio holds the owner's real holdings and is local-only: the deployed
// site is public. Vercel sets VERCEL at build and run time, so every server
// entry point checks this before touching the holdings file.

export function isDeployed(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL);
}
