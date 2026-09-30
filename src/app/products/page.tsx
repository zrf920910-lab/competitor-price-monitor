'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { listCategories, listProducts, listShops } from '@/lib/db';
import { useIsClient, useLive } from '@/lib/use-live';
import { resolveCategoryId } from '@/lib/classify';
import { AddProductSheet } from '@/components/AddProductSheet';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { EmptyState } from '@/components/ui';
import { useToast } from '@/components/Toast';
import { refreshAll, type ProgressEvent } from '@/lib/actions';
import type { ProductRecord } from '@/lib/types';

const yuan = (n: number) => `¥${n.toFixed(2)}`;

const timeAgo = (ts?: number) => {
  if (!ts) return '从未同步';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
};

export default function ProductsPage() {
  const toast = useToast();
  const isClient = useIsClient();
  const products = useLive(() => listProducts(), [], []);
  const categories = useLive(() => listCategories(), [], []);
  const shops = useLive(() => listShops(), [], []);

  const [q, setQ] = useState('');
  const [shopFilter, setShopFilter] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  // 从看板跳转过来时自动打开详情
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    if (focus) {
      setFocusId(focus);
      window.history.replaceState(null, '', '/products');
    }
  }, []);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    return products.filter((p) => {
      if (shopFilter && p.shopKey !== shopFilter) return false;
      if (catFilter) {
        const cid = resolveCategoryId(p);
        if (catFilter === '__none__' ? cid !== null : cid !== catFilter) return false;
      }
      if (keyword) {
        const hay = `${p.title} ${p.shopName} ${p.skus.map((s) => s.specText).join(' ')}`.toLowerCase();
        if (!hay.includes(keyword)) return false;
      }
      return true;
    });
  }, [products, q, shopFilter, catFilter]);

  const handleRefreshAll = async () => {
    setBusy(true);
    const r = await refreshAll((e) => setProgress(e));
    setBusy(false);
    setProgress(null);
    if (r.ok > 0) toast(`已更新 ${r.ok} 个商品`, 'success');
    if (r.failed.length > 0) toast(`${r.failed.length} 个商品抓取失败`, 'error');
    if (r.ok === 0 && r.failed.length === 0) toast('没有需要更新的商品', 'info');
  };

  if (!isClient) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-24 animate-pulse bg-white/60" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="card p-3">
        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder="搜索标题 / 店铺 / 规格"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" className="btn-primary shrink-0 px-3" onClick={() => setAddOpen(true)}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加
          </button>
        </div>

        {shops.length > 1 ? (
          <div className="scroll-x -mx-1 mt-2.5 flex gap-1.5 px-1">
            <Chip active={shopFilter === null} onClick={() => setShopFilter(null)}>
              全部店铺
            </Chip>
            {shops.map((s) => (
              <Chip key={s.id} active={shopFilter === s.key} color={s.color} onClick={() => setShopFilter(s.key)}>
                {s.alias || s.name}
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="mt-2.5 flex items-center justify-between border-t border-ink-100 pt-2.5">
          <div className="scroll-x flex gap-1.5">
            <Chip small active={catFilter === null} onClick={() => setCatFilter(null)}>
              全部分类
            </Chip>
            {categories.map((c) => (
              <Chip key={c.id} small active={catFilter === c.id} color={c.color} onClick={() => setCatFilter(c.id)}>
                {c.name}
              </Chip>
            ))}
            <Chip small active={catFilter === '__none__'} onClick={() => setCatFilter('__none__')}>
              未分类
            </Chip>
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between border-t border-ink-100 pt-2.5">
          <span className="text-[11px] text-ink-400">
            共 {filtered.length} 个商品
            {progress ? ` · 正在更新 ${progress.index + 1}/${progress.total}` : ''}
          </span>
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={handleRefreshAll}
            disabled={busy || products.length === 0}
          >
            {busy ? (
              <>
                <span className="h-3 w-3 animate-spin rounded-full border-[1.5px] border-ink-300 border-t-brand-500" />
                更新中
              </>
            ) : (
              '全部刷新'
            )}
          </button>
        </div>
      </div>

      {/* 列表 */}
      {filtered.length === 0 ? (
        <EmptyState
          icon="📦"
          title={products.length === 0 ? '还没有商品' : '没有匹配的商品'}
          description={products.length === 0 ? '添加淘宝链接后，这里会列出所有竞品。' : '换个关键词或筛选条件试试。'}
          action={
            products.length === 0 ? (
              <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
                添加链接
              </button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              categoryName={catMap.get(resolveCategoryId(p) ?? '')?.name}
              categoryColor={catMap.get(resolveCategoryId(p) ?? '')?.color}
              isManual={!!p.manualCategoryId}
              onOpen={() => setFocusId(p.id)}
            />
          ))}
        </div>
      )}

      <AddProductSheet open={addOpen} onClose={() => setAddOpen(false)} />
      <ProductDetailSheet productId={focusId} open={focusId !== null} onClose={() => setFocusId(null)} />
    </div>
  );
}

function ProductCard({
  product,
  categoryName,
  categoryColor,
  isManual,
  onOpen,
}: {
  product: ProductRecord;
  categoryName?: string;
  categoryColor?: string;
  isManual: boolean;
  onOpen: () => void;
}) {
  const prices = product.skus.map((s) => s.price).filter((n) => n > 0);
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;

  return (
    <button type="button" onClick={onOpen} className="card block w-full px-3.5 py-3 text-left transition active:scale-[0.995]">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="chip bg-ink-100 text-ink-600">{product.shopName}</span>
            {categoryName ? (
              <span className="chip" style={{ backgroundColor: `${categoryColor}1a`, color: categoryColor }}>
                {categoryName}
                {isManual ? ' ·手' : ''}
              </span>
            ) : (
              <span className="chip bg-ink-100 text-ink-400">未分类</span>
            )}
            {product.status === 'error' ? <span className="chip bg-up/10 text-up">抓取失败</span> : null}
          </div>

          <p className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-5 text-ink-900">
            {product.title || '(待录入商品)'}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-400">
            <span>{product.skus.length} 个规格</span>
            {prices.length > 0 ? (
              <span className="tabular-nums">
                {min === max ? yuan(min) : `${yuan(min)} ~ ${yuan(max)}`}
              </span>
            ) : null}
            <span>{timeAgo(product.lastSyncAt)}</span>
          </div>
        </div>

        <svg
          viewBox="0 0 24 24"
          className="mt-1 h-4 w-4 shrink-0 text-ink-300"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </div>
    </button>
  );
}

function Chip({
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
