import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KomiDrop — manga bez šedé zóny",
  description: "Lokální knihovna pro legální a otevřenou mangu s exportem do CBZ.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="cs" data-theme="ink">
      <body>{children}</body>
    </html>
  );
}
