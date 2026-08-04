import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Manga Reader — lokální čtečka mangy",
  description: "Lokální vyhledávač, knihovna, čtečka kapitol a export mangy do CBZ, EPUB nebo PDF.",
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
