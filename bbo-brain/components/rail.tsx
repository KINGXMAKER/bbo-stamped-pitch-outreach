import Link from 'next/link';
import { NavLink } from './nav-link';

type Counts = {
  proposals: number;
  challenges: number;
  entities: number;
  gatekeeper: number;
  unreviewed: number;
  content: number;
  lastSync: { finished_at: string | null; kind: string } | null;
};

const GROUPS = (c: Counts) => [
  {
    label: 'Decide',
    links: [
      { href: '/', label: 'Command Center' },
      { href: '/next', label: 'Make Next' },
      { href: '/ask', label: 'Ask BBO' },
      { href: '/reviews', label: 'Weekly Review' },
    ],
  },
  {
    label: 'Know',
    links: [
      { href: '/content', label: 'Content Library' },
      { href: '/intelligence', label: 'Content Intelligence' },
      { href: '/performance', label: 'Performance' },
      { href: '/people', label: 'People / Guests' },
      { href: '/topics', label: 'Topics' },
      { href: '/graph', label: 'Knowledge Graph' },
      { href: '/coverage', label: 'Data Coverage' },
    ],
  },
  {
    label: 'Learn',
    links: [
      { href: '/lessons', label: 'Lessons' },
      { href: '/rules', label: 'BBO Rules', count: c.challenges },
      { href: '/proposals', label: 'Rule Proposals', count: c.proposals },
      { href: '/experiments', label: 'Experiments' },
      { href: '/edit-lab', label: 'Edit Lab', count: c.gatekeeper },
      { href: '/validation', label: 'Coding Validation', count: c.unreviewed },
    ],
  },
  {
    label: 'System',
    links: [
      { href: '/runs', label: 'AI Agent Runs' },
      { href: '/settings', label: 'Settings', count: c.entities },
    ],
  },
];

export function Rail({ counts }: { counts: Counts }) {
  return (
    <aside className="rail" aria-label="BBO BRAIN">
      <Link href="/" className="wordmark" aria-label="BBO BRAIN home">
        <div className="wordmark-top">
          BBO <span>BRAIN</span>
        </div>
        <div className="wordmark-sub">Smarter every time BBO posts.</div>
      </Link>

      <form action="/search" className="rail-search" role="search">
        <label className="sr-only" htmlFor="rail-q" style={{ position: 'absolute', left: -9999 }}>
          Search
        </label>
        <input id="rail-q" name="q" placeholder="Search content, people, lessons…" autoComplete="off" />
      </form>

      <nav className="rail-nav" aria-label="Sections">
        {GROUPS(counts).map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.links.map((link) => (
              <NavLink key={link.href} href={link.href} count={'count' in link ? link.count : undefined}>
                {link.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="rail-foot">
        <div>{counts.content.toLocaleString()} posts in memory</div>
        <div>
          {counts.lastSync?.finished_at ? `last sync ${new Date(counts.lastSync.finished_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'never synced'}
        </div>
      </div>
    </aside>
  );
}
