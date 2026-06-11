// Typed access to the Setting key-value table. Defaults apply when a key is absent,
// so the app behaves identically before any setting has ever been written.

import { prisma } from "@/lib/db";

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function isKillSwitchOn(): Promise<boolean> {
  return (await getSetting("killSwitch", "false")) === "true";
}

export async function getMaxOpenPositions(): Promise<number> {
  const n = parseInt(await getSetting("maxOpenPositions", "5"), 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export interface FearGreed { value: number; label: string; fetchedAt: string }

export async function getFearGreed(): Promise<FearGreed | null> {
  try {
    return JSON.parse(await getSetting("fearGreed", "null")) as FearGreed | null;
  } catch {
    return null;
  }
}
