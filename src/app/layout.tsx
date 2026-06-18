import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { Providers } from "@/components/providers";
import { prisma } from "@/lib/db";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NEXMIND — AI Trading Guild",
  description: "Multi-agent trading war room: Scanner → HAWK×3 → SAGE → Iron Rules.",
};

async function getOnlineCount(): Promise<number> {
  try {
    return await prisma.agent.count({ where: { status: { in: ["online", "working"] } } });
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const online = await getOnlineCount();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar online={online} />
            <main className="flex-1 min-w-0 px-6 py-8 lg:px-10">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
