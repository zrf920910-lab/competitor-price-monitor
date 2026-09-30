'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import type { CompareMatrix, MatrixCell, MatrixRow, MatrixShop } from '@/lib/types';
import { dateTime, pct, yuan } from '@/lib/format';

/** 首列（规格）冻结宽度 */
const SPEC_COL_W = 126;
/** 店铺列宽：店多时收窄，保证一屏能看到 2~3 列 */
const shopColWidth = (count: number) => (count > 6 ? 84 : count > 4 ? 94 : 106);

/* ───────────────────────── 单元格配色 ─────────────────────────
   底色表达「横向贵贱」：最低绿、最高红
   角标表达「纵向涨跌」：涨红、跌绿（中国惯例）
   ─────────────────────────────────────────────────────────── */

interface CellTone {
  /** 单元格底色 */
  bg: string;
  /** 价格文字色 */
  price: string;
  /** 最低 / 最高 小标 */
  flag?: '最低' | '最高';
}

function cellTone(cell: MatrixCell | null, row: MatrixRow): CellTone {
  if (!cell) return { bg: 'bg-ink-50/60', price: 'text-ink-300' };
  if (row.shopCount > 1 && row.spread > 0) {
    if (cell.price === row.minPrice) return { bg: 'bg-down/10', price: 'text-down', flag: '最低' };
    if (cell.price === row.maxPrice) return { bg: 'bg-up/10', price: 'text-up', flag: '最高' };
  }
  return { bg: 'bg-white', price: 'text-ink-900' };
}

/** 价差率的警示程度：差得越多越显眼 */
function spreadTone(rate: number) {
  if (rate >= 0.2) return 'text-up';
  if (rate >= 0.08) return 'text-warn';
  return 'text-ink-400';
}

/* ───────────────────────────── 组件 ───────────────────────────── */

export function CompareMatrixView({
  matrix,
  onOpenProduct,
}: {
  matrix: CompareMatrix;
  onOpenProduct?: (productId: string) => void;
}) {
  const { shops, groups, rowCount, changedRowCount } = matrix;

  /**
   * 表格高度 = 视口 - 表格顶部偏移 - 底部导航。
   *
   * 不能用固定的 `100dvh - Nrem`：上面的概览卡、分类 chip 会换行，
   * 顶部偏移是浮动的，写死必然在某些屏宽下露出或遮住几行。
   */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const docTop = el.getBoundingClientRect().top + window.scrollY;
      const bottomGap = 72; // 底部导航 + 呼吸空间
      setMaxH(Math.max(180, Math.round(window.innerHeight - docTop - bottomGap)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    // 移动端地址栏收起/展开时 innerHeight 会变，但未必触发 window resize
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [groups.length, shops.length]);

  if (groups.length === 0 || shops.length === 0) return null;

  const colW = shopColWidth(shops.length);

  return (
    <section className="card overflow-hidden animate-in">
      {/* 图例 / 统计条 */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-ink-100 px-3.5 py-2.5">
        <div className="flex items-center gap-2.5 text-[10px] text-ink-500">
          <LegendSwatch className="bg-down/15 text-down" label="最低价" />
          <LegendSwatch className="bg-up/15 text-up" label="最高价" />
          <span className="flex items-center gap-1">
            <span className="font-medium text-up">↑</span>
            <span className="font-medium text-down">↓</span>
            <span>较上次涨跌</span>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-ink-400">
          <span className="tabular-nums">
            {shops.length} 列 × {rowCount} 行
          </span>
          {changedRowCount > 0 ? (
            <span className="chip bg-up/10 tabular-nums text-up">{changedRowCount} 行有变动</span>
          ) : (
            <span className="chip bg-ink-100 text-ink-500">暂无变动</span>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        className="overflow-auto overscroll-x-contain"
        style={{ maxHeight: maxH ? `${maxH}px` : 'max(14rem, calc(100dvh - 27rem))' }}
      >
        <table className="w-full border-separate border-spacing-0 text-[12px]">
          <colgroup>
            <col style={{ width: SPEC_COL_W, minWidth: SPEC_COL_W }} />
            {shops.map((s) => (
              <col key={s.key} style={{ width: colW, minWidth: colW }} />
            ))}
          </colgroup>

          {/* ── 表头：吸顶 + 首格冻结 ── */}
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 top-0 z-30 border-b border-r border-ink-200 bg-ink-50 px-2.5 py-2 text-left align-bottom"
              >
                <span className="text-[10px] font-semibold tracking-wide text-ink-400">规格</span>
              </th>
              {shops.map((s) => (
                <th
                  key={s.key}
                  scope="col"
                  className="sticky top-0 z-20 border-b border-l border-ink-100 bg-ink-50 px-2 py-2 text-left align-bottom"
                >
                  <div className="truncate text-[11px] font-semibold text-ink-800" title={s.name}>
                    {s.name}
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1 text-[10px] font-normal text-ink-400">
                    <span className="tabular-nums">{s.quoteCount}</span>
                    <span>规格</span>
                    {s.bestCount > 0 ? (
                      <span className="ml-0.5 font-medium tabular-nums text-down">· 最低 {s.bestCount}</span>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* ── 数据：按分类分组 ── */}
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.categoryId ?? '__uncategorized__'}>
                <tr>
                  <td colSpan={shops.length + 1} className="border-b border-ink-100 bg-ink-100/70 px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {g.categoryColor ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: g.categoryColor }}
                        />
                      ) : null}
                      <span className="text-[11px] font-semibold text-ink-700">{g.categoryName}</span>
                      <span className="text-[10px] tabular-nums text-ink-400">{g.rows.length} 个规格</span>
                    </div>
                  </td>
                </tr>

                {g.rows.map((row) => (
                  <tr key={row.id} className="group/row">
                    {/* 冻结首列 */}
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-r border-ink-200 bg-white px-2.5 py-2 text-left align-middle transition group-hover/row:bg-ink-50"
                    >
                      <div className="truncate text-[12px] font-medium text-ink-900" title={row.specLabel}>
                        {row.specLabel}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-400">
                        <span className="font-mono">{row.specKey}</span>
                        {row.spread > 0 ? (
                          <span className={clsx('font-medium tabular-nums', spreadTone(row.spreadRate))}>
                            差 {pct(row.spreadRate, 0)}
                          </span>
                        ) : null}
                      </div>
                    </th>

                    {/* 各店铺报价 */}
                    {row.cells.map((cell, i) => {
                      const tone = cellTone(cell, row);
                      return (
                        <td
                          key={shops[i].key}
                          className={clsx(
                            'border-b border-l border-ink-100 px-1 py-1.5 text-center align-middle',
                            tone.bg
                          )}
                        >
                          {cell ? (
                            <button
                              type="button"
                              onClick={() => onOpenProduct?.(cell.productId)}
                              title={`${cell.productTitle}\n${cell.skuSpecText}\n更新于 ${dateTime(cell.updatedAt)}`}
                              className="block w-full rounded-lg px-0.5 py-0.5 transition active:scale-[0.95]"
                            >
                              <span
                                className={clsx(
                                  'block text-[13px] font-semibold leading-5 tabular-nums',
                                  tone.price
                                )}
                              >
                                {yuan(cell.price)}
                              </span>
                              <DeltaBadge cell={cell} flag={tone.flag} />
                            </button>
                          ) : (
                            <span className="block text-[11px] leading-5 text-ink-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>

          {/* ── 汇总：谁整体最便宜 ── */}
          <tfoot>
            <tr>
              <th
                scope="row"
                className="sticky left-0 z-10 border-r border-t border-ink-200 bg-ink-50 px-2.5 py-2 text-left align-top"
              >
                <span className="text-[10px] font-semibold text-ink-500">最低价次数</span>
              </th>
              {shops.map((s) => (
                <td
                  key={s.key}
                  className="border-l border-t border-ink-100 bg-ink-50 px-1.5 py-2 text-center align-top"
                >
                  <ShopSummary shop={s} />
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

/* ───────────────────────────── 子组件 ───────────────────────────── */

/** 价格下方的角标：优先显示涨跌，其次显示最低/最高 */
function DeltaBadge({ cell, flag }: { cell: MatrixCell; flag?: '最低' | '最高' }) {
  if (cell.delta) {
    const up = cell.delta.diff > 0;
    return (
      <span
        className={clsx(
          'mt-px flex items-center justify-center gap-0.5 text-[10px] font-medium leading-4 tabular-nums',
          up ? 'text-up' : 'text-down'
        )}
      >
        <span>{up ? '↑' : '↓'}</span>
        <span>{Math.abs(cell.delta.diff).toFixed(2)}</span>
        <span className="opacity-70">({pct(Math.abs(cell.delta.rate), 1)})</span>
      </span>
    );
  }
  if (flag) {
    return (
      <span
        className={clsx('mt-px block text-[10px] font-medium leading-4', flag === '最低' ? 'text-down/80' : 'text-up/80')}
      >
        {flag}
      </span>
    );
  }
  return <span className="mt-px block text-[10px] leading-4 text-ink-300">·</span>;
}

function ShopSummary({ shop }: { shop: MatrixShop }) {
  const none = shop.bestCount === 0;
  return (
    <div className="leading-4">
      <div className={clsx('text-[12px] font-semibold tabular-nums', none ? 'text-ink-300' : 'text-down')}>
        {shop.bestCount}
      </div>
      <div className="text-[9px] tabular-nums text-ink-400">
        {shop.quoteCount > 0 ? `命中 ${pct(shop.bestRate, 0)}` : '无报价'}
      </div>
      {shop.changeCount > 0 ? (
        <div className="mt-0.5 text-[9px] font-medium tabular-nums text-up">变动 {shop.changeCount}</div>
      ) : null}
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={clsx('inline-block h-3 w-3 rounded-[3px] ring-1 ring-inset ring-ink-200/60', className)} />
      <span>{label}</span>
    </span>
  );
}
