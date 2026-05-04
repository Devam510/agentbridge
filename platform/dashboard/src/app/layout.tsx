import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "AgentBridge — Connect Any Website to Your AI Agent",
  description:
    "Bridge any website to Claude, Cursor, or any AI agent in 30 seconds. No code, no API keys, no terminal required.",
  keywords: "AI agent, MCP server, Claude Desktop, browser automation, AgentBridge",
  openGraph: {
    title: "AgentBridge",
    description: "Connect any website to your AI agent in 30 seconds.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col bg-[#080B14] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
