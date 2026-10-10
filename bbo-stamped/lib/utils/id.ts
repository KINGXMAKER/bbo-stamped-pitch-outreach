/** Short, collision-safe id. Works in both the browser and the route handlers. */
export function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

/** Makes ids unique within one collection without disturbing ones already fine. */
export function ensureUniqueIds<T extends { id: string }>(items: T[], prefix: string): T[] {
  const seen = new Set<string>();
  return items.map((item, index) => {
    const base = item.id?.trim() || `${prefix}-${index + 1}`;
    if (!seen.has(base)) {
      seen.add(base);
      return { ...item, id: base };
    }
    let suffix = 2;
    let candidate = `${base}-${suffix}`;
    while (seen.has(candidate)) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    seen.add(candidate);
    return { ...item, id: candidate };
  });
}
