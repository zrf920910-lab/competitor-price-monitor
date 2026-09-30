'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { listAllSnapshots, listCategories, listProducts } from '@/lib/db';
import { useIsClient, useLive } from '@/lib/use-live';
import { buildCompareMatrix, buildOverview, toCompareRows } from '@/lib/compare';
import { CompareMatrixView } from '@/components/CompareMatrix';
import { CompareRowCard } from '@/components/CompareRowCard';
import { AddProductSheet } from '@/components/AddProductSheet';
import { EmptyState, Stat } from '@/components/ui';

type ViewMode = 'matrix' | 'card';

export default function DashboardPage() {
  const router = useRouter();
  const isClient = useIsClient();
  const products = useLive(() => listProducts(), [], []);
  const categories = useLive(() => listCategories(), [], []);
  const snapshots = useLive(() => listAllSnapshots(), [], []);

  const [view, setView] = useState<ViewMode>('matrix');
  const [minShops, setMinShops] = useState(1);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const colorMap = useMemo(() => new Map(categories.map((c) => [c.id, c.color])), [categories]);

  /* ── 矩阵：列固定为店铺，行按分类分组。这里是全量，筛选在下面做 ── */
  const matrix = useMemo(
    () => buildCompareMatrix(products, categories, snapshots),
    [products, categories, snapshots]
  );

  // 统计口径与表格共用同一份数据，避免「卡片说 12 个规格、表格却有 58 行」
  const overview = useMemo(
    () => buildOverview(products, categories, matrix),
    [products, categories, matrix]
  );

  /** 行级筛选（店铺数 + 变动 + 分类 + 关键词）—— 只减行，不动列，避免横向位置跳动 */
  const filteredMatrix = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    const shopNames = matrix.shops.map((s) => s.name);

    const groups = matrix.groups
      .filter((g) => {
        if (!catFilter) return true;
        return catFilter === '__none__' ? g.categoryId === null : g.categoryId === catFilter;
      })
      .map((g) => ({
        ...g,
        rows: g.rows.filter((r) => {
          if (r.shopCount < minShops) return false;
          if (onlyChanged && r.changedCount === 0) return false;
          if (!keyword) return true;
          const hay = [
            r.specLabel,
            r.specKey,
            g.categoryName,
            ...shopNames,
            ...r.cells.map((c) => c?.skuSpecText ?? ''),
          ]
            .join(' ')
            .toLowerCase();
          return hay.includes(keyword);
        }),
      }))
      .filter((g) => g.rows.length > 0);

    let rowCount = 0;
    let changedRowCount = 0;
    for (const g of groups) {
      rowCount += g.rows.length;
      changedRowCount += g.rows.filter((r) => r.changedCount > 0).length;
    }

    return { ...matrix, groups, rowCount, changedRowCount };
  }, [matrix, minShops, onlyChanged, catFilter, q]);

  /* ── 卡片视图：从同一份矩阵结果转换，保证两个视图行数一致 ── */
  const rows = useMemo(() => toCompareRows(filteredMatrix), [filteredMatrix]);

  const rowCount = view === 'matrix' ? filteredMatrix.rowCount : rows.length;

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
          description="粘贴淘宝商品链接，自动提取全部 SKU 价格，再按规格把各店铺横向拉平对比。"
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
              <span className="font-medium text-ink-800">2. 抓取价格</span> — 在「数据」页启动本地抓取代理，
              应用内直接抓；也可用脚本抓取后导入。
            </li>
            <li>
              <span className="font-medium text-ink-800">3. 对比表</span> — 每个店铺一列，同规格横向对齐，价差与涨跌一眼看清。
            </li>
          </ol>
        </div>
        <AddProductSheet open={addOpen} onClose={() => setAddOpen(false)} />
      </>
    );
  }

  return (
    <div className="space-y-3">
      {/* 概览：窄屏一行四项，宽屏放大 */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
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
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
            >
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

        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-ink-100 pt-2.5">
          <FilterChip active={minShops === 1} onClick={() => setMinShops(1)} small>
            全部规格
          </FilterChip>
          <FilterChip active={minShops === 2} onClick={() => setMinShops(2)} small>
            仅可跨店对比
          </FilterChip>
          <FilterChip active={onlyChanged} onClick={() => setOnlyChanged((v) => !v)} small tone="warn">
            仅看变动
          </FilterChip>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] tabular-nums text-ink-400">{rowCount} 行</span>
          <ViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {/* 对比区 */}
      {view === 'matrix' ? (
        filteredMatrix.groups.length === 0 ? (
          <EmptyState
            icon="🔍"
            title="没有符合条件的规格"
            description={
              onlyChanged
                ? '还没有检测到价格变动。刷新一次价格后，涨跌会自动标出来。'
                : minShops === 2
                  ? '切换到「全部规格」看看，或给更多店铺添加同款商品。'
                  : '试着换个关键词，或调整分类筛选。'
            }
          />
        ) : (
          <CompareMatrixView
            matrix={filteredMatrix}
            onOpenProduct={(id) => router.push(`/products?focus=${id}`)}
          />
        )
      ) : rows.length === 0 ? (
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

/* ───────────────────────────── 子组件 ───────────────────────────── */

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  const options: Array<{ key: ViewMode; label: string; icon: React.ReactNode }> = [
    {
      key: 'matrix',
      label: '对比表',
      icon: (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11" />
        </svg>
      ),
    },
    {
      key: 'card',
      label: '卡片',
      icon: (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <rect x="3" y="4" width="18" height="6" rx="2" />
          <rect x="3" y="14" width="18" height="6" rx="2" />
        </svg>
      ),
    },
  ];

  return (
    <div className="flex rounded-lg bg-ink-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={view === o.key}
          className={clsx(
            'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
            view === o.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FilterChip({
  children,
  active,
  color,
  onClick,
  small,
  tone = 'default',
}: {
  children: React.ReactNode;
  active: boolean;
  color?: string;
  onClick: () => void;
  small?: boolean;
  tone?: 'default' | 'warn';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'shrink-0 rounded-full border font-medium transition',
        small ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
        active
          ? tone === 'warn'
            ? 'border-transparent bg-up text-white'
            : 'border-transparent bg-ink-900 text-white'
          : 'border-ink-200 bg-white text-ink-600 hover:border-ink-300'
      )}
      style={active && color ? { backgroundColor: color } : undefined}
    >
      {children}
    </button>
  );
}
