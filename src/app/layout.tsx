import type { Metadata } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/manrope";
import "@fontsource-variable/cormorant-garamond";
import "./globals.css";
import "./royalzen.css";
import { LanguageProvider } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "RoyalZen AI Curtain Advisor",
  description: "RoyalZen AI 窗帘智能顾问",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce-based CSP requires request-time rendering so Next.js can attach the
  // middleware nonce to every framework script.
  await headers();
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
