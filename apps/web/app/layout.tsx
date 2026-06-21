import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cross Sight · RToken Basis Sentry",
  description: "Bitget RToken spot/perp basis and funding monitor"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

