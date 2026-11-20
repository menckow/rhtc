import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RHTC II – Schiedsrichterverwaltung",
  description:
    "Interne Verwaltung der Schiedsrichter-Ansetzungen, Weitergaben, Kasse und Dokumentation der 2. Herrenmannschaft",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <head>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
