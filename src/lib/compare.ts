/** 跨店横向对比聚合 */

import type { CompareCell, CompareRow, CategoryRecord, ProductRecord } from './types';
import { resolveCategoryId } from './classify';
import { buildSpecLabel } from './normalize';

/** 规格键排序：先比主数值，再比单位，最后比数量 */
export function compareSpecKey(a: string, b: string): number {
  const parse = (k: string) => {
    const [base, qty] = k.split('*');
    const m = base.match(/^([\d.]+)([a-z]+)/);
    const num = m ? parseFloat(m[1]) : Number.MAX_SAFE_INTEGER;
    const unit = m ? m[2] : base;
    return { num, unit, qty: qty ? parseInt(qty, 10) : 1, raw: k };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.num !== pb.num) return pa.num - pb.num;
  if (pa.unit !== pb.unit) return pa.unit.localeCompare(pb.unit);
  if (pa.qty !== pb.qty) return pa.qty - pb.qty;
  return pa.raw.localeCompare(pb.raw);
}

const UNCATEGORIZED_ID = '__uncategorized__';

export interface BuildOptions {
  /** 只保留有 ≥N 家店铺报价的行 */
  minShops?: number;
}

export function buildCompareRows(
  products: ProductRecord[],
  categories: CategoryRecord[],
  options: BuildOptions = {}
): CompareRow[] {
  const { minShops = 1 } = options;
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const buckets = new Map<string, Map<string, CompareCell[]>>();
  const labels = new Map<string, string>();

  for (const p of products) {
    if (!p.skus || p.skus.length === 0) continue;
    const catId = resolveCategoryId(p) ?? UNCATEGORIZED_ID;

    for (const sku of p.skus) {
      if (!Number.isFinite(sku.price) || sku.price <= 0) continue;
      const specKey = sku.manualSpecKey || sku.specKey || 'unknown';

      let specBucket = buckets.get(catId);
      if (!specBucket) {
        specBucket = new Map();
        buckets.set(catId, specBucket);
      }
      const cells = specBucket.get(specKey) ?? [];
      cells.push({
        shopKey: p.shopKey,
        shopName: p.shopName || p.shopKey,
        productId: p.id,
        productTitle: p.title,
        skuId: sku.id,
        skuSpecText: sku.specText,
        price: sku.price,
        originalPrice: sku.originalPrice,
        stock: sku.stock,
        sold: sku.sold,
        url: p.url,
        updatedAt: sku.updatedAt || p.updatedAt,
      });
      specBucket.set(specKey, cells);

      if (!labels.has(`${catId}::${specKey}`)) {
        labels.set(`${catId}::${specKey}`, sku.specLabel || buildSpecLabel(sku.specText));
      }
    }
  }

  const rows: CompareRow[] = [];

  for (const [catId, specBucket] of buckets) {
    for (const [specKey, rawCells] of specBucket) {
      // 同店同规格：保留最低价
      const byShop = new Map<string, CompareCell>();
      for (const cell of rawCells) {
        const prev = byShop.get(cell.shopKey);
        if (!prev || cell.price < prev.price) byShop.set(cell.shopKey, cell);
      }
      const cells = [...byShop.values()].sort((a, b) => a.price - b.price);
      if (cells.length < minShops) continue;

      const prices = cells.map((c) => c.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = prices.reduce((s, v) => s + v, 0) / prices.length;
      const cat = catMap.get(catId);

      rows.push({
        id: `${catId}::${specKey}`,
        categoryId: catId === UNCATEGORIZED_ID ? null : catId,
        categoryName: cat?.name ?? '未分类',
        specKey,
        specLabel: labels.get(`${catId}::${specKey}`) ?? specKey,
        cells,
        minPrice,
        maxPrice,
        avgPrice,
        spread: maxPrice - minPrice,
        spreadRate: minPrice > 0 ? (maxPrice - minPrice) / minPrice : 0,
        shopCount: cells.length,
      });
    }
  }

  return rows.sort((a, b) => {
    const ca = a.categoryName.localeCompare(b.categoryName, 'zh-Hans-CN');
    if (ca !== 0) return ca;
    return compareSpecKey(a.specKey, b.specKey);
  });
}

/** 统计概览 */
export interface Overview {
  productCount: number;
  skuCount: number;
  shopCount: number;
  categoryCount: number;
  compareRowCount: number;
  multiShopRowCount: number;
  errorCount: number;
  staleCount: number;
  /** 各分类的对比行数 */
  byCategory: Array<{ id: string | null; name: string; rows: number; products: number }>;
}

export function buildOverview(
  products: ProductRecord[],
  categories: CategoryRecord[],
  rows: CompareRow[],
  staleDays = 7
): Overview {
  const shops = new Set(products.map((p) => p.shopKey));
  const now = Date.now();
  const staleMs = staleDays * 86400_000;

  const byCategoryMap = new Map<string | null, { name: string; rows: number; products: Set<string> }>();
  for (const c of categories) byCategoryMap.set(c.id, { name: c.name, rows: 0, products: new Set() });
  byCategoryMap.set(null, { name: '未分类', rows: 0, products: new Set() });

  for (const row of rows) {
    const entry = byCategoryMap.get(row.categoryId) ?? byCategoryMap.get(null)!;
    entry.rows += 1;
  }
  for (const p of products) {
    const catId = resolveCategoryId(p);
    const entry = byCategoryMap.get(catId) ?? byCategoryMap.get(null)!;
    entry.products.add(p.id);
  }

  return {
    productCount: products.length,
    skuCount: products.reduce((s, p) => s + (p.skus?.length ?? 0), 0),
    shopCount: shops.size,
    categoryCount: categories.length,
    compareRowCount: rows.length,
    multiShopRowCount: rows.filter((r) => r.shopCount >= 2).length,
    errorCount: products.filter((p) => p.status === 'error').length,
    staleCount: products.filter((p) => !p.lastSyncAt || now - p.lastSyncAt > staleMs).length,
    byCategory: [...byCategoryMap.entries()]
      .map(([id, v]) => ({ id, name: v.name, rows: v.rows, products: v.products.size }))
      .sort((a, b) => b.rows - a.rows || b.products - a.products),
  };
}
