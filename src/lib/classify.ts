/** 自动分类引擎 */

import type { CategoryRecord, ProductRecord } from './types';
import { normalizeText } from './normalize';

/** 拼接用于匹配的文本：标题 + 店铺 + 全部 SKU 规格 */
export function productMatchText(p: ProductRecord): string {
  const parts = [p.title, p.shopName, ...(p.skus ?? []).map((s) => s.specText)];
  return normalizeText(parts.filter(Boolean).join(' '));
}

/** 按规则匹配分类（按 priority 降序，同优先级按 order） */
export function matchCategory(text: string, cats: CategoryRecord[]): CategoryRecord | null {
  const sorted = [...cats].sort((a, b) => b.priority - a.priority || a.order - b.order);
  for (const c of sorted) {
    const excludes = (c.excludes ?? []).map(normalizeText).filter(Boolean);
    if (excludes.some((e) => text.includes(e))) continue;

    const patterns = (c.patterns ?? []).map(normalizeText).filter(Boolean);
    if (patterns.length === 0) continue;

    const hit =
      c.matchMode === 'all'
        ? patterns.every((p) => text.includes(p))
        : patterns.some((p) => text.includes(p));

    if (hit) return c;
  }
  return null;
}

export function classifyProduct(p: ProductRecord, cats: CategoryRecord[]): CategoryRecord | null {
  return matchCategory(productMatchText(p), cats);
}

/** 最终生效的分类：手动 > 自动 */
export function resolveCategoryId(p: ProductRecord): string | null {
  return p.manualCategoryId ?? p.autoCategoryId ?? null;
}

/* ---------------- 分类建议 ---------------- */

/** 行业品类词表（消防为主 + 通用电商后缀） */
const NOUN_HINTS = [
  '灭火器箱', '灭火器', '灭火毯', '灭火剂', '灭火弹',
  '二氧化碳', '干粉', '水基', '气溶胶', '泡沫', '洁净气体',
  '消防水带', '水带', '水枪', '消火栓', '消防栓', '接口', '卷盘', '喷淋', '喷头',
  '消防泵', '稳压泵', '水泵接合器',
  '应急灯', '应急照明', '疏散指示', '安全出口', '指示灯', '标识牌', '指示牌',
  '烟感', '感烟', '感温', '探测器', '报警器', '主机', '手报', '声光',
  '防毒面具', '呼吸器', '滤毒', '正压式', '空气呼吸器',
  '消防服', '阻燃服', '头盔', '消防靴', '手套', '消防斧', '撬棒', '消防锹',
  '防火门', '闭门器', '防火卷帘', '防火板', '防火涂料',
  '警戒带', '反光背心', '安全帽', '安全带', '绝缘',
  '工具箱', '支架', '挂钩', '底座',
];

export interface CategorySuggestion {
  name: string;
  count: number;
  productIds: string[];
  /** 示例标题 */
  samples: string[];
}

/**
 * 从一批商品中提取品类词，生成分类建议。
 * 只统计未被任何分类命中的商品（即"未分类"的那些）。
 */
export function suggestCategories(products: ProductRecord[], limit = 12): CategorySuggestion[] {
  const map = new Map<string, CategorySuggestion>();

  for (const p of products) {
    const text = normalizeText(`${p.title} ${(p.skus ?? []).map((s) => s.specText).join(' ')}`);
    const seen = new Set<string>();
    // 长词优先，避免 "灭火器" 与 "灭火器箱" 同时计数
    const hints = [...NOUN_HINTS].sort((a, b) => b.length - a.length);
    for (const hint of hints) {
      if (!text.includes(normalizeText(hint))) continue;
      if (seen.has(hint)) continue;
      // 已被更长词覆盖则跳过
      if ([...seen].some((s) => s.includes(hint))) continue;
      seen.add(hint);

      const cur = map.get(hint) ?? { name: hint, count: 0, productIds: [], samples: [] };
      cur.count += 1;
      cur.productIds.push(p.id);
      if (cur.samples.length < 3 && p.title) cur.samples.push(p.title.slice(0, 40));
      map.set(hint, cur);
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

/* ---------------- 默认规则 ---------------- */

export const DEFAULT_CATEGORY_COLORS = [
  '#e5484d', '#f76808', '#f5a524', '#2f9e44', '#0ca678',
  '#0ea5e9', '#3765f5', '#8b5cf6', '#d6409f', '#64748b',
];

export interface SeedCategory {
  name: string;
  patterns: string[];
  excludes?: string[];
  priority?: number;
}

/** 消防器材行业的默认分类规则（可自由增删改） */
export const SEED_CATEGORIES: SeedCategory[] = [
  { name: '干粉灭火器', patterns: ['干粉', 'ABC', 'MFZ'], excludes: ['箱'], priority: 60 },
  { name: '二氧化碳灭火器', patterns: ['二氧化碳', 'CO2', 'MT'], priority: 60 },
  { name: '水基灭火器', patterns: ['水基', '泡沫灭火', 'MSZ', '水系'], priority: 60 },
  { name: '灭火器箱', patterns: ['灭火器箱', '消防箱', '器材箱'], priority: 70 },
  { name: '灭火毯', patterns: ['灭火毯', '灭火布'], priority: 60 },
  { name: '消防水带', patterns: ['水带'], priority: 55 },
  { name: '水枪接口', patterns: ['水枪', '接口', '消火栓', '消防栓', '卷盘'], priority: 50 },
  { name: '应急照明', patterns: ['应急灯', '应急照明', '疏散指示', '安全出口', '指示灯'], priority: 55 },
  { name: '火灾报警', patterns: ['烟感', '感烟', '感温', '探测器', '报警器', '手报', '声光'], priority: 55 },
  { name: '呼吸防护', patterns: ['面具', '呼吸器', '滤毒', '正压式'], priority: 55 },
  { name: '消防服装', patterns: ['消防服', '阻燃服', '消防靴', '消防头盔'], priority: 50 },
  { name: '消防工具', patterns: ['消防斧', '撬棒', '消防锹', '工具箱'], priority: 45 },
];
