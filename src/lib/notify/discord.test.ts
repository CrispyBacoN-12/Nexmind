import { test } from "node:test";
import assert from "node:assert/strict";
import { sendDiscordNotification } from "./discord";

test("sendDiscordNotification: no-ops without throwing when DISCORD_WEBHOOK_URL is unset", async () => {
  const prev = process.env.DISCORD_WEBHOOK_URL;
  delete process.env.DISCORD_WEBHOOK_URL;
  try {
    await assert.doesNotReject(sendDiscordNotification("test message", "info"));
  } finally {
    if (prev != null) process.env.DISCORD_WEBHOOK_URL = prev;
  }
});

test("sendDiscordNotification: posts an embed with the level's prefix/color to the webhook URL", async () => {
  const prevUrl = process.env.DISCORD_WEBHOOK_URL;
  const prevFetch = globalThis.fetch;
  process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook/test";

  let calledUrl: string | undefined;
  let calledBody: string | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calledUrl = url;
    calledBody = init?.body as string;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await sendDiscordNotification("trade opened", "warning");
    assert.equal(calledUrl, "https://discord.example/webhook/test");
    const payload = JSON.parse(calledBody!);
    assert.equal(payload.embeds[0].description, "⚠️ trade opened");
    assert.equal(payload.embeds[0].color, 0xf5a623);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl != null) process.env.DISCORD_WEBHOOK_URL = prevUrl;
    else delete process.env.DISCORD_WEBHOOK_URL;
  }
});

test("sendDiscordNotification: swallows fetch errors instead of throwing", async () => {
  const prevUrl = process.env.DISCORD_WEBHOOK_URL;
  const prevFetch = globalThis.fetch;
  process.env.DISCORD_WEBHOOK_URL = "https://discord.example/webhook/test";
  globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;

  try {
    await assert.doesNotReject(sendDiscordNotification("critical failure", "critical"));
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl != null) process.env.DISCORD_WEBHOOK_URL = prevUrl;
    else delete process.env.DISCORD_WEBHOOK_URL;
  }
});
