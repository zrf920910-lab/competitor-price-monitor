/** 跨店横向对比聚合 */

import type {
  CellDelta,
  CompareCell,
  CompareMatrix,
  CompareRow,
  CategoryRecord,
  MatrixCell,
  MatrixGroup,
  MatrixRow,
  MatrixShop,
  ProductRecord,
  SnapshotRecord,
} from './types';
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

/* ==================================================================
   矩阵对比视图（汽车参数表式：行 = 规格，列 = 店铺）
   ================================================================== */

/** 把快照按 skuId 聚成时间升序的历史序列 */
export function buildPriceHistory(snapshots: SnapshotRecord[]): Map<string, SnapshotRecord[]> {
  const bySku = new Map<string, SnapshotRecord[]>();
  for (const s of snapshots) {
    const arr = bySku.get(s.skuId);
    if (arr) arr.push(s);
    else bySku.set(s.skuId, [s]);
  }
  for (const arr of bySku.values()) arr.sort((a, b) => a.ts - b.ts);
  return bySku;
}

/**
 * 取「当前这次采集之前」最近的一条快照。
 * 只看紧邻的上一条：与它同价即视为无变动，不再往更早翻。
 */
function pickPrevSnapshot(
  history: SnapshotRecord[] | undefined,
  currentPrice: number,
  currentTs: number
): SnapshotRecord | undefined {
  if (!history?.length) return undefined;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i];
    if (s.ts >= currentTs) continue;
    return s.price === currentPrice ? undefined : s;
  }
  return undefined;
}

export interface MatrixOptions {
  /** 只保留有 ≥N 家店铺报价的行 */
  minShops?: number;
  /** 只保留有价格变动的行 */
  onlyChanged?: boolean;
  /** 只保留有价差的行（真正可跨店对比） */
  onlySpread?: boolean;
}

export function buildCompareMatrix(
  products: ProductRecord[],
  categories: CategoryRecord[],
  snapshots: SnapshotRecord[] = [],
  options: MatrixOptions = {}
): CompareMatrix {
  const { minShops = 1, onlyChanged = false, onlySpread = false } = options;
  const history = buildPriceHistory(snapshots);
  const catMap = new Map(categories.map((c) => [c.id, c]));

  /* ── 1. 归集：分类 → 规格键 → 店铺 → 单元格 ── */
  const byCat = new Map<string, Map<string, Map<string, MatrixCell>>>();
  const labels = new Map<string, string>();
  const shopMeta = new Map<string, { name: string; products: Set<string> }>();

  for (const p of products) {
    if (!p.skus?.length) continue;

    const meta = shopMeta.get(p.shopKey) ?? { name: p.shopName || p.shopKey, products: new Set<string>() };
    meta.products.add(p.id);
    shopMeta.set(p.shopKey, meta);

    const catId = resolveCategoryId(p) ?? UNCATEGORIZED_ID;
    let bucket = byCat.get(catId);
    if (!bucket) {
      bucket = new Map();
      byCat.set(catId, bucket);
    }

    for (const sku of p.skus) {
      if (!Number.isFinite(sku.price) || sku.price <= 0) continue;
      const specKey = sku.manualSpecKey || sku.specKey || 'unknown';
      const cellTs = sku.updatedAt || p.updatedAt;
      const labelKey = `${catId}::${specKey}`;
      if (!labels.has(labelKey)) {
        labels.set(labelKey, sku.specLabel || buildSpecLabel(sku.specText));
      }

      let specBucket = bucket.get(specKey);
      if (!specBucket) {
        specBucket = new Map();
        bucket.set(specKey, specBucket);
      }

      // 同店同规格只留最低价
      const kept = specBucket.get(p.shopKey);
      if (kept && kept.price <= sku.price) continue;

      const prevSnap = pickPrevSnapshot(history.get(sku.id), sku.price, cellTs);
      specBucket.set(p.shopKey, {
        productId: p.id,
        productTitle: p.title,
        skuId: sku.id,
        skuSpecText: sku.specText,
        price: sku.price,
        originalPrice: sku.originalPrice,
        stock: sku.stock,
        sold: sku.sold,
        url: p.url,
        updatedAt: cellTs,
        delta: prevSnap
          ? {
              prev: prevSnap.price,
              diff: sku.price - prevSnap.price,
              rate: prevSnap.price > 0 ? (sku.price - prevSnap.price) / prevSnap.price : 0,
              ts: prevSnap.ts,
            }
          : undefined,
      });
    }
  }

  /* ── 2. 定列：只保留真正出现在对比行里的店铺 ── */
  const activeShops = new Set<string>();
  for (const bucket of byCat.values()) {
    for (const specBucket of bucket.values()) {
      for (const shopKey of specBucket.keys()) activeShops.add(shopKey);
    }
  }

  const shops: MatrixShop[] = [...activeShops].map((key) => ({
    key,
    name: shopMeta.get(key)?.name ?? key,
    productCount: shopMeta.get(key)?.products.size ?? 0,
    quoteCount: 0,
    bestCount: 0,
    bestRate: 0,
    changeCount: 0,
  }));
  // 商品多的靠前，其次按名称 —— 顺序稳定，跨筛选不会跳来跳去
  shops.sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name, 'zh-Hans-CN'));

  const shopIndex = new Map(shops.map((s, i) => [s.key, i]));

  /* ── 3. 出行：按分类顺序，组内按规格键排序 ── */
  const categoryOrder = new Map(categories.map((c, i) => [c.id, i]));
  const catIds = [...byCat.keys()].sort((a, b) => {
    const oa = categoryOrder.get(a) ?? Number.MAX_SAFE_INTEGER;
    const ob = categoryOrder.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return (catMap.get(a)?.name ?? '未分类').localeCompare(catMap.get(b)?.name ?? '未分类', 'zh-Hans-CN');
  });

  const groups: MatrixGroup[] = [];
  let rowCount = 0;
  let changedRowCount = 0;
  let lastChangeAt: number | undefined;

  for (const catId of catIds) {
    const bucket = byCat.get(catId)!;
    const rows: MatrixRow[] = [];

    for (const [specKey, specBucket] of bucket) {
      const cells: Array<MatrixCell | null> = new Array(shops.length).fill(null);
      let changedCount = 0;

      for (const [shopKey, cell] of specBucket) {
        const idx = shopIndex.get(shopKey);
        if (idx === undefined) continue;
        cells[idx] = cell;
        if (cell.delta) changedCount += 1;
      }

      const prices = cells.filter((c): c is MatrixCell => c !== null).map((c) => c.price);
      if (prices.length === 0) continue;

      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      const avgPrice = prices.reduce((s, v) => s + v, 0) / prices.length;
      const spread = maxPrice - minPrice;

      // 统计放在筛选之前 —— 反映全量，不被视图筛选扭曲
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (!c) continue;
        shops[i].quoteCount += 1;
        if (c.delta) {
          shops[i].changeCount += 1;
          if (lastChangeAt === undefined || c.updatedAt > lastChangeAt) lastChangeAt = c.updatedAt;
        }
        if (prices.length > 1 && c.price === minPrice) shops[i].bestCount += 1;
      }

      if (prices.length < minShops) continue;
      if (onlyChanged && changedCount === 0) continue;
      if (onlySpread && spread <= 0) continue;

      rows.push({
        id: `${catId}::${specKey}`,
        specKey,
        specLabel: labels.get(`${catId}::${specKey}`) ?? specKey,
        cells,
        minPrice,
        maxPrice,
        avgPrice,
        spread,
        spreadRate: minPrice > 0 ? spread / minPrice : 0,
        shopCount: prices.length,
        changedCount,
      });

      rowCount += 1;
      if (changedCount > 0) changedRowCount += 1;
    }

    if (rows.length === 0) continue;
    rows.sort((a, b) => compareSpecKey(a.specKey, b.specKey));

    const cat = catMap.get(catId);
    groups.push({
      categoryId: catId === UNCATEGORIZED_ID ? null : catId,
      categoryName: cat?.name ?? '未分类',
      categoryColor: cat?.color,
      rows,
    });
  }

  for (const s of shops) {
    s.bestRate = s.quoteCount > 0 ? s.bestCount / s.quoteCount : 0;
  }

  return { shops, groups, rowCount, changedRowCount, lastChangeAt };
}
