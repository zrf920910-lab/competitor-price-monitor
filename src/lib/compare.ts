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
  SkuRecord,
  SnapshotRecord,
} from './types';
import { resolveCategoryId } from './classify';
import { buildSpecKey, buildSpecLabel, normalizeText } from './normalize';

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

/**
 * 把矩阵结果摊平成「一行一个规格」的卡片数据。
 *
 * 卡片视图和对比表必须共用同一套规格键，否则两边会给出不一样的规格数。
 * 传进来的 matrix 可以是筛选过的，所以只做形状转换、不做任何聚合决策。
 */
export function toCompareRows(matrix: CompareMatrix): CompareRow[] {
  const { shops } = matrix;
  return matrix.groups.flatMap((g) =>
    g.rows.map((row) => ({
      id: row.id,
      categoryId: g.categoryId,
      categoryName: g.categoryName,
      specKey: row.specKey,
      specLabel: row.specLabel,
      cells: row.cells
        .map((c, i) => (c ? { ...c, shopKey: shops[i].key, shopName: shops[i].name } : null))
        .filter((c): c is CompareCell => c !== null)
        .sort((a, b) => a.price - b.price),
      minPrice: row.minPrice,
      maxPrice: row.maxPrice,
      avgPrice: row.avgPrice,
      spread: row.spread,
      spreadRate: row.spreadRate,
      shopCount: row.shopCount,
    }))
  );
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
  /** 看板矩阵。行数 / 跨店行数 / 各分类行数都从它取，保证统计与表格永远一致 */
  matrix: Pick<CompareMatrix, 'groups' | 'rowCount'>,
  staleDays = 7
): Overview {
  const shops = new Set(products.map((p) => p.shopKey));
  const now = Date.now();
  const staleMs = staleDays * 86400_000;

  const byCategoryMap = new Map<string | null, { name: string; rows: number; products: Set<string> }>();
  for (const c of categories) byCategoryMap.set(c.id, { name: c.name, rows: 0, products: new Set() });
  byCategoryMap.set(null, { name: '未分类', rows: 0, products: new Set() });

  let multiShopRowCount = 0;
  for (const g of matrix.groups) {
    const entry = byCategoryMap.get(g.categoryId) ?? byCategoryMap.get(null)!;
    entry.rows += g.rows.length;
    multiShopRowCount += g.rows.filter((r) => r.shopCount >= 2).length;
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
    compareRowCount: matrix.rowCount,
    multiShopRowCount,
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

/**
 * 规格键是否是「没识别出来」的退化值。
 *
 * 抓取不完整时（只拿到商品起价），所有商品的规格键都会退化成同一个值。
 * 直接拿它分行，几十个商品会被合并成一行 —— 表现就是「对比表只有一个对比项」。
 */
export function isDegenerateSpecKey(key: string): boolean {
  const k = (key ?? '').trim();
  if (!k) return true;
  if (k === 'unknown') return true;
  if (/^默认(规格|款)?$/.test(k)) return true;
  // 纯符号（如 ":"、";:"）也是没识别出来的表现
  return !/[\u4e00-\u9fa5a-zA-Z0-9]/.test(k);
}

/**
 * 细粒度规格键：把规格文本归一化成可直接比较的形式。
 *
 * 用在「粗键区分度不够」的场合 —— 例如淘宝上大量商品的规格名是
 * "套装（含箱+2个4KG+2个面具）"、"空箱（可放2个4KG）" 这种长描述，
 * 粗键都只会提取出 "4kg"，于是几十个 SKU 全挤在一行。
 * 换成归一化全文后，同款商品同款话术仍能自动对齐，不同规格则各占一行。
 */
function fineSpecKey(text: string): string {
  const s = normalizeText(text)
    .replace(/[\s()（）[\]【】{}｛｝,，、;；:：·・/\\|+*×x_\-.]/g, '')
    .slice(0, 40);
  return s || 'unknown';
}

export interface MatrixOptions {
  /** 只保留有 ≥N 家店铺报价的行 */
  minShops?: number;
  /** 只保留有价格变动的行 */
  onlyChanged?: boolean;
  /** 只保留有价差的行（真正可跨店对比） */
  onlySpread?: boolean;
}

/* ==================================================================
   规格键解析 —— 两个视图（对比表 / 卡片）共用的唯一口径
   ================================================================== */

/** 单个 SKU 的最终归属 */
interface ResolvedSpec {
  catId: string;
  /** 粗键：manualSpecKey || specKey —— 跨店对齐的主力（"4kg"、"500ml*2"） */
  coarseKey: string;
  /** 最终用来分行的键 */
  specKey: string;
  /** 因为粗键区分不出来而细化了 */
  refined: boolean;
  /** 规格始终没识别出来（抓取只拿到商品起价） */
  degenerate: boolean;
  /** 行标题；退化行由调用方换成商品名 */
  label: string;
}

/**
 * 给每个 SKU 算一个「有效规格键」。
 *
 * 淘宝上大量商品的规格名是整句话 —— "套装（含箱+2个4KG+2个面具）"、
 * "空箱（可放2个4KG）" —— 粗键统一只提出 "4kg"，于是一个商品 29 个 SKU
 * 全挤进同一行，看起来就像「只抓到一个对比项」。
 *
 * 判据：同一个商品在同一个桶里出现 ≥2 个 SKU，说明这个粗键没把它的规格区分开。
 * 必须整桶一起细化 —— 只改一部分的话，改过的行和没改的行再也对不上。
 */
function resolveSpecs(products: ProductRecord[]): Map<SkuRecord, ResolvedSpec> {
  interface Raw {
    product: ProductRecord;
    sku: SkuRecord;
    catId: string;
    coarseKey: string;
    /** 商品身份。不同商品绝不能共用一行，否则就是「只有一个对比项」 */
    productKey: string;
    bucketKey: string;
  }

  const raws: Raw[] = [];
  /** bucketKey → productKey → 该商品在这个桶里塞了几个 SKU */
  const bucketStats = new Map<string, Map<string, number>>();

  for (const p of products) {
    if (!p.skus?.length) continue;
    const catId = resolveCategoryId(p) ?? UNCATEGORIZED_ID;
    const productKey = p.itemId || p.id;

    for (const sku of p.skus) {
      if (!Number.isFinite(sku.price) || sku.price <= 0) continue;

      const coarseKey = sku.manualSpecKey || sku.specKey || 'unknown';
      const bucketKey = `${catId}::${coarseKey}`;

      let perProduct = bucketStats.get(bucketKey);
      if (!perProduct) {
        perProduct = new Map();
        bucketStats.set(bucketKey, perProduct);
      }
      perProduct.set(productKey, (perProduct.get(productKey) ?? 0) + 1);

      raws.push({ product: p, sku, catId, coarseKey, productKey, bucketKey });
    }
  }

  const refineBuckets = new Set<string>();
  for (const [bucketKey, perProduct] of bucketStats) {
    for (const count of perProduct.values()) {
      if (count > 1) {
        refineBuckets.add(bucketKey);
        break;
      }
    }
  }

  const out = new Map<SkuRecord, ResolvedSpec>();
  for (const { sku, catId, coarseKey, productKey, bucketKey } of raws) {
    const refined = refineBuckets.has(bucketKey);
    let specKey = refined ? fineSpecKey(sku.specText) : coarseKey;

    // 细键也还是空的 / 纯符号 → 退回「粗键 + 商品」按商品拆行。
    // 宁可同一商品的规格各自成行，也不能让不同商品塌成一行。
    const degenerate = isDegenerateSpecKey(specKey);
    if (degenerate) specKey = `${coarseKey}::${productKey}`;

    out.set(sku, {
      catId,
      coarseKey,
      specKey,
      refined: refined && !degenerate,
      degenerate,
      label: degenerate
        ? ''
        : refined
          ? // 细化过的行必须显示原始规格文本 —— 否则 29 行全叫 "4KG"，等于没区分
            sku.specText.trim().slice(0, 28) || specKey
          : sku.specLabel || buildSpecLabel(sku.specText),
    });
  }
  return out;
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
  const resolved = resolveSpecs(products);

  /* ── 1. 定列：哪些店铺有报价 ── */
  const shopMeta = new Map<string, { name: string; products: Set<string> }>();
  for (const p of products) {
    if (!p.skus?.some((s) => Number.isFinite(s.price) && s.price > 0)) continue;
    const meta = shopMeta.get(p.shopKey) ?? { name: p.shopName || p.shopKey, products: new Set<string>() };
    meta.products.add(p.id);
    shopMeta.set(p.shopKey, meta);
  }

  /* ── 2. 归集：分类 → 规格键 → 店铺 → 单元格 ── */
  const byCat = new Map<string, Map<string, Map<string, MatrixCell>>>();
  const labels = new Map<string, string>();
  /** 规格始终没认出来的行：UI 上要明确标出来，不能假装是正常对比 */
  const degenerateKeys = new Set<string>();
  /** 被细化过的行 → 它原本的粗键，UI 拿来做次级标注 */
  const refinedKeys = new Map<string, string>();

  for (const p of products) {
    if (!p.skus?.length) continue;

    for (const sku of p.skus) {
      if (!Number.isFinite(sku.price) || sku.price <= 0) continue;
      const spec = resolved.get(sku);
      if (!spec) continue;

      const { catId, specKey, coarseKey, refined, degenerate } = spec;
      const cellTs = sku.updatedAt || p.updatedAt;
      const labelKey = `${catId}::${specKey}`;
      if (!labels.has(labelKey)) {
        labels.set(labelKey, degenerate ? p.title.slice(0, 18) : spec.label);
        if (refined) refinedKeys.set(labelKey, coarseKey);
      }
      if (degenerate) degenerateKeys.add(labelKey);

      let bucket = byCat.get(catId);
      if (!bucket) {
        bucket = new Map();
        byCat.set(catId, bucket);
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

  /* ── 3. 定列：只保留真正出现在对比行里的店铺 ── */
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

  /* ── 4. 出行：按分类顺序，组内按规格键排序 ── */
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
        groupKey: refinedKeys.get(`${catId}::${specKey}`),
        degenerate: degenerateKeys.has(`${catId}::${specKey}`),
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
    // 细化行的 specKey 是归一化全文（"套餐一4kg灭火器1具灭火器箱1个"），
    // compareSpecKey 从里面解不出数值，只能按文本码点排 ——
    // 所以先按「能从标签里认出的数值规格」分组，同组再按文本排。
    rows.sort((a, b) => {
      const ka = buildSpecKey(a.specLabel || a.specKey);
      const kb = buildSpecKey(b.specLabel || b.specKey);
      const c = compareSpecKey(ka, kb);
      if (c !== 0) return c;
      return (a.specLabel || a.specKey).localeCompare(b.specLabel || b.specKey, 'zh-Hans-CN');
    });

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
