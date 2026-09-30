'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';

type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

type PushToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<PushToast>(() => {});

export const useToast = () => useContext(ToastContext);

const ICONS: Record<ToastKind, string> = {
  info: 'M12 8h.01M11 12h1v4h1',
  success: 'M20 6L9 17l-5-5',
  error: 'M12 8v5m0 3h.01M10.3 3.9L2.4 17.5A1.8 1.8 0 004 20.2h16a1.8 1.8 0 001.6-2.7L13.7 3.9a1.8 1.8 0 00-3.4 0z',
};

const STYLES: Record<ToastKind, string> = {
  info: 'text-ink-700',
  success: 'text-down',
  error: 'text-up',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback<PushToast>((message, kind = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((prev) => [...prev.slice(-2), { id, message, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[calc(var(--safe-top)+0.75rem)]">
        {items.map((t) => (
          <div
            key={t.id}
            className="glass pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-2xl px-3.5 py-2.5 shadow-glass ring-1 ring-ink-900/5 animate-in"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={clsx('mt-0.5 h-4 w-4 shrink-0', STYLES[t.kind])}
              stroke="currentColor"
            >
              <path d={ICONS[t.kind]} />
            </svg>
            <p className="flex-1 text-[13px] leading-5 text-ink-800">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Service Worker 注册（PWA 安装 / 离线能力） */
export function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const timer = setTimeout(() => {
      navigator.serviceWorker.register('/sw.js').catch((e) => {
        console.warn('[sw] 注册失败', e);
      });
    }, 1200);
    return () => clearTimeout(timer);
  }, []);
}
