// Best-effort Discord notifications for trade fills/closes, drawdown breaches,
// and cron-level failures. Reads DISCORD_WEBHOOK_URL — when unset (local dev,
// tests) this silently no-ops so nothing in the trading pipeline ever depends
// on notifications succeeding.

export type NotifyLevel = "info" | "warning" | "critical";

const LEVEL_COLOR: Record<NotifyLevel, number> = {
  info: 0x2b7de9, // blue
  warning: 0xf5a623, // amber
  critical: 0xe0245e, // red
};

const LEVEL_PREFIX: Record<NotifyLevel, string> = {
  info: "",
  warning: "⚠️ ",
  critical: "🚨 ",
};

/**
 * Posts a message to the configured Discord webhook. Never throws — a
 * notification failure must never break a scan/manage/research cycle, so
 * errors are swallowed after a console.error.
 */
export async function sendDiscordNotification(message: string, level: NotifyLevel = "info"): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) {
    console.log(`[notify:${level}] (DISCORD_WEBHOOK_URL not set) ${message}`);
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        embeds: [{ description: `${LEVEL_PREFIX[level]}${message}`, color: LEVEL_COLOR[level] }],
      }),
    });
    if (!res.ok) {
      console.error(`[notify] Discord webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (e) {
    console.error(`[notify] Discord webhook failed: ${String(e)}`);
  }
}
