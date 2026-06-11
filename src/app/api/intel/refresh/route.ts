import { NextResponse } from "next/server";
import { refreshFinnhubNews, refreshFearGreed } from "@/lib/intel/news";

export async function POST() {
  const [news, fearGreed] = await Promise.all([refreshFinnhubNews(), refreshFearGreed()]);
  return NextResponse.json({ news, fearGreed });
}
