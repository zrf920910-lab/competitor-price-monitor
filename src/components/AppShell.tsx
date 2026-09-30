'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const Icon = ({ d, filled }: { d: string; filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    className="h-[22px] w-[22px]"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth={filled ? 0 : 1.9}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const NAV: NavItem[] = [
  {
    href: '/',
    label: '看板',
    icon: <Icon d="M4 5.5A1.5 1.5 0 015.5 4h4A1.5 1.5 0 0111 5.5v4A1.5 1.5 0 019.5 11h-4A1.5 1.5 0 014 9.5v-4zM13 5.5A1.5 1.5 0 0114.5 4h4A1.5 1.5 0 0120 5.5v4A1.5 1.5 0 0118.5 11h-4A1.5 1.5 0 0113 9.5v-4zM4 14.5A1.5 1.5 0 015.5 13h4A1.5 1.5 0 0111 14.5v4A1.5 1.5 0 019.5 20h-4A1.5 1.5 0 014 18.5v-4zM13 14.5A1.5 1.5 0 0114.5 13h4a1.5 1.5 0 011.5 1.5v4a1.5 1.5 0 01-1.5 1.5h-4a1.5 1.5 0 01-1.5-1.5v-4z" />,
  },
  {
    href: '/products',
    label: '商品',
    icon: <Icon d="M3.5 8.5L12 4l8.5 4.5v7L12 20l-8.5-4.5v-7zM12 12l8.5-4.5M12 12v8M12 12L3.5 7.5" />,
  },
  {
    href: '/categories',
    label: '分类',
    icon: <Icon d="M4 6.5h16M4 12h10M4 17.5h13" />,
  },
  {
    href: '/import',
    label: '数据',
    icon: <Icon d="M12 3.5v11m0 0l-3.5-3.5M12 14.5l3.5-3.5M4.5 16.5v2a2 2 0 002 2h11a2 2 0 002-2v-2" />,
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/': '对比看板',
  '/products': '商品管理',
  '/categories': '分类管理',
  '/import': '数据与抓取',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? '竞品价格监控';

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-3xl flex-col">
      <header className="glass sticky top-0 z-40 border-b border-ink-100/70 pt-safe">
        <div className="flex h-12 items-center gap-2.5 px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-700 text-white shadow-sm shadow-brand-500/30">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16.5l4.5-5 3 2.5L20 6" />
              <circle cx="20" cy="6" r="2.2" fill="#e5484d" stroke="none" />
            </svg>
          </span>
          <h1 className="text-[15px] font-semibold tracking-tight text-ink-900">{title}</h1>
        </div>
      </header>

      <main className="flex-1 px-4 pb-28 pt-3">{children}</main>

      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t border-ink-100/70 pb-safe">
        <div className="mx-auto flex w-full max-w-3xl items-stretch">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex flex-1 flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-medium transition-colors',
                  active ? 'text-brand-600' : 'text-ink-400 hover:text-ink-600'
                )}
              >
                <span className={clsx('transition-transform', active && 'scale-105')}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
