'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

type Node = { key: string; type: string; id: string; label: string; degree: number };
type Link = { source: string; target: string; rel: string; weight: number };

const COLORS: Record<string, string> = {
  franchise: '#ff0099',
  topic: '#d4a843',
  person: '#f5f1ea',
  rule: '#2fe39a',
  lesson: '#7fb2ff',
  experiment: '#ffb547',
  platform: '#86858c',
  skill: '#c58bff',
};

const W = 1000;
const H = 620;

/** A small, dependency-free force layout. Runs a fixed number of ticks, then settles. */
export function GraphView({ nodes, links }: { nodes: Node[]; links: Link[] }) {
  const router = useRouter();
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hover, setHover] = useState<string | null>(null);
  const maxDegree = useMemo(() => Math.max(1, ...nodes.map((n) => n.degree)), [nodes]);

  useEffect(() => {
    const pos = new Map(nodes.map((n, i) => [n.key, { x: W / 2 + Math.cos(i * 2.4) * (120 + i * 4), y: H / 2 + Math.sin(i * 2.4) * (90 + i * 3), vx: 0, vy: 0 }]));
    const linkList = links.filter((l) => pos.has(l.source) && pos.has(l.target));
    let tick = 0;
    let frame = 0;
    const step = () => {
      const alpha = Math.max(0.02, 1 - tick / 260);
      const arr = [...pos.values()];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i];
          const b = arr[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          const d2 = Math.max(dx * dx + dy * dy, 64);
          const f = (2600 / d2) * alpha;
          dx *= f / Math.sqrt(d2);
          dy *= f / Math.sqrt(d2);
          a.vx += dx;
          a.vy += dy;
          b.vx -= dx;
          b.vy -= dy;
        }
      }
      for (const l of linkList) {
        const a = pos.get(l.source)!;
        const b = pos.get(l.target)!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 110) / d) * 0.02 * alpha * Math.min(3, 1 + Math.log(1 + l.weight));
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
      for (const p of arr) {
        p.vx += (W / 2 - p.x) * 0.004 * alpha;
        p.vy += (H / 2 - p.y) * 0.004 * alpha;
        p.x = Math.min(W - 30, Math.max(30, p.x + p.vx));
        p.y = Math.min(H - 20, Math.max(20, p.y + p.vy));
        p.vx *= 0.6;
        p.vy *= 0.6;
      }
      tick++;
      if (tick % 6 === 0 || tick > 260) setPositions(new Map([...pos.entries()].map(([k, v]) => [k, { x: v.x, y: v.y }])));
      if (tick <= 260) frame = requestAnimationFrame(step);
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      while (tick <= 260) step();
    } else {
      frame = requestAnimationFrame(step);
    }
    return () => cancelAnimationFrame(frame);
  }, [nodes, links]);

  const connected = useMemo(() => {
    if (!hover) return null;
    const set = new Set([hover]);
    for (const l of links) {
      if (l.source === hover) set.add(l.target);
      if (l.target === hover) set.add(l.source);
    }
    return set;
  }, [hover, links]);

  if (!nodes.length) return <div className="empty">No connected nodes yet.</div>;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', background: 'radial-gradient(circle at 50% 40%, #121218, #060608)' }} role="img" aria-label="Knowledge graph map">
        {links.map((l, i) => {
          const a = positions.get(l.source);
          const b = positions.get(l.target);
          if (!a || !b) return null;
          const lit = connected ? connected.has(l.source) && connected.has(l.target) : false;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lit ? '#ff0099' : '#2e2e37'} strokeOpacity={connected && !lit ? 0.15 : 0.7} strokeWidth={Math.min(3, 0.6 + Math.log(1 + l.weight) * 0.5)} />;
        })}
        {nodes.map((n) => {
          const p = positions.get(n.key);
          if (!p) return null;
          const r = 4 + (n.degree / maxDegree) * 16;
          const dim = connected && !connected.has(n.key);
          return (
            <g
              key={n.key}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: 'pointer', opacity: dim ? 0.25 : 1, transition: 'opacity 160ms' }}
              onMouseEnter={() => setHover(n.key)}
              onMouseLeave={() => setHover(null)}
              onClick={() => router.push(n.type === 'lesson' ? `/lessons/${n.id}` : n.type === 'rule' ? `/rules/${n.id}` : n.type === 'experiment' ? `/experiments/${n.id}` : n.type === 'person' ? `/people/${n.id}` : `/graph?type=${n.type}&id=${n.id}`)}
            >
              <circle r={r} fill={COLORS[n.type] ?? '#888'} fillOpacity={0.9} stroke="#060608" strokeWidth="1.5" />
              {r > 8 || hover === n.key ? (
                <text y={-r - 4} textAnchor="middle" fontSize="11" fill="#f5f1ea" fontFamily="var(--font-mono)" style={{ pointerEvents: 'none' }}>
                  {n.label.length > 26 ? `${n.label.slice(0, 24)}…` : n.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="row-tight xs" style={{ padding: '.6rem .9rem' }}>
        {Object.entries(COLORS).map(([t, c]) => (
          <span key={t} className="row-tight">
            <span style={{ width: 9, height: 9, borderRadius: 9, background: c, display: 'inline-block' }} /> {t}
          </span>
        ))}
      </div>
    </div>
  );
}
