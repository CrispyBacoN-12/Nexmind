// /portfolio holds the owner's real holdings and is local-only: the deployed
// site is public. Vercel sets VERCEL at build and run time, so every server
// entry point checks this before touching the holdings file.

export function isDeployed(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.VERCEL);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostname(hostHeader: string): string {
  return hostHeader.startsWith("[") ? hostHeader.slice(0, hostHeader.indexOf("]") + 1) : hostHeader.split(":")[0];
}

/**
 * `next dev` listens on every interface, so another device on the Wi-Fi (or a
 * DNS-rebinding page) could reach the holdings API. Only requests addressed to
 * localhost are served, and a request that carries an Origin must come from a
 * localhost origin (blocks a cross-site POST from any open tab).
 */
export function isLocalRequest(headers: Headers): boolean {
  const host = headers.get("host");
  if (!host || !LOCAL_HOSTS.has(hostname(host).toLowerCase())) return false;
  const origin = headers.get("origin");
  if (origin == null) return true;
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase().replace(/^::1$/, "[::1]"));
  } catch {
    return false;
  }
}
