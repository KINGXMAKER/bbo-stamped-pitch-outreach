import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, DM_Mono, DM_Sans, Instrument_Serif } from 'next/font/google';
import './globals.css';

const bebas = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-bebas',
});

const instrument = Instrument_Serif({
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-sans',
});

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-dm-mono',
});

export const metadata: Metadata = {
  title: 'BBO Stamped — Reel Production OS',
  description:
    'Scout a location from photos, design the Reels, build one deduplicated shot list, and leave with every frame you need.',
};

export const viewport: Viewport = {
  themeColor: '#080808',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The font variables live on <html> because the design tokens in
    // globals.css reference them from :root — defining them lower down would
    // make every --font-* token resolve to nothing.
    <html
      lang="en"
      className={`${bebas.variable} ${instrument.variable} ${dmSans.variable} ${dmMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
