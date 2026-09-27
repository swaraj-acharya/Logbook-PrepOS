import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Logbook PrepOS', description: 'A personal preparation system for any exam: roadmap, day-by-day plan, lectures, active recall, spaced review and practice, saved to a file on your computer.', manifest: '/manifest.webmanifest' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Barlow+Condensed:wght@500;600;700&display=swap" rel="stylesheet" />
      </head>
      {/* Browser extensions (for example ColorZilla's cz-shortcut-listen, Grammarly's data-gr-*) add attributes to
          <body> before React hydrates. This only ignores attribute differences on <body> itself, one level deep;
          mismatches anywhere inside the app are still reported. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
