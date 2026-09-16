import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { Rail } from '@/components/rail';
import { get, getDb } from '@/lib/db/client';
import { seedReference } from '@/lib/seed';
import './globals.css';

// Self-hosted (OFL) so the product never depends on reaching Google Fonts at build time.
const bebas = localFont({ src: './fonts/bebas-neue-400-latin.woff2', weight: '400', display: 'swap', variable: '--font-bebas' });
const instrument = localFont({
  src: [
    { path: './fonts/instrument-serif-400-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/instrument-serif-italic-latin.woff2', weight: '400', style: 'italic' },
  ],
  display: 'swap',
  variable: '--font-instrument',
});
const dmSans = localFont({ src: './fonts/dm-sans-variable-latin.woff2', weight: '100 1000', display: 'swap', variable: '--font-dm-sans' });
const dmMono = localFont({
  src: [
    { path: './fonts/dm-mono-400-latin.woff2', weight: '400' },
    { path: './fonts/dm-mono-500-latin.woff2', weight: '500' },
  ],
  display: 'swap',
  variable: '--font-dm-mono',
});

export const metadata: Metadata = {
  title: { default: 'BBO BRAIN', template: '%s · BBO BRAIN' },
  description: 'What has BBO learned from everything BBO has posted — and what should BBO make next?',
};

export const viewport: Viewport = { themeColor: '#060608', width: 'device-width', initialScale: 1 };

export const dynamic = 'force-dynamic';

function railCounts() {
  const db = getDb();
  seedReference(db);
  const n = (sql: string) => get<{ n: number }>(db, sql)?.n ?? 0;
  return {
    proposals: n(`SELECT COUNT(*) AS n FROM rule_proposals WHERE status = 'pending'`),
    challenges: n(`SELECT COUNT(*) AS n FROM rule_challenges WHERE status = 'open'`),
    entities: n(`SELECT COUNT(*) AS n FROM entity_resolution_candidates WHERE status = 'pending'`),
    gatekeeper: n(`SELECT COUNT(*) AS n FROM edit_sessions WHERE status = 'needs_human'`),
    unreviewed: n(`SELECT COUNT(*) AS n FROM content WHERE coded_at IS NOT NULL AND coding_validation_status = 'UNREVIEWED'`),
    lastSync: get<{ finished_at: string | null; kind: string }>(db, `SELECT finished_at, kind FROM sync_jobs WHERE status IN ('succeeded','partial') ORDER BY finished_at DESC LIMIT 1`) ?? null,
    content: n('SELECT COUNT(*) AS n FROM content WHERE is_demo = 0'),
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const counts = railCounts();
  return (
    <html lang="en" className={`${bebas.variable} ${instrument.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        <div className="shell">
          <Rail counts={counts} />
          <main className="main" id="main">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
