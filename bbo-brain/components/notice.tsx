export function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const error = typeof searchParams.error === 'string' ? searchParams.error : null;
  const notice = typeof searchParams.notice === 'string' ? searchParams.notice : null;
  if (!error && !notice) return null;
  return (
    <div className={`callout ${error ? 'callout-red' : 'callout-pink'} rise`} role={error ? 'alert' : 'status'} style={{ marginBottom: '1.4rem' }}>
      {error ?? notice}
    </div>
  );
}
