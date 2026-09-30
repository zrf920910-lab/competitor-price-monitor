'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { listCategories, listProducts } from '@/lib/db';
import { useIsClient, useLive } from '@/lib/use-live';
import { buildCompareRows, buildOverview } from '@/lib/compare';
import { resolveCategoryId } from '@/lib/classify';
import { CompareRowCard } from '@/components/CompareRowCard';
import { AddProductSheet } from '@/components/AddProductSheet';
import { EmptyState, Stat } from '@/components/ui';

export default function DashboardPage() {
  const router = useRouter();
  const isClient = useIsClient();
  const products = useLive(() => listProducts(), [], []);
  const categories = useLive(() => listCategories(), [], []);

  const [minShops, setMinShops] = useState(1);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const allRows = useMemo(() => buildCompareRows(products, categories), [products, categories]);
  const overview = useMemo(() => buildOverview(products, categories, allRows), [products, categories, allRows]);

  const colorMap = useMemo(() => new Map(categories.map((c) => [c.id, c.color])), [categories]);

  const rows = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return allRows.filter((r) => {
      if (r.shopCount < minShops) return false;
      if (catFilter) {
        if (catFilter === '__none__' ? r.categoryId !== null : r.categoryId !== catFilter) return false;
      }
      if (keyword) {
        const hay = `${r.specLabel} ${r.specKey} ${r.categoryName} ${r.cells
          .map((c) => `${c.shopName} ${c.skuSpecText}`)
          .join(' ')}`.toLowerCase();
        if (!hay.includes(keyword)) return false;
      }
      return true;
    });
  }, [allRows, minShops, catFilter, q]);

  if (!isClient) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-28 animate-pulse bg-white/60" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <>
        <EmptyState
          icon="🛒"
          title="还没有竞品数据"
          description="粘贴淘宝商品链接，自动提取全部 SKU 价格，并按规格把各店铺横向拉平对比。"
          action={
            <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
              添加第一个链接
            </button>
          }
        />
        <div className="mt-4 card p-4">
          <p className="text-xs font-semibold text-ink-700">三步跑起来</p>
          <ol className="mt-2 space-y-2 text-[12px] leading-5 text-ink-500">
            <li>
              <span className="font-medium text-ink-800">1. 添加链接</span> — 粘贴淘宝/天猫商品链接，一行一个。
            </li>
            <li>
              <span className="font-medium text-ink-800">2. 抓取价格</span> — 线上抓取失败时，用本地脚本{' '}
              <code className="rounded bg-ink-100 px-1 font-mono text-[10px]">npm run scrape</code>{' '}
              抓取后到「数据」页导入。
            </li>
            <li>
              <span className="font-medium text-ink-800">3. 自动分类 + 对比</span> — 系统按规格键把同款拉平，价差一目了然。
            </li>
          </ol>
        </div>
        <AddProductSheet open={addOpen} onClose={() => setAddOpen(false)} />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {/* 概览 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="竞品商品" value={overview.productCount} hint={`${overview.shopCount} 家店铺`} />
        <Stat label="SKU 总数" value={overview.skuCount} />
        <Stat
          label="可比对规格"
          value={overview.compareRowCount}
          hint={`其中 ${overview.multiShopRowCount} 个可跨店对比`}
          tone="brand"
        />
        <Stat
          label="待更新"
          value={overview.staleCount}
          hint={overview.errorCount > 0 ? `${overview.errorCount} 个抓取失败` : '7 天内已同步'}
          tone={overview.errorCount > 0 ? 'warn' : 'default'}
        />
      </div>

      {/* 筛选 */}
      <div className="card p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg
              viewBox="0 0 24 24"
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-300"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              className="input pl-8"
              placeholder="搜索规格 / 店铺"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="btn-primary shrink-0 px-3"
            aria-label="添加链接"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加
          </button>
        </div>

        <div className="scroll-x -mx-1 mt-2.5 flex gap-1.5 px-1">
          <FilterChip active={catFilter === null} onClick={() => setCatFilter(null)}>
            全部分类
          </FilterChip>
          {categories.map((c) => (
            <FilterChip key={c.id} active={catFilter === c.id} color={c.color} onClick={() => setCatFilter(c.id)}>
              {c.name}
            </FilterChip>
          ))}
          <FilterChip active={catFilter === '__none__'} onClick={() => setCatFilter('__none__')}>
            未分类
          </FilterChip>
        </div>

        <div className="mt-2.5 flex items-center justify-between border-t border-ink-100 pt-2.5">
          <div className="flex gap-1.5">
            <FilterChip active={minShops === 1} onClick={() => setMinShops(1)} small>
              全部规格
            </FilterChip>
            <FilterChip active={minShops === 2} onClick={() => setMinShops(2)} small>
              仅可跨店对比
            </FilterChip>
          </div>
          <span className="text-[11px] text-ink-400">{rows.length} 行</span>
        </div>
      </div>

      {/* 对比列表 */}
      {rows.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="没有符合条件的规格"
          description={
            minShops === 2
              ? '切换到「全部规格」看看，或给更多店铺添加同款商品。'
              : '试着换个关键词，或调整分类筛选。'
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <CompareRowCard
              key={row.id}
              row={row}
              categoryColor={row.categoryId ? colorMap.get(row.categoryId) : undefined}
              onOpenProduct={(id) => router.push(`/products?focus=${id}`)}
            />
          ))}
        </div>
      )}

      <AddProductSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function FilterChip({
  children,
  active,
  color,
  onClick,
  small,
}: {
  children: React.ReactNode;
  active: boolean;
  color?: string;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded-full border font-medium transition',
        small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
        active
          ? 'border-transparent bg-ink-900 text-white'
          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300'
      )}
      style={active && color ? { backgroundColor: color } : undefined}
    >
      {children}
    </button>
  );
}
