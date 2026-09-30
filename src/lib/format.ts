/** 展示层格式化工具（组件之间共用，避免各写一份） */

/** 人民币金额，千分位 + 两位小数 */
export const yuan = (n: number) =>
  `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** 带符号金额：+¥2.00 / -¥1.50 */
export const yuanSigned = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '-' : ''}${yuan(Math.abs(n))}`;

/** 相对时间 */
export function timeAgo(ts?: number, fallback = '从未同步'): string {
  if (!ts) return fallback;
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 百分比 */
export const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;

/** 日期时间（用于 title 提示） */
export const dateTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '—';
