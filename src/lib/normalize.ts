/** 文本归一化与 SKU 规格签名提取 */

/** 全角 → 半角 */
export function toHalfWidth(input: string): string {
  return String(input ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 通用文本归一化：全角转半角、去零宽字符、压缩空白、小写 */
export function normalizeText(input: string): string {
  return toHalfWidth(input)
    .toLowerCase()
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/[·・‧]/g, ' ')
    .replace(/[，,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 单位别名 → 标准单位 + 换算系数（换算到标准单位） */
const UNIT_ALIASES: Array<{ re: RegExp; unit: string; factor: number }> = [
  { re: /^(千克|公斤|kg|kgs|kilogram|kilograms)$/i, unit: 'kg', factor: 1 },
  { re: /^(毫克|mg|milligram|milligrams)$/i, unit: 'g', factor: 0.001 },
  { re: /^(克|g|gram|grams)$/i, unit: 'g', factor: 1 },
  { re: /^(毫升|ml|milliliter|milliliters)$/i, unit: 'ml', factor: 1 },
  { re: /^(升|l|liter|liters|litre|litres)$/i, unit: 'l', factor: 1 },
  { re: /^(米|m|meter|meters)$/i, unit: 'm', factor: 1 },
  { re: /^(厘米|cm|centimeter)$/i, unit: 'cm', factor: 1 },
  { re: /^(毫米|mm|millimeter)$/i, unit: 'mm', factor: 1 },
  { re: /^(英寸|寸|inch|in)$/i, unit: 'in', factor: 1 },
  { re: /^(磅|lb|lbs|pound|pounds)$/i, unit: 'lb', factor: 1 },
  { re: /^(瓦|w|watt|watts)$/i, unit: 'w', factor: 1 },
  { re: /^(伏|v|volt|volts)$/i, unit: 'v', factor: 1 },
  { re: /^(毫安时|mah)$/i, unit: 'mah', factor: 1 },
  { re: /^(安时|ah)$/i, unit: 'ah', factor: 1 },
  { re: /^(毫安|ma)$/i, unit: 'ma', factor: 1 },
  { re: /^(安|a|ampere)$/i, unit: 'a', factor: 1 },
];

/** 匹配「数值 + 单位」的规格片段 */
const SPEC_TOKEN_RE =
  /(\d+(?:\.\d+)?)\s*(千克|公斤|kgs|kg|毫克|mg|克|g|毫升|ml|升|l|厘米|cm|毫米|mm|英寸|寸|米|m|磅|lbs|lb|瓦|w|伏|v|毫安时|mah|安时|ah|毫安|ma|安|a)/gi;

/** 数量后缀：*2 / ×2 / x2 / 2只装 / 2件套 */
const QTY_STAR_RE = /[*×xX]\s*(\d{1,3})\s*(?=$|[\s)）]|装|只|个|支|件|套|片|包|盒|瓶|袋|卷|张)/;
const QTY_SUFFIX_RE = /(\d{1,3})\s*(?:只|个|支|件|套|片|包|盒|瓶|袋|卷|张)\s*(?:装|组|套)?/;

export interface SpecToken {
  /** 换算后的数值 */
  value: number;
  /** 标准单位 */
  unit: string;
  /** 原始片段 */
  raw: string;
}

/** 从文本中抽取所有「数值 + 单位」规格 */
export function extractSpecTokens(input: string): SpecToken[] {
  const text = normalizeText(input);
  const out: SpecToken[] = [];
  SPEC_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPEC_TOKEN_RE.exec(text)) !== null) {
    const num = parseFloat(m[1]);
    const rawUnit = m[2];
    const alias = UNIT_ALIASES.find((a) => a.re.test(rawUnit));
    if (!alias || !Number.isFinite(num)) continue;
    const value = num * alias.factor;
    out.push({ value, unit: alias.unit, raw: m[0].trim() });
  }
  return out;
}

/** 抽取数量（组合装） */
export function extractQuantity(input: string): number | null {
  const text = normalizeText(input);
  const star = text.match(QTY_STAR_RE);
  if (star) {
    const n = parseInt(star[1], 10);
    if (n > 1 && n <= 999) return n;
  }
  const suffix = text.match(QTY_SUFFIX_RE);
  if (suffix) {
    const n = parseInt(suffix[1], 10);
    if (n > 1 && n <= 999) return n;
  }
  return null;
}

const formatNum = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r).replace(/0+$/, '').replace(/\.$/, '');
};

/**
 * 生成规格签名 —— 跨店对齐的核心。
 * 规则：主规格（数值+单位）升序拼接 + 数量后缀。
 * 例：
 *   "4KG 手提式干粉灭火器"        → "4kg"
 *   "4公斤 灭火器 2只装"          → "4kg*2"
 *   "500ML 水基灭火器"            → "500ml"
 *   "8kg 推车式"                  → "8kg"
 */
export function buildSpecKey(input: string): string {
  const tokens = extractSpecTokens(input);
  const qty = extractQuantity(input);

  let base: string;
  if (tokens.length === 0) {
    // 没有数值规格：退化为清洗后的文本骨架（去掉常见噪音词）
    base = normalizeText(input)
      .replace(/[a-z0-9]+/g, ' ')
      .replace(/\s+/g, '')
      .slice(0, 12);
    if (!base) base = normalizeText(input).slice(0, 12) || 'unknown';
  } else {
    // 按单位分组取最大数值（同一单位出现多次时取最大，通常主规格更大）
    const byUnit = new Map<string, number>();
    for (const t of tokens) {
      const prev = byUnit.get(t.unit);
      if (prev === undefined || t.value > prev) byUnit.set(t.unit, t.value);
    }
    // 单位排序：容量/重量优先
    const ORDER = ['kg', 'g', 'l', 'ml', 'm', 'cm', 'mm', 'in', 'lb', 'w', 'v', 'ah', 'mah', 'a', 'ma'];
    base = [...byUnit.entries()]
      .sort((a, b) => {
        const ia = ORDER.indexOf(a[0]);
        const ib = ORDER.indexOf(b[0]);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return b[1] - a[1];
      })
      .map(([unit, value]) => `${formatNum(value)}${unit}`)
      .join('+');
  }

  return qty ? `${base}*${qty}` : base;
}

/** 生成规格的可读标签 */
export function buildSpecLabel(specText: string): string {
  const tokens = extractSpecTokens(specText);
  const qty = extractQuantity(specText);
  if (tokens.length === 0) return specText.trim().slice(0, 24) || '默认规格';
  const ORDER = ['kg', 'g', 'l', 'ml', 'm', 'cm', 'mm', 'in', 'lb', 'w', 'v', 'ah', 'mah', 'a', 'ma'];
  const byUnit = new Map<string, number>();
  for (const t of tokens) {
    const prev = byUnit.get(t.unit);
    if (prev === undefined || t.value > prev) byUnit.set(t.unit, t.value);
  }
  const label = [...byUnit.entries()]
    .sort((a, b) => {
      const ia = ORDER.indexOf(a[0]);
      const ib = ORDER.indexOf(b[0]);
      if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return b[1] - a[1];
    })
    .map(([unit, value]) => `${formatNum(value)}${unit.toUpperCase()}`)
    .join(' + ');
  return qty && qty > 1 ? `${label} × ${qty}` : label;
}

/** 店铺名归一化 → 店铺键 */
export function buildShopKey(shopName: string): string {
  const n = normalizeText(shopName)
    .replace(/(旗舰店|专营店|专卖店|官方店|企业店|直营店|自营店|店)$/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s\-_·]+/g, '');
  return n || normalizeText(shopName) || 'unknown-shop';
}

/** 从淘宝 / 天猫链接提取商品 ID */
export function extractItemId(url: string): string | null {
  const s = toHalfWidth(String(url ?? '')).trim();
  if (!s) return null;

  // 纯数字 ID
  if (/^\d{6,20}$/.test(s)) return s;

  // 淘口令 €xxxx€ / ￥xxxx￥ 中通常不含 ID，交由短链解析
  const patterns = [
    /[?&](?:id|itemId|item_id)=(\d{6,20})/i,
    /item\.(?:taobao|tmall)\.com\/item\.htm\?[^#]*?\bid=(\d{6,20})/i,
    /detail\.(?:tmall|taobao)\.com\/item\.htm\?[^#]*?\bid=(\d{6,20})/i,
    /\/(\d{9,20})\.htm/i,
    /\/(\d{9,20})(?:\?|$)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

/** 是否淘宝系短链（需要跟随重定向） */
export function isShortLink(url: string): boolean {
  const s = toHalfWidth(String(url ?? '')).trim();
  return /(m\.tb\.cn|tb\.cn|e\.tb\.cn|s\.click\.taobao\.com|m\.tmall\.com\/h\.)/i.test(s);
}

/** 从任意文本中找出所有淘宝链接 */
export function extractUrls(text: string): string[] {
  const s = toHalfWidth(String(text ?? ''));
  const found = s.match(/https?:\/\/[^\s"'<>）)】]+/gi) ?? [];
  const cleaned = found.map((u) => u.replace(/[，。；、,.);]+$/, ''));
  return Array.from(new Set(cleaned));
}
