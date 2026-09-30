/**
 * 淘宝抓取核心 —— CLI 脚本（scrape-taobao.mjs）与本地代理（local-agent.mjs）共用
 *
 * 抓取策略（三级兜底）：
 *   1. 监听页面自身发出的 mtop.taobao.detail.getdetail 响应
 *   2. 在页面上下文里用 window.lib.mtop.request 主动补一次
 *   3. 从 DOM 读标题与价格
 */

import fs from 'node:fs';
import path from 'node:path';

export const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

/* ---------------- 链接处理 ---------------- */

export function extractItemId(url) {
  const s = String(url || '').trim();
  if (/^\d{6,20}$/.test(s)) return s;
  const patterns = [
    /[?&](?:id|itemId|item_id)=(\d{6,20})/i,
    /\/(\d{9,20})\.htm/i,
    /\/(\d{9,20})(?:\?|$)/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return null;
}

export function extractUrlsFromText(text) {
  const found = String(text).match(/https?:\/\/[^\s"'<>）)】]+/gi) ?? [];
  return found.map((u) => u.replace(/[，。；、,.);]+$/, ''));
}

export function toItemUrl(url) {
  const itemId = extractItemId(url);
  if (!itemId) return null;
  return String(url).includes('http') ? String(url).trim() : `https://item.taobao.com/item.htm?id=${itemId}`;
}

/* ---------------- 详情解析 ---------------- */

const pick = (obj, keys) => keys.reduce((cur, k) => (cur && typeof cur === 'object' ? cur[k] : undefined), obj);

const toPrice = (v) => {
  if (v === undefined || v === null) return NaN;
  return parseFloat(String(v).replace(/[^\d.]/g, ''));
};

/**
 * 解析 mtop detail 返回体 → 统一结果结构
 * @returns {{itemId,title,shopName,url,cover,skus,scrapedAt,source,error?}}
 */
export function parseDetail(itemId, url, payload, source = 'script') {
  const title = String(pick(payload, ['item', 'title']) ?? '');
  const shopName = String(pick(payload, ['seller', 'shopName']) ?? pick(payload, ['seller', 'nick']) ?? '');
  const images = pick(payload, ['item', 'images']);
  const cover = Array.isArray(images) && images.length ? String(images[0]) : undefined;

  const skuBase = pick(payload, ['skuBase']) || {};
  const sku2info = pick(payload, ['skuCore', 'sku2info']) || {};

  // "pid:vid" → 规格值名称
  const valueName = new Map();
  for (const prop of skuBase.props ?? []) {
    for (const v of prop.values ?? []) {
      if (prop.pid && v.vid) valueName.set(`${prop.pid}:${v.vid}`, String(v.name ?? ''));
    }
  }

  const skus = [];
  for (const sku of skuBase.skus ?? []) {
    const skuId = String(sku.skuId ?? '');
    // sku2info['0'] 是「商品起价」。多规格商品里某个 SKU 查不到价时，
    // 用起价冒充会写出错误数据 —— 所以只在单品兜底时允许。
    const info =
      sku2info[skuId] ??
      ((skuBase.skus ?? []).length === 1 ? (sku2info['0'] ?? sku2info['0;0']) : undefined);
    if (!info) continue;

    let price = toPrice(info?.price?.priceText);
    if (!Number.isFinite(price)) {
      // priceMoney 单位是「分」，且新版接口返回字符串（"7500"），不能只认 number
      const money = Number(info?.price?.priceMoney);
      if (Number.isFinite(money) && money > 0) price = money / 100;
    }
    if (!Number.isFinite(price) || price <= 0) continue;

    const specParts = String(sku.propPath ?? '')
      .split(';')
      .map((seg) => valueName.get(seg) ?? seg)
      .filter(Boolean);

    const qtyRaw = info?.quantity;
    const stock = qtyRaw !== undefined && qtyRaw !== null ? Number(qtyRaw) : undefined;

    let originalPrice = toPrice(info?.subPrice?.priceText);
    if (!Number.isFinite(originalPrice)) {
      const subMoney = Number(info?.subPrice?.priceMoney);
      if (Number.isFinite(subMoney) && subMoney > 0) originalPrice = subMoney / 100;
    }

    skus.push({
      specText: specParts.join(' ') || '默认规格',
      price,
      originalPrice:
        Number.isFinite(originalPrice) && originalPrice > price ? originalPrice : undefined,
      stock: Number.isFinite(stock) ? stock : undefined,
    });
  }

  // 无 SKU 维度时退回单品价
  if (skus.length === 0) {
    const price = toPrice(pick(payload, ['item', 'price']));
    if (Number.isFinite(price) && price > 0) skus.push({ specText: '默认规格', price });
  }

  return {
    itemId,
    title: title || '(未获取到标题)',
    shopName: shopName || '未知店铺',
    url,
    cover,
    skus,
    scrapedAt: Date.now(),
    source,
    error: skus.length === 0 ? '未解析到 SKU 价格' : undefined,
  };
}

/** 从任意 mtop 响应信封里取出 detail payload */
export function unwrapPayload(env) {
  return env?.data?.data ?? env?.data ?? env;
}

/**
 * 从页面全局变量里取详情数据 —— 新版淘宝 PC 详情页的主数据源。
 *
 * 2025 起 item.taobao.com 的详情页**不再请求** mtop.taobao.detail.getdetail，
 * 改为 SSR 把结果内联在 window.__ICE_APP_CONTEXT__ 里，
 * 路径 `loaderData.home.data.res`，其中 skuBase / skuCore 的结构与老接口一致，
 * 所以 parseDetail 可以直接复用。
 *
 * @returns {Promise<object|null>} 与 mtop payload 同构的对象
 */
export async function readDetailFromPage(page) {
  return page
    .evaluate(() => {
      const hasSkus = (o) => Array.isArray(o?.skuBase?.skus) && o.skuBase.skus.length > 0;

      const candidates = [
        globalThis.__ICE_APP_CONTEXT__?.loaderData?.home?.data?.res,
        globalThis.__ICE_APP_CONTEXT__?.loaderData?.home?.data,
        globalThis.__ICE_APP_CONTEXT__?.loaderData?.pcdetail?.data?.res,
        globalThis.__INITIAL_DATA__?.data?.res,
        globalThis.__INITIAL_DATA__?.data,
        globalThis.__detail_data__,
      ];

      let hit = candidates.find(hasSkus);

      // 兜底：扫一遍 window 顶层，找带 skuBase.skus 的对象
      if (!hit) {
        for (const k of Object.keys(globalThis)) {
          if (k === 'window' || k === 'self' || k === 'top' || k === 'parent' || k === 'globalThis') continue;
          let v;
          try {
            v = globalThis[k];
          } catch {
            continue;
          }
          if (v && typeof v === 'object' && hasSkus(v)) {
            hit = v;
            break;
          }
        }
      }
      if (!hit) return null;

      // 只回传需要的字段，避免把整个页面上下文序列化过去
      const num = (v) => (v === undefined || v === null ? undefined : String(v));
      const sku2info = {};
      for (const [k, v] of Object.entries(hit.skuCore?.sku2info ?? {})) {
        sku2info[k] = {
          price: { priceText: num(v?.price?.priceText), priceMoney: num(v?.price?.priceMoney) },
          subPrice: { priceText: num(v?.subPrice?.priceText), priceMoney: num(v?.subPrice?.priceMoney) },
          quantity: v?.quantity,
        };
      }

      return {
        item: {
          title: hit.item?.title,
          price: num(hit.item?.price),
          images: Array.isArray(hit.item?.images) ? hit.item.images.slice(0, 1) : undefined,
        },
        seller: { shopName: hit.seller?.shopName, nick: hit.seller?.nick },
        skuBase: {
          props: (hit.skuBase?.props ?? []).map((p) => ({
            pid: p.pid,
            name: p.name,
            values: (p.values ?? []).map((v) => ({ vid: v.vid, name: v.name })),
          })),
          skus: (hit.skuBase?.skus ?? []).map((s) => ({ skuId: s.skuId, propPath: s.propPath })),
        },
        skuCore: { sku2info },
      };
    })
    .catch(() => null);
}

/* ---------------- 浏览器 ---------------- */

export async function importPlaywright() {
  try {
    const mod = await import('playwright');
    return mod;
  } catch {
    return null;
  }
}

export const DEFAULT_PROFILE_DIR = '.playwright-profile';

export function resolveProfileDir(root, dir = DEFAULT_PROFILE_DIR) {
  return path.isAbsolute(dir) ? dir : path.join(root, dir);
}

/**
 * 启动持久化浏览器上下文。
 * 优先用 Playwright 自带的 Chromium；若未下载，自动回退到系统已安装的 Chrome，
 * 省去 130MB 的浏览器下载。
 * @param {{ profileDir: string, headless?: boolean, channel?: string }} opts
 */
export async function launchContext(playwright, { profileDir, headless = false, channel }) {
  fs.mkdirSync(profileDir, { recursive: true });

  const baseOptions = {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: [
      '--disable-blink-features=AutomationControlled',
      // 容器 / 受限沙箱环境需要关闭 sandbox 才能启动
      ...(process.env.PLAYWRIGHT_NO_SANDBOX === '1'
        ? ['--no-sandbox', '--disable-dev-shm-usage']
        : []),
    ],
  };

  // channel 显式指定时只用它；否则 chromium → chrome 依次尝试
  const attempts = channel ? [channel] : [undefined, 'chrome'];
  let lastError = null;

  for (const ch of attempts) {
    try {
      const context = await playwright.chromium.launchPersistentContext(profileDir, {
        ...baseOptions,
        ...(ch ? { channel: ch } : {}),
      });
      const page = context.pages()[0] ?? (await context.newPage());
      return { context, page, channel: ch ?? 'chromium' };
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(
    `浏览器启动失败：${lastError?.message ?? '未知错误'}\n` +
      '提示：执行 npx playwright install chromium 下载内核，或加 --channel=chrome 使用系统 Chrome。'
  );
}

/**
 * 检测淘宝登录态。
 * 注意：`cookie2` 是访客也会拿到的会话 cookie，不能作为登录依据；
 * 真正的登录标志是 `unb`（用户数字 ID）与 `_nk_`（昵称）。
 */
export async function checkLogin(context) {
  const cookies = await context.cookies('https://www.taobao.com');
  const unb = cookies.find((c) => c.name === 'unb' && c.value);
  const nk = cookies.find((c) => c.name === '_nk_' && c.value);

  let nickname;
  if (nk?.value) {
    try {
      nickname = decodeURIComponent(nk.value);
    } catch {
      nickname = nk.value;
    }
  }

  return {
    logged: Boolean(unb || nk),
    cookies,
    userId: unb?.value,
    nickname,
  };
}

export async function gotoLogin(page) {
  await page
    .goto('https://login.taobao.com/member/login.jhtml', { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
}

/* ---------------- 单商品抓取 ---------------- */

/** 从捕获到的 mtop 响应里挑 SKU 最全的一份 */
function pickBestPayload(captured) {
  let best = null;
  for (const env of captured) {
    const payload = unwrapPayload(env);
    const n = payload?.skuBase?.skus?.length ?? 0;
    if (n > 0 && n > (best?.skuBase?.skus?.length ?? 0)) best = payload;
  }
  return best;
}

/**
 * 在给定 page 上抓取一个商品
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<object>} ScrapeResult
 */
export async function scrapeOnPage(page, url, { source = 'script', waitMs = 12000 } = {}) {
  const itemId = extractItemId(url);
  const target = toItemUrl(url);
  if (!itemId || !target) {
    return {
      itemId: itemId ?? '',
      title: '',
      shopName: '',
      url,
      skus: [],
      scrapedAt: Date.now(),
      source,
      error: '无法从链接中识别商品 ID',
    };
  }

  const captured = [];
  const onResponse = async (res) => {
    if (!/mtop\.taobao\.(detail|pcdetail)/.test(res.url())) return;
    try {
      captured.push(await res.json());
    } catch {
      /* 响应体不可读，忽略 */
    }
  };

  page.on('response', onResponse);

  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // 两条数据源并行等，谁先到用谁：
    //   ① 新版 PC 详情页 —— SSR 数据内联在 window.__ICE_APP_CONTEXT__
    //   ② 老版 —— 页面自己发出的 mtop.taobao.detail.getdetail 响应
    const deadline = Date.now() + waitMs;
    let fromPage = null;
    let best = null;

    while (Date.now() < deadline) {
      fromPage = await readDetailFromPage(page);
      if (fromPage) break;

      best = pickBestPayload(captured);
      if (best) break;

      await page.waitForTimeout(400);
    }

    // 内联 SSR 数据最完整，优先
    if (fromPage) {
      const result = parseDetail(itemId, target, fromPage, source);
      if (result.skus.length > 0) return result;
    }

    // 老路径：页面内主动补一次 mtop 请求
    if (!best) {
      const manual = await page
        .evaluate(async (id) => {
          const mtop = globalThis.lib?.mtop || globalThis.mtop;
          if (!mtop?.request) return null;
          try {
            return await mtop.request({
              api: 'mtop.taobao.detail.getdetail',
              v: '6.0',
              type: 'json',
              dataType: 'json',
              data: { itemNumId: String(id) },
            });
          } catch (e) {
            return { __error: String(e) };
          }
        }, itemId)
        .catch(() => null);
      if (manual) captured.push(manual);
      best = pickBestPayload(captured);
    }

    if (best) {
      const result = parseDetail(itemId, target, best, source);
      if (result.skus.length > 0) return result;
    }

    // DOM 兜底
    const fallback = await page
      .evaluate(() => {
        const t = document.querySelector('h1')?.textContent?.trim() ?? document.title;
        const priceEl = document.querySelector('[class*="priceText"], [class*="Price--"]');
        const price = priceEl?.textContent?.replace(/[^\d.]/g, '') ?? '';
        const shop =
          document
            .querySelector('[class*="ShopHeader"] [class*="name"], [class*="shopName"]')
            ?.textContent?.trim() ?? '';
        return { title: t, price, shop };
      })
      .catch(() => ({ title: '', price: '', shop: '' }));

    const price = parseFloat(fallback.price);
    const hasPrice = Number.isFinite(price) && price > 0;
    return {
      itemId,
      title: fallback.title || '(未获取到标题)',
      shopName: fallback.shop || '未知店铺',
      url: target,
      // 明确标注这是「商品起价」而不是某个规格的价，避免在对比表里被当成真实规格
      skus: hasPrice ? [{ specText: '默认规格', price }] : [],
      scrapedAt: Date.now(),
      source,
      error: hasPrice
        ? '未解析到 SKU 明细，仅记录商品起价（页面结构可能已变化）'
        : '未捕获到 SKU 数据（可能需要重新登录）',
    };
  } catch (e) {
    return {
      itemId,
      title: '',
      shopName: '',
      url,
      skus: [],
      scrapedAt: Date.now(),
      source,
      error: e.message,
    };
  } finally {
    page.off('response', onResponse);
  }
}
