/** 服务端淘宝商品抓取（尽力而为，best-effort）
 *
 * 走手机端 H5 详情接口 mtop.taobao.detail.getdetail，需要 _m_h5_tk 签名。
 * 注意：淘宝对机房 IP 有严格风控，在 Vercel 上成功率不稳定，
 * 失败时前端会引导用户改用本地抓取脚本。
 */

import crypto from 'node:crypto';
import type { ScrapeResult } from '../types';

const APP_KEY = '12574478';
const API = 'mtop.taobao.detail.getdetail';
const API_VERSION = '6.0';
const H5_ENDPOINT = `https://h5api.m.taobao.com/h5/${API}/${API_VERSION}/`;

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

const md5 = (s: string) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

function buildUrl(token: string, t: string, data: string): string {
  const sign = md5(`${token}&${t}&${APP_KEY}&${data}`);
  const qs = new URLSearchParams({
    jsv: '2.6.1',
    appKey: APP_KEY,
    t,
    sign,
    api: API,
    v: API_VERSION,
    type: 'json',
    dataType: 'json',
    timeout: '10000',
    data,
  });
  return `${H5_ENDPOINT}?${qs.toString()}`;
}

interface MtopEnvelope {
  ret?: string[];
  data?: Record<string, unknown>;
}

/** 获取 _m_h5_tk token（首次请求必定失败，但会下发 cookie） */
async function acquireToken(itemId: string): Promise<{ token: string; cookie: string }> {
  const data = JSON.stringify({ itemNumId: itemId });
  const t = Date.now().toString();
  const res = await fetch(buildUrl('', t, data), {
    headers: {
      'User-Agent': UA,
      Referer: 'https://detail.m.tmall.com/',
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const cookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean);

  const jar = cookies.map((c) => c.split(';')[0]).join('; ');
  const match = jar.match(/_m_h5_tk=([^;_]+)/);
  if (!match) throw new Error('未能获取淘宝接口 token（可能已被风控拦截）');
  return { token: match[1], cookie: jar };
}

function pick(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** 从 mtop 返回结构中解析 SKU */
export function parseDetail(itemId: string, url: string, payload: Record<string, unknown>): ScrapeResult {
  const title = String(pick(payload, ['item', 'title']) ?? '');
  const shopName = String(pick(payload, ['seller', 'shopName']) ?? pick(payload, ['seller', 'nick']) ?? '');
  const images = pick(payload, ['item', 'images']);
  const cover = Array.isArray(images) && images.length ? String(images[0]) : undefined;

  const skuBase = pick(payload, ['skuBase']) as
    | { skus?: Array<{ skuId?: string; propPath?: string }>; props?: Array<{ pid?: string; name?: string; values?: Array<{ vid?: string; name?: string }> }> }
    | undefined;

  const sku2info = pick(payload, ['skuCore', 'sku2info']) as
    | Record<
        string,
        {
          // priceMoney 单位是「分」，接口有时返回字符串（"7500"）
          price?: { priceText?: string; priceMoney?: string | number };
          quantity?: string | number;
          subPrice?: { priceText?: string; priceMoney?: string | number };
        }
      >
    | undefined;

  // pid:vid → 名称
  const valueName = new Map<string, string>();
  for (const prop of skuBase?.props ?? []) {
    for (const v of prop.values ?? []) {
      if (prop.pid && v.vid) valueName.set(`${prop.pid}:${v.vid}`, String(v.name ?? ''));
    }
  }

  const skus: ScrapeResult['skus'] = [];

  for (const sku of skuBase?.skus ?? []) {
    const skuId = String(sku.skuId ?? '');
    // sku2info['0'] 是「商品起价」，多规格商品里不能拿它冒充某个 SKU 的价
    const info =
      sku2info?.[skuId] ??
      ((skuBase?.skus ?? []).length === 1 ? (sku2info?.['0'] ?? sku2info?.['0;0']) : undefined);
    if (!info) continue;

    let price =
      info.price?.priceText !== undefined
        ? parseFloat(String(info.price.priceText).replace(/[^\d.]/g, ''))
        : NaN;
    if (!Number.isFinite(price)) {
      // priceMoney 单位是「分」，且新版接口返回的是字符串（"7500"）
      const money = Number(info.price?.priceMoney);
      if (Number.isFinite(money) && money > 0) price = money / 100;
    }
    if (!Number.isFinite(price) || price <= 0) continue;

    const specParts = String(sku.propPath ?? '')
      .split(';')
      .map((seg) => valueName.get(seg) ?? seg)
      .filter(Boolean);

    const qtyRaw = info.quantity;
    const stock = qtyRaw !== undefined && qtyRaw !== null ? Number(qtyRaw) : undefined;

    let originalPrice =
      info.subPrice?.priceText !== undefined
        ? parseFloat(String(info.subPrice.priceText).replace(/[^\d.]/g, ''))
        : NaN;
    if (!Number.isFinite(originalPrice)) {
      const subMoney = Number(info.subPrice?.priceMoney);
      if (Number.isFinite(subMoney) && subMoney > 0) originalPrice = subMoney / 100;
    }

    skus.push({
      specText: specParts.join(' ') || '默认规格',
      price,
      originalPrice:
        Number.isFinite(originalPrice) && originalPrice > price ? originalPrice : undefined,
      stock: Number.isFinite(stock) ? (stock as number) : undefined,
    });
  }

  // 没有 SKU 维度时，退回单品价格
  if (skus.length === 0) {
    const priceText = pick(payload, ['item', 'price']);
    const price = priceText !== undefined ? parseFloat(String(priceText).replace(/[^\d.]/g, '')) : NaN;
    if (Number.isFinite(price) && price > 0) {
      skus.push({ specText: '默认规格', price });
    }
  }

  return {
    itemId,
    title: title || '(未获取到标题)',
    shopName: shopName || '未知店铺',
    url,
    cover,
    skus,
    scrapedAt: Date.now(),
    source: 'api',
    error: skus.length === 0 ? '接口返回中未解析到任何 SKU 价格（多为风控拦截）' : undefined,
  };
}

/** 主入口：抓取一个淘宝商品 */
export async function scrapeTaobaoItem(itemId: string, url: string): Promise<ScrapeResult> {
  try {
    const { token, cookie } = await acquireToken(itemId);
    const data = JSON.stringify({ itemNumId: itemId });
    const t = Date.now().toString();

    const res = await fetch(buildUrl(token, t, data), {
      headers: {
        'User-Agent': UA,
        Referer: `https://detail.m.tmall.com/item.htm?id=${itemId}`,
        Accept: 'application/json',
        Cookie: cookie,
      },
      cache: 'no-store',
    });

    const json = (await res.json()) as MtopEnvelope;
    const ret = json.ret?.[0] ?? '';
    if (!ret.startsWith('SUCCESS')) {
      return {
        itemId,
        title: '',
        shopName: '',
        url,
        skus: [],
        scrapedAt: Date.now(),
        source: 'api',
        error: `淘宝接口返回：${ret || '未知错误'}`,
      };
    }

    return parseDetail(itemId, url, (json.data ?? {}) as Record<string, unknown>);
  } catch (e) {
    return {
      itemId,
      title: '',
      shopName: '',
      url,
      skus: [],
      scrapedAt: Date.now(),
      source: 'api',
      error: e instanceof Error ? e.message : '抓取失败',
    };
  }
}
