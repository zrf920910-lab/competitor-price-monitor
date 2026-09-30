#!/usr/bin/env node
/**
 * 本地抓取代理 —— 让 PWA 拥有「在线抓取」般的体验
 *
 * 在你自己电脑上跑一个小服务，PWA 里的「抓取」请求会直接发到这里，
 * 由本地浏览器（复用你的淘宝登录态）去抓，不受 Vercel 机房 IP 风控影响。
 *
 * 用法：
 *   npm run agent                    # 启动（默认 http://localhost:7788）
 *   npm run agent -- --port=8888     # 换端口
 *   npm run agent -- --headless      # 无头模式（需先登录过）
 *   npm run agent -- --channel=chrome  # 用系统 Chrome（免下载内核）
 *   npm run agent -- --reset         # 清除登录态后启动
 *
 * 首次运行会打开浏览器，请扫码登录淘宝。登录态保存在 .playwright-profile/。
 * 启动后回到 PWA 的「数据」页，会自动检测到「本地抓取已连接」。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PROFILE_DIR,
  checkLogin,
  extractItemId,
  gotoLogin,
  importPlaywright,
  launchContext,
  resolveProfileDir,
  scrapeOnPage,
} from './lib/taobao.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VERSION = '1.0.0';

/* ---------------- 参数 ---------------- */

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PORT = Number(getArg('port', '7788'));
const HOST = getArg('host', '127.0.0.1');
const HEADLESS = hasFlag('--headless');
const RESET = hasFlag('--reset');
const CHANNEL = getArg('channel', null);
const PROFILE_DIR = resolveProfileDir(ROOT, getArg('profile', DEFAULT_PROFILE_DIR));

const log = (...a) => console.log(...a);

/* ---------------- 浏览器管理 ---------------- */

const browser = {
  context: null,
  page: null,
  starting: null,
  playwright: null,
  playwrightChecked: false,
  lastError: null,
};

async function getPlaywright() {
  if (!browser.playwrightChecked) {
    browser.playwright = await importPlaywright();
    browser.playwrightChecked = true;
  }
  return browser.playwright;
}

async function ensureBrowser() {
  if (browser.context) return browser;

  if (!browser.starting) {
    browser.starting = (async () => {
      const pw = await getPlaywright();
      if (!pw) {
        throw new Error(
          '未安装 playwright。请在项目目录执行：npm i -D playwright && npx playwright install chromium'
        );
      }
      const { context, page } = await launchContext(pw, {
        profileDir: PROFILE_DIR,
        headless: HEADLESS,
        channel: CHANNEL,
      });
      context.on('close', () => {
        browser.context = null;
        browser.page = null;
        log('⚠️  浏览器已关闭，下次抓取会自动重新启动');
      });
      browser.context = context;
      browser.page = page;
      browser.lastError = null;
      log(`🌐 浏览器已启动（${HEADLESS ? '无头' : '有头'}模式）`);
      return browser;
    })().finally(() => {
      browser.starting = null;
    });
  }

  return browser.starting;
}

async function loginStatus() {
  if (!browser.context) return { logged: false, browserRunning: false };
  try {
    const { logged } = await checkLogin(browser.context);
    return { logged, browserRunning: true };
  } catch {
    return { logged: false, browserRunning: true };
  }
}

/* ---------------- 抓取队列（串行，降低风控概率） ---------------- */

let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

let stats = { scraped: 0, failed: 0, startedAt: Date.now() };

/* ---------------- HTTP ---------------- */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  // Chrome Private Network Access：公网 HTTPS 页面访问 localhost 需要这个头
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

const STATUS_PAGE = (info) => `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>本地抓取代理</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font: 15px/1.6 -apple-system, "PingFang SC", system-ui, sans-serif;
         background:#f6f7f9; color:#1f2530; padding:24px; }
  .card { width:100%; max-width:520px; background:#fff; border-radius:20px; padding:28px;
          box-shadow:0 8px 32px rgba(31,37,48,.08); }
  h1 { font-size:19px; margin:0 0 4px; display:flex; align-items:center; gap:9px; }
  .dot { width:9px; height:9px; border-radius:50%; background:${info.ok ? '#2f9e44' : '#e5484d'};
         box-shadow:0 0 0 4px ${info.ok ? '#2f9e4422' : '#e5484d22'}; }
  .sub { color:#64748b; font-size:13px; margin:0 0 20px; }
  .row { display:flex; justify-content:space-between; padding:11px 0; border-top:1px solid #eceef2;
         font-size:14px; }
  .row span:first-child { color:#64748b; }
  .row span:last-child { font-weight:600; }
  code { background:#f6f7f9; padding:2px 7px; border-radius:6px; font-size:12.5px;
         font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .hint { margin-top:20px; padding:13px 15px; background:#eef4ff; border-radius:12px;
          font-size:12.5px; line-height:1.7; color:#1d3290; }
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>本地抓取代理 ${info.ok ? '运行中' : '异常'}</h1>
  <p class="sub">版本 ${VERSION} · 端口 ${PORT}</p>
  <div class="row"><span>Playwright</span><span>${info.playwright ? '已安装' : '未安装'}</span></div>
  <div class="row"><span>浏览器</span><span>${info.browserRunning ? '运行中' : '未启动'}</span></div>
  <div class="row"><span>淘宝登录态</span><span>${info.logged ? '✓ 已登录' : '未登录'}</span></div>
  <div class="row"><span>累计抓取</span><span>${stats.scraped} 成功 / ${stats.failed} 失败</span></div>
  <div class="hint">
    回到 PWA 的「数据」页，会自动识别到本地代理。<br>
    若显示未登录，重启代理时会自动打开淘宝登录页。
  </div>
</div></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    /* 状态页 */
    if (req.method === 'GET' && url.pathname === '/') {
      const { logged, browserRunning } = await loginStatus();
      const html = STATUS_PAGE({
        ok: !!browser.playwright,
        playwright: !!browser.playwright,
        browserRunning,
        logged,
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    /* 健康检查 —— PWA 用它探测代理 */
    if (req.method === 'GET' && url.pathname === '/health') {
      const { logged, browserRunning } = await loginStatus();
      sendJson(res, 200, {
        ok: true,
        service: 'cpm-local-agent',
        version: VERSION,
        playwright: !!browser.playwright,
        browserRunning,
        loggedIn: logged,
        stats: { scraped: stats.scraped, failed: stats.failed, uptimeMs: Date.now() - stats.startedAt },
      });
      return;
    }

    /* 抓取单个商品 */
    if (req.method === 'POST' && url.pathname === '/scrape') {
      const body = await readJson(req);
      const target = String(body.url ?? body.itemId ?? '').trim();
      if (!target) {
        sendJson(res, 400, { ok: false, error: '缺少 url 或 itemId' });
        return;
      }
      if (!extractItemId(target)) {
        sendJson(res, 400, { ok: false, error: '无法从链接中识别商品 ID，请确认是淘宝/天猫商品链接' });
        return;
      }

      const pw = await getPlaywright();
      if (!pw) {
        sendJson(res, 503, {
          ok: false,
          error: '本地代理未安装 playwright',
          hint: '请在项目目录执行：npm i -D playwright && npx playwright install chromium',
        });
        return;
      }

      const result = await enqueue(async () => {
        const { page } = await ensureBrowser();

        // 未登录就没必要浪费一次页面加载
        const { logged } = await checkLogin(browser.context);
        if (!logged) {
          if (!HEADLESS) {
            await gotoLogin(page);
            throw new Error('淘宝未登录 —— 已在浏览器中打开登录页，请扫码后重试');
          }
          throw new Error('淘宝未登录 —— 请去掉 --headless 启动代理，扫码登录后再试');
        }

        return scrapeOnPage(page, target, { source: 'script' });
      });

      if (result.error && result.skus.length === 0) {
        stats.failed += 1;
        sendJson(res, 200, { ok: false, error: result.error, result });
        return;
      }
      stats.scraped += 1;
      sendJson(res, 200, { ok: true, result });
      return;
    }

    /* 打开登录窗口 */
    if (req.method === 'POST' && url.pathname === '/open-login') {
      const { page } = await ensureBrowser();
      await gotoLogin(page);
      if (page.context().pages().length === 0) await page.reload().catch(() => {});
      sendJson(res, 200, { ok: true, message: '已打开淘宝登录页，请在浏览器窗口中扫码登录' });
      return;
    }

    /* 清除登录态 */
    if (req.method === 'POST' && url.pathname === '/reset-login') {
      if (browser.context) {
        await browser.context.close().catch(() => {});
        browser.context = null;
        browser.page = null;
      }
      if (fs.existsSync(PROFILE_DIR)) {
        fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      }
      sendJson(res, 200, { ok: true, message: '登录态已清除，下次抓取会重新打开登录页' });
      return;
    }

    sendJson(res, 404, { ok: false, error: `未知路径 ${url.pathname}` });
  } catch (e) {
    browser.lastError = e.message;
    sendJson(res, 500, { ok: false, error: e.message ?? '代理内部错误' });
  }
});

/* ---------------- 启动 ---------------- */

async function main() {
  const pw = await getPlaywright();

  if (RESET) {
    if (fs.existsSync(PROFILE_DIR)) {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      log('已清除登录态');
    }
  }

  log('');
  log('  ╭──────────────────────────────────────────────╮');
  log('  │  🦾  竞品价格监控 · 本地抓取代理              │');
  log('  ╰──────────────────────────────────────────────╯');
  log('');

  if (!pw) {
    log('  ⚠️  未检测到 playwright，代理会启动但无法抓取。');
    log('     请先安装：');
    log('       npm i -D playwright');
    log('       npx playwright install chromium');
    log('');
  }

  server.listen(PORT, HOST, async () => {
    log(`  ✓ 服务已启动   http://localhost:${PORT}`);
    log(`  ✓ 状态页       http://localhost:${PORT}/`);
    log('');

    if (pw) {
      log('  正在启动浏览器…');
      try {
        const { page } = await ensureBrowser();
        const login = await checkLogin(browser.context);
        if (login.logged) {
          log(`  ✓ 淘宝登录态有效${login.nickname ? `（${login.nickname}）` : ''}，可以开始抓取`);
        } else {
          log('  ⚠️  未检测到淘宝登录态');
          if (!HEADLESS) {
            log('     已打开登录页，请扫码登录（登录后无需重启）');
            await gotoLogin(page);
          } else {
            log('     无头模式无法扫码，请去掉 --headless 重新启动以完成登录');
          }
        }
      } catch (e) {
        log(`  ✗ 浏览器启动失败：${e.message}`);
      }
    }

    log('');
    log('  ────────────────────────────────────────────────');
    log('  现在打开 PWA 的「数据」页，会自动识别到本地代理。');
    log('  按 Ctrl+C 停止。');
    log('  ────────────────────────────────────────────────');
    log('');
  });
}

async function shutdown() {
  log('\n正在关闭…');
  try {
    await browser.context?.close();
  } catch {
    /* ignore */
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((e) => {
  console.error('启动失败：', e);
  process.exit(1);
});
