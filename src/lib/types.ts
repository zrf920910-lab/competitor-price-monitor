/** 竞品价格监控 — 数据模型 */

/** 单个 SKU（规格） */
export interface SkuRecord {
  id: string;
  /** 淘宝原始规格文本，如 "4KG 手提式 干粉" */
  specText: string;
  /** 归一化规格签名，用于跨店对齐，如 "4kg" */
  specKey: string;
  /** 规格中的人可读标签 */
  specLabel: string;
  /** 当前价（元） */
  price: number;
  /** 划线原价 */
  originalPrice?: number;
  /** 库存（-1 表示未知） */
  stock?: number;
  /** 销量 */
  sold?: number;
  image?: string;
  /** 采集时间戳 */
  updatedAt: number;
  /** 手动锁定的规格键（用户手动对齐时写入，优先于自动计算） */
  manualSpecKey?: string;
}

/** 竞品商品 */
export interface ProductRecord {
  id: string;
  /** 淘宝/天猫商品 ID */
  itemId: string;
  /** 店铺名（展示用） */
  shopName: string;
  /** 店铺键（归一化，跨店对比的列标识） */
  shopKey: string;
  title: string;
  url: string;
  cover?: string;
  /** 手动指定的分类（优先级最高） */
  manualCategoryId?: string | null;
  /** 自动匹配到的分类 */
  autoCategoryId?: string | null;
  skus: SkuRecord[];
  status: 'idle' | 'ok' | 'error' | 'pending';
  error?: string;
  /** 最近一次成功同步时间 */
  lastSyncAt?: number;
  /** 最近一次尝试时间 */
  lastAttemptAt?: number;
  /** 采集来源 */
  source?: 'manual' | 'paste' | 'script' | 'api';
  note?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** 分类规则 */
export interface CategoryRecord {
  id: string;
  name: string;
  color: string;
  /** 命中任一即归类（matchMode = any） */
  patterns: string[];
  /** 命中任一则排除 */
  excludes: string[];
  /** 匹配模式 */
  matchMode: 'any' | 'all';
  /** 优先级，越大越先匹配 */
  priority: number;
  /** 展示排序 */
  order: number;
  /** 归一化基准规格键：该分类下用于对齐的规格模板 */
  specKeys?: string[];
  createdAt: number;
}

/** 店铺元信息 */
export interface ShopRecord {
  id: string;
  key: string;
  name: string;
  /** 展示别名 */
  alias?: string;
  color?: string;
  note?: string;
  createdAt: number;
}

/** 价格历史快照 */
export interface SnapshotRecord {
  id: string;
  productId: string;
  skuId: string;
  specKey: string;
  price: number;
  ts: number;
}

/** 键值设置 */
export interface SettingRecord {
  key: string;
  value: unknown;
}

/* ---------------- 对比视图类型 ---------------- */

export interface CompareCell {
  shopKey: string;
  shopName: string;
  productId: string;
  productTitle: string;
  skuId: string;
  skuSpecText: string;
  price: number;
  originalPrice?: number;
  stock?: number;
  sold?: number;
  url: string;
  updatedAt: number;
}

export interface CompareRow {
  id: string;
  categoryId: string | null;
  categoryName: string;
  specKey: string;
  specLabel: string;
  cells: CompareCell[];
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  /** 价差（最高 - 最低） */
  spread: number;
  /** 价差率 */
  spreadRate: number;
  /** 店铺数 */
  shopCount: number;
}

/** 抓取结果（脚本 / API 共用） */
export interface ScrapeResult {
  itemId: string;
  title: string;
  shopName: string;
  url: string;
  cover?: string;
  skus: Array<{
    specText: string;
    price: number;
    originalPrice?: number;
    stock?: number;
    sold?: number;
    image?: string;
  }>;
  scrapedAt: number;
  source: 'script' | 'api';
  error?: string;
}

/** 导入包格式 */
export interface ImportBundle {
  version: 1;
  exportedAt: number;
  products?: ProductRecord[];
  categories?: CategoryRecord[];
  shops?: ShopRecord[];
  /** 脚本抓取的原始结果 */
  results?: ScrapeResult[];
}
