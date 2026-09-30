#!/usr/bin/env node
/**
 * 淘宝 / 天猫 SKU 价格抓取脚本（本地运行，复用浏览器登录态）
 *
 * 用法：
 *   node scripts/scrape-taobao.mjs                  # 抓取 data/urls.txt 里的链接
 *   node scripts/scrape-taobao.mjs --headless       # 无头模式（需已登录过）
 *   node scripts/scrape-taobao.mjs --urls=a.txt     # 指定链接文件
 *   node scripts/scrape-taobao.mjs --from-backup=b.json  # 从备份 JSON 里取链接
 *   node scripts/scrape-taobao.mjs --reset          # 清除登录态，重新登录
 *
 * 输出：data/scrape-result.json —— 在 PWA 的「数据」页导入即可
 *
 * 首次运行会打开浏览器，请扫码登录淘宝；登录态保存在 .playwright-profile/。
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PROFILE_DIR = path.join(ROOT, '.playwright-profile');

/* ---------------- 参数 ---------------- */

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const HEADLESS = hasFlag('--headless');
const RESET = hasFlag('--reset');
const URLS_FILE = path.resolve(ROOT, getArg('urls', 'data/urls.txt'));
const OUT_FILE = path.resolve(ROOT, getArg('out', 'data/scrape-result.json'));
const FROM_BACKUP = getArg('from-backup', null);
const DELAY_MIN = Number(getArg('delay-min', '1500'));
const DELAY_MAX = Number(getArg('delay-max', '3000'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
const log = (...a) => console.log(...a);

/* ---------------- 链接解析 ---------------- */

function extractItemId(url) {
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

function extractUrlsFromText(text) {
  const found = String(text).match(/https?:\/\/[^\s"'<>）)】]+/gi) ?? [];
  return found.map((u) => u.replace(/[，。；、,.);]+$/, ''));
}

function loadUrls() {
  const set = new Set();

  if (FROM_BACKUP) {
    const p = path.resolve(ROOT, FROM_BACKUP);
    const bundle = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const prod of bundle.products ?? []) if (prod.url) set.add(prod.url);
    log(`从备份读取到 ${set.size} 个商品链接`);
  } else if (fs.existsSync(URLS_FILE)) {
    const raw = fs.readFileSync(URLS_FILE, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      if (t.includes('http')) extractUrlsFromText(t).forEach((u) => set.add(u));
      else if (/^\d{6,20}$/.test(t)) set.add(t);
    }
  }

  return [...set].filter((u) => extractItemId(u));
}

/* ---------------- SKU 解析（与 src/lib/scrape/taobao-server.ts 保持一致） ---------------- */

function parseDetail(itemId, url, payload) {
  const pick = (obj, keys) => keys.reduce((cur, k) => (cur && typeof cur === 'object' ? cur[k] : undefined), obj);

  const title = String(pick(payload, ['item', 'title']) ?? '');
  const shopName = String(pick(payload, ['seller', 'shopName']) ?? pick(payload, ['seller', 'nick']) ?? '');
  const images = pick(payload, ['item', 'images']);
  const cover = Array.isArray(images) && images.length ? String(images[0]) : undefined;

  const skuBase = pick(payload, ['skuBase']) || {};
  const sku2info = pick(payload, ['skuCore', 'sku2info']) || {};

  const valueName = new Map();
  for (const prop of skuBase.props ?? []) {
    for (const v of prop.values ?? []) {
      if (prop.pid && v.vid) valueName.set(`${prop.pid}:${v.vid}`, String(v.name ?? ''));
    }
  }

  const skus = [];
  for (const sku of skuBase.skus ?? []) {
    const skuId = String(sku.skuId ?? '');
    const info = sku2info[skuId] ?? sku2info['0'] ?? sku2info['0;0'];
    const priceText = info?.price?.priceText;
    const priceMoney = info?.price?.priceMoney;
    let price = priceText !== undefined ? parseFloat(String(priceText).replace(/[^\d.]/g, '')) : NaN;
    if (!Number.isFinite(price) && typeof priceMoney === 'number') price = priceMoney / 100;
    if (!Number.isFinite(price) || price <= 0) continue;

    const specParts = String(sku.propPath ?? '')
      .split(';')
      .map((seg) => valueName.get(seg) ?? seg)
      .filter(Boolean);

    const qtyRaw = info?.quantity;
    const stock = qtyRaw !== undefined && qtyRaw !== null ? Number(qtyRaw) : undefined;
    const sub = info?.subPrice?.priceText;
    const originalPrice = sub !== undefined ? parseFloat(String(sub).replace(/[^\d.]/g, '')) : undefined;

    skus.push({
      specText: specParts.join(' ') || '默认规格',
      price,
      originalPrice: Number.isFinite(originalPrice) && originalPrice > price ? originalPrice : undefined,
      stock: Number.isFinite(stock) ? stock : undefined,
    });
  }

  if (skus.length === 0) {
    const priceText = pick(payload, ['item', 'price']);
    const price = priceText !== undefined ? parseFloat(String(priceText).replace(/[^\d.]/g, '')) : NaN;
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
    source: 'script',
    error: skus.length === 0 ? '未解析到 SKU 价格' : undefined,
  };
}

/* ---------------- 主流程 ---------------- */

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('\n❌ 未安装 playwright。请先执行：\n');
    console.error('   npm i -D playwright && npx playwright install chromium\n');
    process.exit(1);
  }

  if (RESET && fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    log('已清除登录态');
  }

  const urls = loadUrls();
  if (urls.length === 0) {
    console.error(`\n❌ 没有找到待抓取链接。\n`);
    console.error(`   请把淘宝商品链接写进：${path.relative(ROOT, URLS_FILE)}（一行一个）\n`);
    console.error(`   或使用：node scripts/scrape-taobao.mjs --from-backup=data/备份.json\n`);
    process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  log(`\n🦾 竞品价格抓取 · 共 ${urls.length} 个商品`);
  log(`   链接文件：${path.relative(ROOT, URLS_FILE)}`);
  log(`   输出文件：${path.relative(ROOT, OUT_FILE)}`);
  log(`   模式：${HEADLESS ? '无头' : '有头（可见浏览器）'}\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] ?? (await context.newPage());

  // 登录检测
  if (!HEADLESS) {
    log('🔐 正在检查登录状态…');
    await page.goto('https://www.taobao.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
    const cookies = await context.cookies('https://www.taobao.com');
    const logged = cookies.some((c) => c.name === 'cookie2' || c.name === '_nk_' || c.name === 'unb');
    if (!logged) {
      log('\n⚠️  未检测到登录态。');
      log('   浏览器已打开，请扫码登录淘宝，登录完成后回到终端按回车继续…\n');
      await page.goto('https://login.taobao.com/member/login.jhtml', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await waitForEnter('   登录完成后按回车继续 > ');
    } else {
      log('✓ 已登录\n');
    }
  }

  const results = [];
  let okCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const itemId = extractItemId(url);
    const label = `[${i + 1}/${urls.length}] ${itemId}`;
    process.stdout.write(`${label} 抓取中… `);

    const captured = [];

    const onResponse = async (res) => {
      const u = res.url();
      if (!/mtop\.taobao\.(detail|pcdetail)/.test(u)) return;
      try {
        captured.push(await res.json());
      } catch {
        /* 响应体不可读，忽略 */
      }
    };
    page.on('response', onResponse);

    try {
      const target = url.includes('http') ? url : `https://item.taobao.com/item.htm?id=${itemId}`;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // 等接口数据回来
      for (let w = 0; w < 12 && captured.length === 0; w++) await sleep(500);

      // 主动在页面上下文里调用一次接口（部分页面不会自动请求完整 SKU）
      if (captured.length === 0) {
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
      }

      let best = null;
      for (const env of captured) {
        const payload = env?.data?.data ?? env?.data ?? env;
        const skus = payload?.skuBase?.skus ?? [];
        if (skus.length > 0 && (!best || skus.length > (best?.skuBase?.skus?.length ?? 0))) best = payload;
      }

      if (best) {
        const parsed = parseDetail(itemId, target, best);
        if (parsed.skus.length > 0) {
          results.push(parsed);
          okCount += 1;
          console.log(`✓ ${parsed.skus.length} 个 SKU · ${parsed.shopName}`);
        } else {
          results.push({ ...parsed, error: '接口返回但未解析到价格' });
          console.log('✗ 未解析到价格');
        }
      } else {
        // 兜底：从页面里读标题和价格
        const fallback = await page
          .evaluate(() => {
            const t = document.querySelector('h1')?.textContent?.trim() ?? document.title;
            const priceEl = document.querySelector('[class*="priceText"], [class*="Price--"]');
            const price = priceEl?.textContent?.replace(/[^\d.]/g, '') ?? '';
            const shop = document.querySelector('[class*="ShopHeader"] [class*="name"], [class*="shopName"]')?.textContent?.trim() ?? '';
            return { title: t, price, shop };
          })
          .catch(() => ({ title: '', price: '', shop: '' }));

        const price = parseFloat(fallback.price);
        const rec = {
          itemId,
          title: fallback.title || '(未获取到标题)',
          shopName: fallback.shop || '未知店铺',
          url: target,
          skus: Number.isFinite(price) && price > 0 ? [{ specText: '默认规格', price }] : [],
          scrapedAt: Date.now(),
          source: 'script',
          error: Number.isFinite(price) && price > 0 ? undefined : '未捕获到 SKU 接口数据（可能需重新登录或该商品无 SKU）',
        };
        results.push(rec);
        if (rec.skus.length > 0) okCount += 1;
        console.log(rec.skus.length > 0 ? '✓ 从页面兜底读取到价格' : '✗ 失败');
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
      results.push({
        itemId,
        title: '',
        shopName: '',
        url,
        skus: [],
        scrapedAt: Date.now(),
        source: 'script',
        error: e.message,
      });
    } finally {
      page.off('response', onResponse);
    }

    if (i < urls.length - 1) await sleep(rand(DELAY_MIN, DELAY_MAX));
  }

  await context.close();

  // 合并已有结果（保留历史，用新结果覆盖同 itemId）
  let merged = results;
  if (fs.existsSync(OUT_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      const prevList = Array.isArray(prev) ? prev : [];
      const byId = new Map(prevList.map((r) => [r.itemId, r]));
      for (const r of results) byId.set(r.itemId, r);
      merged = [...byId.values()];
    } catch {
      /* 旧文件损坏，直接覆盖 */
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2), 'utf8');

  const skuTotal = results.reduce((s, r) => s + r.skus.length, 0);
  log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`  成功 ${okCount}/${urls.length} 个商品 · 共 ${skuTotal} 个 SKU`);
  log(`  输出：${path.relative(ROOT, OUT_FILE)}（累计 ${merged.length} 个商品）`);
  log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  log(`\n下一步：打开 PWA 的「数据」页，选择该 JSON 文件导入。\n`);
}

main().catch((e) => {
  console.error('\n❌ 运行出错：', e);
  process.exit(1);
});
