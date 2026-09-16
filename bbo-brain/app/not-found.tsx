import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="empty" style={{ marginTop: '4rem' }}>
      <div className="empty-title">Not in memory</div>
      <p className="small">That record doesn&apos;t exist in BBO BRAIN.</p>
      <p style={{ marginTop: '1rem' }}>
        <Link href="/" className="btn">
          Back to Command Center
        </Link>
      </p>
    </div>
  );
}
