'use client';

import { useEffect } from 'react';
import clsx from 'clsx';

/* ---------------- 底部弹层 / 对话框 ---------------- */

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg';
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={clsx(
          'sheet-panel relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl',
          size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold text-ink-900">{title}</h2>
            {description ? <p className="mt-0.5 text-xs leading-5 text-ink-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="-mr-1 -mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {footer ? (
          <div className="border-t border-ink-100 px-5 py-3 pb-[calc(var(--safe-bottom)+0.75rem)] sm:pb-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- 确认框 ---------------- */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-ink-900/30 backdrop-blur-[2px]" onClick={onCancel} aria-hidden />
      <div className="sheet-panel relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-[15px] font-semibold text-ink-900">{title}</h3>
        <div className="mt-2 text-[13px] leading-6 text-ink-600">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={clsx('btn', danger ? 'bg-up text-white hover:bg-up/90' : 'bg-brand-500 text-white hover:bg-brand-600')}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 空状态 ---------------- */

export function EmptyState({
  icon = '📦',
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="text-3xl">{icon}</div>
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description ? <p className="max-w-xs text-xs leading-5 text-ink-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* ---------------- 统计卡 ---------------- */

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'brand' | 'warn';
}) {
  return (
    <div className="card px-2 py-2 sm:px-3 sm:py-2.5">
      <p className="truncate text-[10px] font-medium text-ink-400 sm:text-[11px]">{label}</p>
      <p
        className={clsx(
          'mt-0.5 text-lg font-semibold tabular-nums tracking-tight sm:text-xl',
          tone === 'brand' && 'text-brand-600',
          tone === 'warn' && 'text-up',
          tone === 'default' && 'text-ink-900'
        )}
      >
        {value}
      </p>
      {/* 窄屏省掉 hint —— 给下面的对比表多留一行高度 */}
      {hint ? <p className="mt-0.5 hidden truncate text-[10px] text-ink-400 sm:block">{hint}</p> : null}
    </div>
  );
}

/* ---------------- 价格走势迷你图 ---------------- */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!values || values.length < 2) {
    return <div className={clsx('text-[10px] text-ink-300', className)}>—</div>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (values.length - 1);
  const points = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  const first = values[0];
  // 中国惯例：涨红跌绿
  const color = last > first ? '#e5484d' : last < first ? '#2f9e44' : '#8492a8';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={2.4} fill={color} />
    </svg>
  );
}

/* ---------------- 表单字段 ---------------- */

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-ink-400">{hint}</span> : null}
    </label>
  );
}

/* ---------------- 标签 ---------------- */

export function Tag({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx('chip', className)}
      style={
        color
          ? { backgroundColor: `${color}1a`, color }
          : undefined
      }
    >
      {children}
    </span>
  );
}
