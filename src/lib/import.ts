/** 导入解析：JSON 包 / CSV / Excel 粘贴 / 脚本输出 */

import type { ImportBundle, ProductRecord, ScrapeResult } from './types';
import { buildShopKey, buildSpecKey, buildSpecLabel, extractItemId, normalizeText } from './normalize';

/* ---------------- CSV ---------------- */

/**
 * 32 位字符串哈希（base36）。
 * 用来把「内容」映射成稳定 id —— 同一份内容每次导入都必须得到同一个 id，
 * 否则价格历史会断裂，涨跌也就无从计算。
 */
function hash36(input: string): string {
  const s = normalizeText(input);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * 由分组键派生商品 id。
 *
 * 不能带 `grouped.size` 之类的序号：同一批数据换个行序，
 * 序号就变了，id 跟着变，历史全部接不上。
 */
function stableProductId(groupKey: string): string {
  const slug = groupKey.replace(/[^\w\u4e00-\u9fa5]/g, '').slice(0, 32);
  return `imp-${slug}-${hash36(groupKey)}`;
}

/**
 * 由规格文本派生稳定的 SKU id。
 *
 * 不能用数组下标（`-s0`/`-s1`）：同一商品两次导入若规格顺序或数量变化，
 * id 就会错位，价格历史随之断裂。
 */
function stableSkuId(productId: string, specText: string, taken: Set<string>): string {
  const base = `${productId}-s${hash36(specText)}`;
  let id = base;
  let n = 1;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** 解析 CSV 文本（支持引号包裹、双引号转义、CRLF） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // 忽略，等 \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** 解析制表符分隔（从 Excel / 网页表格直接粘贴） */
export function parseTsv(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.split('\t').map((v) => v.trim()));
}

/* ---------------- 列名识别 ---------------- */

const COLUMN_ALIASES: Record<string, string[]> = {
  title: ['标题', '商品名', '商品名称', '商品', '宝贝名称', 'name', 'title', 'product'],
  url: ['链接', '商品链接', '网址', 'url', 'link', '地址'],
  shop: ['店铺', '店铺名', '店名', '商家', 'shop', 'store', '卖家'],
  spec: ['规格', '规格名', 'sku', 'sku名称', '属性', '款式', '型号', 'spec', 'variant'],
  price: ['价格', '售价', '现价', '单价', 'price', '到手价'],
  originalPrice: ['原价', '划线价', '市场价', '原price', 'originalprice', 'listprice'],
  stock: ['库存', 'stock', 'qty', '数量'],
  sold: ['销量', '已售', '月销', 'sold', 'sales'],
  category: ['分类', '类别', '品类', 'category', 'group'],
};

function detectColumns(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const norm = header.map((h) => normalizeText(h).replace(/\s/g, ''));
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = norm.findIndex((h) => h && aliases.some((a) => h === normalizeText(a) || h.includes(normalizeText(a))));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

const num = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const m = String(v).replace(/[^\d.]/g, '');
  const n = parseFloat(m);
  return Number.isFinite(n) ? n : undefined;
};

/* ---------------- 表格 → 商品 ---------------- */

export interface ParseTableResult {
  products: ProductRecord[];
  warnings: string[];
  detected: string[];
}

/** 把二维表格转成商品记录（自动按 商品/店铺 聚合 SKU） */
export function tableToProducts(rows: string[][], hasHeader = true): ParseTableResult {
  const warnings: string[] = [];
  if (rows.length === 0) return { products: [], warnings: ['没有可解析的数据行'], detected: [] };

  let header: string[] = [];
  let dataRows: string[][] = rows;

  if (hasHeader) {
    header = rows[0];
    dataRows = rows.slice(1);
  } else {
    // 无表头：按常见顺序猜测 店铺/标题/规格/价格
    header = ['店铺', '标题', '规格', '价格'];
  }

  const cols = detectColumns(header);
  const detected = Object.keys(cols);

  if (cols.price === undefined) {
    warnings.push('未识别到「价格」列，请检查表头是否包含 价格/售价/单价。');
    return { products: [], warnings, detected };
  }

  const grouped = new Map<string, ProductRecord>();
  const usedSkuIds = new Map<string, Set<string>>();
  const now = Date.now();

  for (const r of dataRows) {
    const price = num(r[cols.price]);
    if (price === undefined || price <= 0) continue;

    const title = (cols.title !== undefined ? r[cols.title] : '') || '';
    const url = (cols.url !== undefined ? r[cols.url] : '') || '';
    const shopName = (cols.shop !== undefined ? r[cols.shop] : '') || '未知店铺';
    const specText = (cols.spec !== undefined ? r[cols.spec] : '') || '默认规格';
    const itemId = extractItemId(url) ?? '';

    const groupKey = itemId || `${normalizeText(shopName)}::${normalizeText(title)}`;
    let product = grouped.get(groupKey);
    if (!product) {
      product = {
        id: stableProductId(groupKey),
        itemId,
        shopName,
        shopKey: buildShopKey(shopName),
        title: title || '(未命名商品)',
        url,
        manualCategoryId: null,
        autoCategoryId: null,
        skus: [],
        status: 'ok',
        source: 'paste',
        createdAt: now,
        updatedAt: now,
        lastSyncAt: now,
      };
      grouped.set(groupKey, product);
      usedSkuIds.set(groupKey, new Set());
    }

    const taken = usedSkuIds.get(groupKey)!;
    product.skus.push({
      id: stableSkuId(product.id, specText, taken),
      specText,
      specKey: buildSpecKey(specText),
      specLabel: buildSpecLabel(specText),
      price,
      originalPrice: num(cols.originalPrice !== undefined ? r[cols.originalPrice] : undefined),
      stock: num(cols.stock !== undefined ? r[cols.stock] : undefined),
      sold: num(cols.sold !== undefined ? r[cols.sold] : undefined),
      updatedAt: now,
    });
  }

  if (grouped.size === 0) warnings.push('没有解析出有效行（价格为空或格式不对）。');

  return { products: [...grouped.values()], warnings, detected };
}

/* ---------------- JSON ---------------- */

function looksLikeBundle(v: unknown): v is ImportBundle {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o.products) || Array.isArray(o.results) || Array.isArray(o.categories);
}

function looksLikeScrapeResults(v: unknown): v is ScrapeResult[] {
  return Array.isArray(v) && v.length > 0 && typeof (v[0] as ScrapeResult)?.skus !== 'undefined';
}

export interface ParseJsonResult {
  bundle?: ImportBundle;
  warnings: string[];
}

/** 解析 JSON：支持完整导出包、脚本输出数组、单个抓取结果 */
export function parseJson(text: string): ParseJsonResult {
  const warnings: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { warnings: ['JSON 解析失败，请检查内容是否完整。'] };
  }

  if (looksLikeBundle(data)) {
    return { bundle: data as ImportBundle, warnings };
  }

  if (looksLikeScrapeResults(data)) {
    return { bundle: { version: 1, exportedAt: Date.now(), results: data }, warnings };
  }

  const single = data as ScrapeResult;
  if (single && typeof single === 'object' && Array.isArray(single.skus)) {
    return { bundle: { version: 1, exportedAt: Date.now(), results: [single] }, warnings };
  }

  return { warnings: ['JSON 结构无法识别：需要是导出包、抓取结果数组或单个抓取结果。'] };
}

/** 自动识别格式并解析 */
export function autoParse(text: string): {
  bundle: ImportBundle;
  warnings: string[];
  detected: string[];
} {
  const trimmed = text.trim();
  if (!trimmed) return { bundle: { version: 1, exportedAt: Date.now() }, warnings: ['内容为空'], detected: [] };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const { bundle, warnings } = parseJson(trimmed);
    return { bundle: bundle ?? { version: 1, exportedAt: Date.now() }, warnings, detected: ['JSON'] };
  }

  const isTsv = trimmed.includes('\t');
  const rows = isTsv ? parseTsv(trimmed) : parseCsv(trimmed);
  const { products, warnings, detected } = tableToProducts(rows, true);
  return {
    bundle: { version: 1, exportedAt: Date.now(), products },
    warnings,
    detected: [...detected, isTsv ? 'TSV' : 'CSV'],
  };
}
