'use client';

/** 业务动作层：抓取、刷新、批量操作 */

import { getProduct, listProducts, upsertProduct, updateProduct } from './db';
import { scrapeViaApi } from './taobao';
import { extractItemId } from './normalize';

export interface ProgressEvent {
  index: number;
  total: number;
  url: string;
  status: 'pending' | 'ok' | 'failed';
  message: string;
}

export interface BatchResult {
  ok: number;
  failed: Array<{ url: string; error: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 抓取单个链接（不落库），返回结果或错误 */
async function scrapeOne(url: string) {
  const res = await scrapeViaApi(url);
  if (res.ok && res.result && res.result.skus.length > 0) {
    return { ok: true as const, result: res.result };
  }
  return { ok: false as const, error: res.error ?? res.hint ?? '未获取到 SKU 数据' };
}

/**
 * 批量添加链接。
 * @param urls 链接列表（可含重复、空行）
 * @param options.scrape 是否尝试线上抓取
 * @param options.keepFailed 抓取失败时是否仍创建「待录入」商品
 */
export async function addByUrls(
  urls: string[],
  options: { scrape?: boolean; keepFailed?: boolean; onProgress?: (e: ProgressEvent) => void } = {}
): Promise<BatchResult> {
  const { scrape = true, keepFailed = true, onProgress } = options;
  const unique = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
  const result: BatchResult = { ok: 0, failed: [] };

  for (let i = 0; i < unique.length; i++) {
    const url = unique[i];
    onProgress?.({ index: i, total: unique.length, url, status: 'pending', message: '正在解析…' });

    if (!scrape) {
      await upsertProduct({ title: '', url, skus: [] });
      await markPending(url);
      result.ok += 1;
      onProgress?.({ index: i, total: unique.length, url, status: 'ok', message: '已添加为待录入' });
      continue;
    }

    const r = await scrapeOne(url);
    if (r.ok) {
      await upsertProduct({
        itemId: r.result.itemId,
        title: r.result.title,
        url: r.result.url || url,
        shopName: r.result.shopName,
        cover: r.result.cover,
        skus: r.result.skus,
        source: 'api',
      });
      result.ok += 1;
      onProgress?.({
        index: i,
        total: unique.length,
        url,
        status: 'ok',
        message: `已抓取 ${r.result.skus.length} 个 SKU`,
      });
    } else {
      if (keepFailed) {
        const created = await upsertProduct({ itemId: extractItemId(url) ?? undefined, title: '', url, skus: [] });
        await updateProduct(created.id, { status: 'error', error: r.error });
      }
      result.failed.push({ url, error: r.error });
      onProgress?.({ index: i, total: unique.length, url, status: 'failed', message: r.error });
    }

    // 限速，降低被风控概率
    if (i < unique.length - 1) await sleep(700);
  }

  return result;
}

async function markPending(url: string) {
  const itemId = extractItemId(url);
  if (!itemId) return;
  const products = await listProducts();
  const hit = products.find((p) => p.itemId === itemId);
  if (hit) await updateProduct(hit.id, { status: 'idle' });
}

/** 刷新单个商品的价格 */
export async function refreshProduct(productId: string): Promise<{ ok: boolean; error?: string; count?: number }> {
  const product = await getProduct(productId);
  if (!product) return { ok: false, error: '商品不存在' };

  const r = await scrapeOne(product.url);
  if (!r.ok) {
    await updateProduct(productId, { status: 'error', error: r.error, lastAttemptAt: Date.now() });
    return { ok: false, error: r.error };
  }

  await upsertProduct({
    itemId: r.result.itemId || product.itemId,
    title: r.result.title || product.title,
    url: r.result.url || product.url,
    shopName: r.result.shopName || product.shopName,
    cover: r.result.cover || product.cover,
    skus: r.result.skus,
    source: 'api',
  });
  return { ok: true, count: r.result.skus.length };
}

/** 刷新全部商品 */
export async function refreshAll(
  onProgress?: (e: ProgressEvent) => void,
  options: { onlyStale?: boolean; staleDays?: number } = {}
): Promise<BatchResult> {
  const { onlyStale = false, staleDays = 3 } = options;
  const all = await listProducts();
  const cutoff = Date.now() - staleDays * 86400_000;
  const targets = onlyStale ? all.filter((p) => !p.lastSyncAt || p.lastSyncAt < cutoff) : all;

  const result: BatchResult = { ok: 0, failed: [] };

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    onProgress?.({ index: i, total: targets.length, url: p.url, status: 'pending', message: p.title });
    const r = await refreshProduct(p.id);
    if (r.ok) {
      result.ok += 1;
      onProgress?.({
        index: i,
        total: targets.length,
        url: p.url,
        status: 'ok',
        message: `已更新 ${r.count} 个 SKU`,
      });
    } else {
      result.failed.push({ url: p.url, error: r.error ?? '未知错误' });
      onProgress?.({
        index: i,
        total: targets.length,
        url: p.url,
        status: 'failed',
        message: r.error ?? '未知错误',
      });
    }
    if (i < targets.length - 1) await sleep(800);
  }

  return result;
}
