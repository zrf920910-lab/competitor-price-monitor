#!/bin/bash
# ─────────────────────────────────────────────
#  竞品价格监控 · 本地抓取代理
#
#  双击本文件即可启动（macOS）。
#  首次运行会弹出浏览器，请扫码登录淘宝。
#  启动后回到 PWA 的「数据」页，会自动识别。
#
#  关闭窗口即停止代理。
# ─────────────────────────────────────────────

cd "$(dirname "$0")" || exit 1

echo ""
echo "  ╭──────────────────────────────────────────╮"
echo "  │   🦾  竞品价格监控 · 本地抓取代理         │"
echo "  ╰──────────────────────────────────────────╯"
echo ""

pause_and_exit() {
  echo ""
  read -n 1 -s -r -p "  按任意键关闭窗口…"
  echo ""
  exit "$1"
}

# ── 检查 Node.js ──
if ! command -v node >/dev/null 2>&1; then
  echo "  ❌ 未找到 Node.js"
  echo "     请先安装：https://nodejs.org"
  pause_and_exit 1
fi

echo "  ✓ Node.js $(node -v)"

# ── 检查依赖 ──
if [ ! -d node_modules ]; then
  echo ""
  echo "  📦 首次运行，正在安装依赖（约 1 分钟）…"
  echo ""
  if ! npm install; then
    echo ""
    echo "  ❌ 依赖安装失败，请检查网络后重试"
    pause_and_exit 1
  fi
fi

# ── 检查 Playwright ──
if [ ! -d node_modules/playwright ]; then
  echo ""
  echo "  📦 正在安装 playwright…"
  npm install -D playwright --no-audit --no-fund || true
fi

# ── 浏览器内核：有系统 Chrome 就不下载 ──
EXTRA_ARGS=""
if [ -d "$HOME/Library/Caches/ms-playwright" ] && ls "$HOME/Library/Caches/ms-playwright" 2>/dev/null | grep -q "^chromium-"; then
  echo "  ✓ 已检测到 Chromium 内核"
elif [ -d "/Applications/Google Chrome.app" ]; then
  echo "  ✓ 检测到系统 Chrome，使用 --channel=chrome（免下载内核）"
  EXTRA_ARGS="--channel=chrome"
else
  echo ""
  echo "  📦 未检测到浏览器内核，正在下载 Chromium（约 180MB）…"
  npx playwright install chromium
fi

echo ""
echo "  ────────────────────────────────────────────"
echo ""

# shellcheck disable=SC2086
npm run agent -- $EXTRA_ARGS

echo ""
echo "  代理已停止。"
pause_and_exit 0
