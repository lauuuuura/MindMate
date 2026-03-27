import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MindMate",
  description: "AI 倾听应用"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
