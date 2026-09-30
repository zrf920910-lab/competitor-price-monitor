'use client';

/** 客户端数据订阅 hook（基于 Dexie liveQuery，SSR 安全） */

import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';

export function useLive<T>(querier: () => Promise<T> | T, deps: unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  const initialRef = useRef(initial);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    try {
      const obs = liveQuery(querier);
      subscription = obs.subscribe({
        next: (v) => {
          if (!cancelled) setValue(v as T);
        },
        error: (e) => console.error('[useLive]', e),
      });
    } catch (e) {
      console.error('[useLive] 订阅失败', e);
      setValue(initialRef.current);
    }

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return value;
}

/** 是否已挂载到客户端 */
export function useIsClient(): boolean {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);
  return isClient;
}
