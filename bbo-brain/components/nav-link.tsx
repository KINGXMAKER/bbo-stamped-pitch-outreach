'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLink({ href, count, children }: { href: string; count?: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className="nav-link" aria-current={active ? 'page' : undefined}>
      <span>{children}</span>
      {count ? <span className="nav-count">{count}</span> : null}
    </Link>
  );
}
