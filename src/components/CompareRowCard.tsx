'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { CompareRow } from '@/lib/types';
import { Tag } from './ui';

const yuan = (n: number) =>
  `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const timeAgo = (ts: number) => {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return `${Math.floor(diff / 86400_000)} 天前`;
};

export function CompareRowCard({
  row,
  categoryColor,
  onOpenProduct,
}: {
  row: CompareRow;
  categoryColor?: string;
  onOpenProduct?: (productId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? row.cells : row.cells.slice(0, 3);
  const hidden = row.cells.length - visible.length;

  return (
    <section className="card overflow-hidden animate-in">
      <header className="flex items-start justify-between gap-3 px-3.5 pb-2.5 pt-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag color={categoryColor}>{row.categoryName}</Tag>
            <span className="text-[13px] font-semibold text-ink-900">{row.specLabel}</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-ink-400">规格键 {row.specKey}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-ink-400">{row.shopCount} 家店铺</p>
          {row.spread > 0 ? (
            <p className="text-[11px] font-medium text-ink-600">
              价差 <span className="tabular-nums text-up">{yuan(row.spread)}</span>
              <span className="ml-1 text-ink-400">({(row.spreadRate * 100).toFixed(1)}%)</span>
            </p>
          ) : (
            <p className="text-[11px] text-down">价格一致</p>
          )}
        </div>
      </header>

      <ul className="divide-y divide-ink-100 border-t border-ink-100">
        {visible.map((cell) => {
          const isMin = cell.price === row.minPrice;
          const isMax = cell.price === row.maxPrice && row.spread > 0;
          return (
            <li key={`${cell.shopKey}-${cell.skuId}`}>
              <button
                type="button"
                onClick={() => onOpenProduct?.(cell.productId)}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition active:bg-ink-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink-800">{cell.shopName}</span>
                    {isMin && row.shopCount > 1 ? (
                      <span className="chip bg-brand-500 text-white">最低</span>
                    ) : null}
                    {isMax ? <span className="chip bg-up/10 text-up">最高</span> : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
                    <span className="truncate">{cell.skuSpecText}</span>
                    {cell.stock !== undefined && cell.stock >= 0 ? <span>库存 {cell.stock}</span> : null}
                    <span className="shrink-0">{timeAgo(cell.updatedAt)}</span>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p
                    className={clsx(
                      'tabular-nums text-[15px] font-semibold',
                      isMin && row.shopCount > 1 ? 'text-brand-600' : 'text-ink-900'
                    )}
                  >
                    {yuan(cell.price)}
                  </p>
                  {cell.originalPrice && cell.originalPrice > cell.price ? (
                    <p className="text-[10px] text-ink-400 line-through tabular-nums">{yuan(cell.originalPrice)}</p>
                  ) : null}
                </div>

                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5 shrink-0 text-ink-300"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                >
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>

      {hidden > 0 || expanded ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-ink-100 py-2 text-center text-[11px] font-medium text-brand-600 transition hover:bg-brand-50"
        >
          {expanded ? '收起' : `展开另外 ${hidden} 家店铺`}
        </button>
      ) : null}
    </section>
  );
}
