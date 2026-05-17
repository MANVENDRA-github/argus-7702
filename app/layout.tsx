import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Argus",
  description: "Security-first EIP-7702 smart wallet (testnet).",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
