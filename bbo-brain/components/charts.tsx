/**
 * Small server-rendered SVG charts. No chart library: each chart answers one
 * question and always shows the 1.0x baseline it is relative to.
 */

export function ScoreHistogram({ scores, height = 120 }: { scores: number[]; height?: number }) {
  const edges = [0, 0.5, 0.67, 0.85, 1, 1.15, 1.5, 2, Infinity];
  const names = ['<0.5', '0.5', '0.67', '0.85', '1.0', '1.15', '1.5', '2+'];
  const tones = ['var(--red)', 'var(--red)', 'var(--amber)', 'var(--muted-deep)', 'var(--muted-deep)', 'var(--green)', 'var(--green)', 'var(--pink)'];
  const counts = edges.slice(0, -1).map((lo, i) => scores.filter((s) => s >= lo && s < edges[i + 1]).length);
  const max = Math.max(1, ...counts);
  const w = 480;
  const bw = w / counts.length;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${height + 26}`} role="img" aria-label="Distribution of performance scores">
        {counts.map((c, i) => {
          const h = (c / max) * height;
          return (
            <g key={i}>
              <rect x={i * bw + 4} y={height - h} width={bw - 8} height={Math.max(h, 1)} rx="3" fill={tones[i]} opacity={0.85} />
              <text x={i * bw + bw / 2} y={height - h - 5} textAnchor="middle" fontSize="11" fill="var(--text)" fontFamily="var(--font-mono)">
                {c || ''}
              </text>
              <text x={i * bw + bw / 2} y={height + 17} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
                {names[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function TrendLine({ points, height = 140, baseline = 1, format = (v: number) => v.toFixed(2) }: { points: Array<{ label: string; value: number | null; n: number }>; height?: number; baseline?: number | null; format?: (v: number) => string }) {
  const valid = points.filter((p): p is { label: string; value: number; n: number } => typeof p.value === 'number');
  if (valid.length < 2) return <div className="small muted">Not enough periods to draw a trend.</div>;
  const w = 560;
  const pad = 28;
  const values = valid.map((p) => p.value);
  const lo = Math.min(...values, baseline ?? Infinity) * 0.92;
  const hi = Math.max(...values, baseline ?? -Infinity) * 1.08;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => height - ((v - lo) / (hi - lo || 1)) * (height - 20) - 10;
  const path = points
    .map((p, i) => (typeof p.value === 'number' ? `${i === 0 || typeof points[i - 1]?.value !== 'number' ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}` : ''))
    .join(' ');
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${height + 22}`} role="img" aria-label="Trend">
        {baseline !== null ? (
          <g>
            <line x1={pad} x2={w - pad} y1={y(baseline)} y2={y(baseline)} stroke="var(--muted-deep)" strokeDasharray="3 4" />
            <text x={w - pad} y={y(baseline) - 5} textAnchor="end" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
              baseline {format(baseline)}
            </text>
          </g>
        ) : null}
        <path d={path} fill="none" stroke="var(--pink)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) =>
          typeof p.value === 'number' ? (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.value)} r={Math.min(6, 2 + Math.sqrt(p.n))} fill="var(--black)" stroke="var(--pink)" strokeWidth="1.5">
                <title>{`${p.label}: ${format(p.value)} (n=${p.n})`}</title>
              </circle>
            </g>
          ) : null
        )}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 8) === 0 || i === points.length - 1 ? (
            <text key={`l${i}`} x={x(i)} y={height + 16} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
              {p.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

export function MetricCurve({ series, height = 70 }: { series: Array<{ at: string; value: number }>; height?: number }) {
  if (series.length < 2) return <div className="xs muted">{series.length === 1 ? 'One snapshot so far — the curve builds with every sync.' : 'No snapshots.'}</div>;
  const w = 300;
  const t0 = new Date(series[0].at).getTime();
  const t1 = new Date(series[series.length - 1].at).getTime();
  const max = Math.max(...series.map((s) => s.value));
  const x = (at: string) => 4 + ((new Date(at).getTime() - t0) / (t1 - t0 || 1)) * (w - 8);
  const y = (v: number) => height - 4 - (v / (max || 1)) * (height - 10);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${height}`} role="img" aria-label="Metric over time">
        <path d={series.map((s, i) => `${i ? 'L' : 'M'}${x(s.at).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ')} fill="none" stroke="var(--gold)" strokeWidth="1.8" />
        {series.map((s, i) => (
          <circle key={i} cx={x(s.at)} cy={y(s.value)} r="2.5" fill="var(--gold)">
            <title>{`${new Date(s.at).toLocaleDateString()}: ${Math.round(s.value).toLocaleString()}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
