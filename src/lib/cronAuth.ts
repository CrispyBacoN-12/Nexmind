// Shared guard for /api/cron/* routes. Vercel's own cron sends
// `Authorization: Bearer $CRON_SECRET` automatically; the GitHub Actions
// workflow for the hourly BTC scan sends the same header manually via curl.
export function assertCronAuth(req: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
