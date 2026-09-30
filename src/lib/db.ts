/** IndexedDB 数据层（Dexie）—— 所有数据都存在浏览器本地，无需后端 */

import Dexie, { type Table } from 'dexie';
import type {
  CategoryRecord,
  ImportBundle,
  ProductRecord,
  ScrapeResult,
  SettingRecord,
  ShopRecord,
  SkuRecord,
  SnapshotRecord,
} from './types';
import {
  DEFAULT_CATEGORY_COLORS,
  SEED_CATEGORIES,
  classifyProduct,
} from './classify';
import { buildShopKey, buildSpecKey, buildSpecLabel } from './normalize';

export const DB_NAME = 'cpm-db';

class CpmDatabase extends Dexie {
  products!: Table<ProductRecord, string>;
  categories!: Table<CategoryRecord, string>;
  shops!: Table<ShopRecord, string>;
  snapshots!: Table<SnapshotRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({
      products: 'id, itemId, shopKey, manualCategoryId, autoCategoryId, status, updatedAt, lastSyncAt',
      categories: 'id, name, priority, order',
      shops: 'id, key, name',
      snapshots: 'id, productId, skuId, specKey, ts',
      settings: 'key',
    });
  }
}

let _db: CpmDatabase | null = null;

export function getDb(): CpmDatabase {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB 仅在浏览器环境可用');
  }
  if (!_db) _db = new CpmDatabase();
  return _db;
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ---------------- 商品 ---------------- */

export async function listProducts(): Promise<ProductRecord[]> {
  const db = getDb();
  const rows = await db.products.toArray();
  return rows.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProduct(id: string): Promise<ProductRecord | undefined> {
  return getDb().products.get(id);
}

export interface UpsertProductInput {
  itemId?: string;
  title: string;
  url: string;
  shopName?: string;
  cover?: string;
  skus?: Array<Partial<SkuRecord> & { specText: string; price: number }>;
  source?: ProductRecord['source'];
  note?: string;
}

/** 归一化一个 SKU 输入 */
function normalizeSku(input: Partial<SkuRecord> & { specText: string; price: number }): SkuRecord {
  const specText = String(input.specText ?? '').trim() || '默认规格';
  const specKey = input.specKey || buildSpecKey(specText);
  return {
    id: input.id || uid(),
    specText,
    specKey,
    specLabel: input.specLabel || buildSpecLabel(specText),
    price: Number(input.price) || 0,
    originalPrice: input.originalPrice ? Number(input.originalPrice) : undefined,
    stock: typeof input.stock === 'number' ? input.stock : undefined,
    sold: typeof input.sold === 'number' ? input.sold : undefined,
    image: input.image,
    updatedAt: input.updatedAt ?? Date.now(),
    manualSpecKey: input.manualSpecKey,
  };
}

/**
 * 新增或更新商品。
 * 若已存在同一 itemId 的商品，则合并：保留旧 SKU 的手动 specKey 覆盖与 id。
 */
export async function upsertProduct(input: UpsertProductInput): Promise<ProductRecord> {
  const db = getDb();
  const now = Date.now();
  const shopName = input.shopName?.trim() || '未知店铺';
  const shopKey = buildShopKey(shopName);

  const existing = input.itemId
    ? await db.products.where('itemId').equals(input.itemId).first()
    : undefined;

  const incoming = (input.skus ?? []).map(normalizeSku);

  let skus: SkuRecord[];
  if (existing && existing.skus?.length) {
    const prevByKey = new Map(existing.skus.map((s) => [s.specText, s]));
    const used = new Set<string>();
    skus = incoming.map((s) => {
      const prev = prevByKey.get(s.specText);
      if (!prev) return s;
      used.add(s.specText);
      return { ...s, id: prev.id, manualSpecKey: prev.manualSpecKey };
    });
    // 保留旧数据中本次未返回的 SKU（避免抓取不全导致丢数据）
    for (const s of existing.skus) {
      if (!used.has(s.specText)) skus.push(s);
    }
  } else {
    skus = incoming;
  }

  const record: ProductRecord = {
    id: existing?.id ?? uid(),
    itemId: input.itemId ?? existing?.itemId ?? '',
    shopName,
    shopKey,
    title: input.title?.trim() || existing?.title || '(未命名商品)',
    url: input.url?.trim() || existing?.url || '',
    cover: input.cover ?? existing?.cover,
    manualCategoryId: existing?.manualCategoryId ?? null,
    autoCategoryId: existing?.autoCategoryId ?? null,
    skus,
    status: skus.length > 0 ? 'ok' : 'idle',
    error: undefined,
    lastSyncAt: skus.length > 0 ? now : existing?.lastSyncAt,
    lastAttemptAt: now,
    source: input.source ?? existing?.source ?? 'manual',
    note: input.note ?? existing?.note,
    tags: existing?.tags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db.products.put(record);

  // 店铺表
  if (!existing || existing.shopName !== shopName) {
    await ensureShop(shopName);
  }

  // 记录价格快照
  if (skus.length) {
    const ts = now;
    await db.snapshots.bulkPut(
      skus
        .filter((s) => s.price > 0)
        .map((s) => ({
          id: `${record.id}:${s.id}:${ts}`,
          productId: record.id,
          skuId: s.id,
          specKey: s.manualSpecKey || s.specKey,
          price: s.price,
          ts,
        }))
    );
  }

  await reclassifyOne(record.id);
  return (await db.products.get(record.id))!;
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<ProductRecord, 'id' | 'skus'>>
): Promise<void> {
  await getDb().products.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteProduct(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.products, db.snapshots, async () => {
    await db.products.delete(id);
    await db.snapshots.where('productId').equals(id).delete();
  });
}

export async function bulkDeleteProducts(ids: string[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.products, db.snapshots, async () => {
    await db.products.bulkDelete(ids);
    for (const id of ids) await db.snapshots.where('productId').equals(id).delete();
  });
}

/** 批量导入抓取结果 */
export async function importScrapeResults(results: ScrapeResult[]): Promise<number> {
  let n = 0;
  for (const r of results) {
    if (r.error && (!r.skus || r.skus.length === 0)) {
      // 失败也落库，标记错误，便于追踪
      const db = getDb();
      const existing = r.itemId ? await db.products.where('itemId').equals(r.itemId).first() : undefined;
      if (existing) {
        await db.products.update(existing.id, {
          status: 'error',
          error: r.error,
          lastAttemptAt: Date.now(),
          updatedAt: Date.now(),
        });
        n += 1;
      }
      continue;
    }
    await upsertProduct({
      itemId: r.itemId,
      title: r.title,
      url: r.url,
      shopName: r.shopName,
      cover: r.cover,
      skus: r.skus,
      source: r.source,
    });
    n += 1;
  }
  return n;
}

/* ---------------- SKU 手动调整 ---------------- */

export async function updateSku(
  productId: string,
  skuId: string,
  patch: Partial<SkuRecord>
): Promise<void> {
  const db = getDb();
  const product = await db.products.get(productId);
  if (!product) return;
  const skus = product.skus.map((s) => (s.id === skuId ? { ...s, ...patch } : s));
  await db.products.update(productId, { skus, updatedAt: Date.now() });
}

export async function deleteSku(productId: string, skuId: string): Promise<void> {
  const db = getDb();
  const product = await db.products.get(productId);
  if (!product) return;
  const skus = product.skus.filter((s) => s.id !== skuId);
  await db.products.update(productId, {
    skus,
    status: skus.length ? product.status : 'idle',
    updatedAt: Date.now(),
  });
}

/** 手动对齐：把一个 SKU 归入指定规格键 */
export async function alignSku(productId: string, skuId: string, manualSpecKey: string): Promise<void> {
  await updateSku(productId, skuId, { manualSpecKey: manualSpecKey.trim() || undefined });
}

/* ---------------- 分类 ---------------- */

export async function listCategories(): Promise<CategoryRecord[]> {
  const rows = await getDb().categories.toArray();
  return rows.sort((a, b) => a.order - b.order || b.priority - a.priority);
}

export async function createCategory(input: Partial<CategoryRecord> & { name: string }): Promise<CategoryRecord> {
  const db = getDb();
  const all = await db.categories.toArray();
  const record: CategoryRecord = {
    id: input.id ?? uid(),
    name: input.name.trim(),
    color: input.color ?? DEFAULT_CATEGORY_COLORS[all.length % DEFAULT_CATEGORY_COLORS.length],
    patterns: input.patterns ?? [],
    excludes: input.excludes ?? [],
    matchMode: input.matchMode ?? 'any',
    priority: input.priority ?? 50,
    order: input.order ?? all.length,
    createdAt: Date.now(),
  };
  await db.categories.put(record);
  return record;
}

export async function updateCategory(id: string, patch: Partial<CategoryRecord>): Promise<void> {
  await getDb().categories.update(id, patch);
}

export async function deleteCategory(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.categories, db.products, async () => {
    await db.categories.delete(id);
    const affected = await db.products
      .filter((p) => p.manualCategoryId === id || p.autoCategoryId === id)
      .toArray();
    for (const p of affected) {
      await db.products.update(p.id, {
        manualCategoryId: p.manualCategoryId === id ? null : p.manualCategoryId,
        autoCategoryId: p.autoCategoryId === id ? null : p.autoCategoryId,
      });
    }
  });
}

/** 用规则引擎重算单个商品的自动分类 */
export async function reclassifyOne(productId: string): Promise<void> {
  const db = getDb();
  const [product, categories] = await Promise.all([
    db.products.get(productId),
    db.categories.toArray(),
  ]);
  if (!product) return;
  const hit = classifyProduct(product, categories);
  const next = hit?.id ?? null;
  if (product.autoCategoryId !== next) {
    await db.products.update(productId, { autoCategoryId: next });
  }
}

/** 全量重算自动分类，返回受影响数量 */
export async function reclassifyAll(): Promise<number> {
  const db = getDb();
  const [products, categories] = await Promise.all([
    db.products.toArray(),
    db.categories.toArray(),
  ]);
  let changed = 0;
  await db.transaction('rw', db.products, async () => {
    for (const p of products) {
      const hit = classifyProduct(p, categories);
      const next = hit?.id ?? null;
      if (p.autoCategoryId !== next) {
        await db.products.update(p.id, { autoCategoryId: next });
        changed += 1;
      }
    }
  });
  return changed;
}

/* ---------------- 店铺 ---------------- */

export async function listShops(): Promise<ShopRecord[]> {
  const rows = await getDb().shops.toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function ensureShop(name: string): Promise<ShopRecord> {
  const db = getDb();
  const key = buildShopKey(name);
  const existing = await db.shops.where('key').equals(key).first();
  if (existing) return existing;
  const all = await db.shops.toArray();
  const record: ShopRecord = {
    id: uid(),
    key,
    name: name.trim() || key,
    color: DEFAULT_CATEGORY_COLORS[all.length % DEFAULT_CATEGORY_COLORS.length],
    createdAt: Date.now(),
  };
  await db.shops.put(record);
  return record;
}

export async function updateShop(id: string, patch: Partial<ShopRecord>): Promise<void> {
  await getDb().shops.update(id, patch);
}

/** 删除店铺时一并删除其下商品 */
export async function deleteShop(id: string, cascade = true): Promise<void> {
  const db = getDb();
  const shop = await db.shops.get(id);
  if (!shop) return;
  await db.shops.delete(id);
  if (cascade) {
    const items = await db.products.where('shopKey').equals(shop.key).toArray();
    await bulkDeleteProducts(items.map((p) => p.id));
  }
}

/* ---------------- 快照 ---------------- */

export async function listSnapshots(productId: string, limit = 500): Promise<SnapshotRecord[]> {
  const rows = await getDb().snapshots.where('productId').equals(productId).toArray();
  return rows.sort((a, b) => a.ts - b.ts).slice(-limit);
}

export async function listAllSnapshots(): Promise<SnapshotRecord[]> {
  return getDb().snapshots.toArray();
}

/** 清理超过 N 天的快照 */
export async function pruneSnapshots(days = 180): Promise<number> {
  const db = getDb();
  const cutoff = Date.now() - days * 86400_000;
  return db.snapshots.where('ts').below(cutoff).delete();
}

/* ---------------- 设置 ---------------- */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await getDb().settings.get(key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb().settings.put({ key, value });
}

/* ---------------- 导入 / 导出 ---------------- */

export async function exportBundle(): Promise<ImportBundle> {
  const db = getDb();
  const [products, categories, shops] = await Promise.all([
    db.products.toArray(),
    db.categories.toArray(),
    db.shops.toArray(),
  ]);
  return { version: 1, exportedAt: Date.now(), products, categories, shops };
}

export interface ImportOptions {
  products?: boolean;
  categories?: boolean;
  shops?: boolean;
  /** 已存在的商品是覆盖还是跳过 */
  onConflict?: 'merge' | 'skip';
}

export async function importBundle(bundle: ImportBundle, options: ImportOptions = {}) {
  const { products = true, categories = true, shops = true, onConflict = 'merge' } = options;
  const db = getDb();
  const stat = { categories: 0, shops: 0, products: 0, skipped: 0 };

  if (categories && bundle.categories?.length) {
    await db.categories.bulkPut(bundle.categories);
    stat.categories = bundle.categories.length;
  }

  if (shops && bundle.shops?.length) {
    for (const s of bundle.shops) {
      const existing = await db.shops.where('key').equals(s.key).first();
      if (existing) {
        await db.shops.update(existing.id, { name: s.name, alias: s.alias, color: s.color, note: s.note });
      } else {
        await db.shops.put(s);
      }
      stat.shops += 1;
    }
  }

  if (products && bundle.products?.length) {
    for (const p of bundle.products) {
      const existing = p.itemId
        ? await db.products.where('itemId').equals(p.itemId).first()
        : await db.products.get(p.id);
      if (existing && onConflict === 'skip') {
        stat.skipped += 1;
        continue;
      }
      await db.products.put({
        ...p,
        id: existing?.id ?? p.id,
        manualCategoryId: existing?.manualCategoryId ?? p.manualCategoryId ?? null,
        autoCategoryId: existing?.autoCategoryId ?? p.autoCategoryId ?? null,
      });
      stat.products += 1;
    }
  }

  if (bundle.results?.length) {
    stat.products += await importScrapeResults(bundle.results);
  }

  await reclassifyAll();
  return stat;
}

/** 清空所有数据 */
export async function clearAll(): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.products, db.categories, db.shops, db.snapshots, db.settings, async () => {
    await Promise.all([
      db.products.clear(),
      db.categories.clear(),
      db.shops.clear(),
      db.snapshots.clear(),
      db.settings.clear(),
    ]);
  });
}

/* ---------------- 初始化 ---------------- */

export async function seedDefaultCategories(): Promise<number> {
  const db = getDb();
  const count = await db.categories.count();
  if (count > 0) return 0;
  let i = 0;
  for (const seed of SEED_CATEGORIES) {
    await createCategory({
      name: seed.name,
      patterns: seed.patterns,
      excludes: seed.excludes ?? [],
      priority: seed.priority ?? 50,
      order: i,
      color: DEFAULT_CATEGORY_COLORS[i % DEFAULT_CATEGORY_COLORS.length],
    });
    i += 1;
  }
  return i;
}

export async function initDb(): Promise<void> {
  const db = getDb();
  await db.open();
  await seedDefaultCategories();
}
