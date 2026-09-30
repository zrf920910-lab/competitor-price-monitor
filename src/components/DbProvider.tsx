'use client';

import { useEffect, useState } from 'react';
import { ToastProvider, useServiceWorker } from './Toast';
import { initDb } from '@/lib/db';

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useServiceWorker();

  useEffect(() => {
    let cancelled = false;
    initDb()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => {
        console.error('[db] 初始化失败', e);
        if (!cancelled) setError(e instanceof Error ? e.message : '本地数据库初始化失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <ToastProvider>
      {error ? (
        <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-4xl">🚫</div>
          <h1 className="text-base font-semibold text-ink-900">无法访问本地数据库</h1>
          <p className="text-sm text-ink-500">
            {error}
            <br />
            请确认浏览器未开启无痕模式，且允许本站使用本地存储。
          </p>
        </div>
      ) : ready ? (
        children
      ) : (
        <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-ink-200 border-t-brand-500" />
          <p className="text-xs text-ink-400">正在初始化本地数据…</p>
        </div>
      )}
    </ToastProvider>
  );
}
