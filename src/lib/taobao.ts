/** 淘宝链接解析与抓取（客户端侧） */

import type { ScrapeResult } from './types';
import { extractItemId, extractUrls, isShortLink } from './normalize';

export interface ResolveResponse {
  ok: boolean;
  itemId?: string;
  finalUrl?: string;
  error?: string;
}

/** 通过服务端解析短链 / 淘口令，得到商品 ID */
export async function resolveUrl(url: string): Promise<ResolveResponse> {
  const direct = extractItemId(url);
  if (direct && !isShortLink(url)) {
    return { ok: true, itemId: direct, finalUrl: url };
  }
  try {
    const res = await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as ResolveResponse;
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '短链解析失败' };
  }
}

export interface ScrapeResponse {
  ok: boolean;
  result?: ScrapeResult;
  error?: string;
  hint?: string;
}

/** 调用服务端 API 尽力抓取（Vercel 上可能被风控拦截，失败属正常） */
export async function scrapeViaApi(url: string): Promise<ScrapeResponse> {
  try {
    const res = await fetch('/api/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as ScrapeResponse;
    return data;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '请求失败' };
  }
}

/** 从任意文本中提取所有淘宝链接 */
export function findUrls(text: string): string[] {
  return extractUrls(text).filter((u) => /taobao|tmall|tb\.cn|tb\.cn/i.test(u) || extractItemId(u));
}

/** 解析结果 → 可直接导入的 ScrapeResult */
export function toScrapeResult(
  r: ScrapeResponse,
  fallbackUrl: string
): ScrapeResult | null {
  if (r.ok && r.result) return r.result;
  return null;
}

export const SCRAPE_HINT =
  '淘宝对服务器 IP 有严格风控，线上 API 抓取成功率不稳定。推荐用项目里的本地抓取脚本（scripts/scrape-taobao.mjs），复用你浏览器的登录态，稳定拿到全部 SKU 价格。';
