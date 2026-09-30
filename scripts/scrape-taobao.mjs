#!/usr/bin/env node
/**
 * 淘宝 / 天猫 SKU 价格抓取（命令行批量模式）
 *
 * 日常单点抓取建议用 `npm run agent` 启动本地代理，直接在 PWA 里点抓取。
 * 本脚本适合一次性批量抓很多链接。
 *
 * 用法：
 *   node scripts/scrape-taobao.mjs                       # 抓取 data/urls.txt
 *   node scripts/scrape-taobao.mjs --headless            # 无头模式（需已登录过）
 *   node scripts/scrape-taobao.mjs --urls=a.txt          # 指定链接文件
 *   node scripts/scrape-taobao.mjs --from-backup=b.json  # 从备份 JSON 取链接
 *   node scripts/scrape-taobao.mjs --reset               # 清除登录态，重新登录
 *
 * 输出：data/scrape-result.json —— 在 PWA 的「数据」页导入即可
 *
 * 首次运行会打开浏览器，请扫码登录淘宝；登录态保存在 .playwright-profile/。
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PROFILE_DIR,
  checkLogin,
  extractItemId,
  extractUrlsFromText,
  gotoLogin,
  importPlaywright,
  launchContext,
  resolveProfileDir,
  scrapeOnPage,
} from './lib/taobao.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

/* ---------------- 参数 ---------------- */

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const HEADLESS = hasFlag('--headless');
const RESET = hasFlag('--reset');
const CHANNEL = getArg('channel', null);
const URLS_FILE = path.resolve(ROOT, getArg('urls', 'data/urls.txt'));
const OUT_FILE = path.resolve(ROOT, getArg('out', 'data/scrape-result.json'));
const FROM_BACKUP = getArg('from-backup', null);
const DELAY_MIN = Number(getArg('delay-min', '1500'));
const DELAY_MAX = Number(getArg('delay-max', '3000'));
const PROFILE_DIR = resolveProfileDir(ROOT, getArg('profile', DEFAULT_PROFILE_DIR));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a));
const log = (...a) => console.log(...a);

/* ---------------- 链接收集 ---------------- */

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

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const playwright = await importPlaywright();
  if (!playwright) {
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
    console.error('\n❌ 没有找到待抓取链接。\n');
    console.error(`   请把淘宝商品链接写进：${path.relative(ROOT, URLS_FILE)}（一行一个）`);
    console.error('   或使用：node scripts/scrape-taobao.mjs --from-backup=data/备份.json\n');
    process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  log(`\n🦾 竞品价格抓取 · 共 ${urls.length} 个商品`);
  log(`   链接文件：${path.relative(ROOT, URLS_FILE)}`);
  log(`   输出文件：${path.relative(ROOT, OUT_FILE)}`);
  log(`   模式：${HEADLESS ? '无头' : '有头（可见浏览器）'}\n`);

  const { context, page } = await launchContext(playwright, {
    profileDir: PROFILE_DIR,
    headless: HEADLESS,
    channel: CHANNEL,
  });

  if (!HEADLESS) {
    log('🔐 正在检查登录状态…');
    await page.goto('https://www.taobao.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
    const login = await checkLogin(context);
    if (!login.logged) {
      log('\n⚠️  未检测到登录态。');
      log('   浏览器已打开，请扫码登录淘宝，登录完成后回到终端按回车继续…\n');
      await gotoLogin(page);
      await waitForEnter('   登录完成后按回车继续 > ');
    } else {
      log(`✓ 已登录${login.nickname ? `（${login.nickname}）` : ''}\n`);
    }
  }

  const results = [];
  let okCount = 0;

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    process.stdout.write(`[${i + 1}/${urls.length}] ${extractItemId(url)} 抓取中… `);

    const result = await scrapeOnPage(page, url, { source: 'script' });
    results.push(result);

    if (result.skus.length > 0) {
      okCount += 1;
      console.log(`✓ ${result.skus.length} 个 SKU · ${result.shopName}`);
    } else {
      console.log(`✗ ${result.error ?? '失败'}`);
    }

    if (i < urls.length - 1) await sleep(rand(DELAY_MIN, DELAY_MAX));
  }

  await context.close();

  // 合并历史结果（同 itemId 用新结果覆盖，保留清单外的旧数据）
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
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`  成功 ${okCount}/${urls.length} 个商品 · 共 ${skuTotal} 个 SKU`);
  log(`  输出：${path.relative(ROOT, OUT_FILE)}（累计 ${merged.length} 个商品）`);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('\n下一步：打开 PWA 的「数据」页，选择该 JSON 文件导入。\n');
}

main().catch((e) => {
  console.error('\n❌ 运行出错：', e);
  process.exit(1);
});
