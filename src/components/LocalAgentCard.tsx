'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import {
  DEFAULT_AGENT_URL,
  agentOpenLogin,
  agentResetLogin,
  getAgentServerSnapshot,
  getAgentSnapshot,
  probeAgent,
  subscribeAgent,
} from '@/lib/local-agent';
import { getSetting, setSetting } from '@/lib/db';
import { useToast } from './Toast';

const INSTALL_CMD = 'npm i -D playwright && npx playwright install chromium';
const START_CMD = 'npm run agent';

function CodeLine({ cmd, onCopied }: { cmd: string; onCopied: (cmd: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCopied(cmd)}
      className="group flex w-full items-center gap-2 rounded-lg bg-ink-900 px-2.5 py-2 text-left transition hover:bg-ink-800"
    >
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] leading-5 text-brand-200">{cmd}</code>
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0 text-ink-500 transition group-hover:text-ink-300"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 012-2h10" />
      </svg>
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[12px]">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium text-ink-800">{children}</span>
    </div>
  );
}

export function LocalAgentCard() {
  const toast = useToast();
  const status = useSyncExternalStore(subscribeAgent, getAgentSnapshot, getAgentServerSnapshot);

  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [customUrlLoaded, setCustomUrlLoaded] = useState(false);

  // 读取自定义代理地址
  useEffect(() => {
    getSetting<string>('agentUrl', '')
      .then((v) => setCustomUrl(v ?? ''))
      .finally(() => setCustomUrlLoaded(true));
  }, []);

  // 首次探测 + 定时轮询（页面可见时才轮询）
  useEffect(() => {
    if (!customUrlLoaded) return;
    void probeAgent({ customUrl: customUrl || undefined });

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void probeAgent({ customUrl: customUrl || undefined, force: true });
      }
    }, 20_000);
    return () => clearInterval(timer);
  }, [customUrl, customUrlLoaded]);

  const recheck = useCallback(async () => {
    setChecking(true);
    const next = await probeAgent({ customUrl: customUrl || undefined, force: true });
    setChecking(false);
    toast(
      next.connected ? '已连接本地代理' : '未检测到本地代理，请确认已运行 npm run agent',
      next.connected ? 'success' : 'error'
    );
  }, [customUrl, toast]);

  const copy = useCallback(
    async (cmd: string) => {
      try {
        await navigator.clipboard.writeText(cmd);
        toast('命令已复制', 'success');
      } catch {
        toast('复制失败，请手动选中复制', 'error');
      }
    },
    [toast]
  );

  const handleOpenLogin = async () => {
    if (!status.baseUrl) return;
    setBusy(true);
    const r = await agentOpenLogin(status.baseUrl);
    setBusy(false);
    toast(r.ok ? '已打开淘宝登录页，请在弹出的浏览器中扫码' : `失败：${r.error}`, r.ok ? 'success' : 'error');
  };

  const handleResetLogin = async () => {
    if (!status.baseUrl) return;
    setBusy(true);
    const r = await agentResetLogin(status.baseUrl);
    setBusy(false);
    toast(r.ok ? '登录态已清除，下次抓取需重新扫码' : `失败：${r.error}`, r.ok ? 'success' : 'error');
    void probeAgent({ customUrl: customUrl || undefined, force: true });
  };

  const health = status.health;
  const connected = status.connected;

  return (
    <section className="card overflow-hidden">
      {/* 头部 */}
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 text-base">🔌</span>
          <div>
            <p className="text-[13px] font-semibold text-ink-900">本地抓取代理</p>
            <p className="mt-0.5 text-[11px] leading-5 text-ink-500">
              在电脑上跑一条命令，PWA 就能直接抓淘宝价格——复用你的登录态，不受机房风控影响
            </p>
          </div>
        </div>
        <span
          className={clsx(
            'chip shrink-0 gap-1.5',
            connected ? 'bg-down/10 text-down' : 'bg-ink-100 text-ink-500'
          )}
        >
          <span
            className={clsx(
              'h-1.5 w-1.5 rounded-full',
              connected ? 'bg-down' : 'bg-ink-400',
              checking && 'animate-pulse'
            )}
          />
          {checking ? '检测中' : connected ? '已连接' : '未连接'}
        </span>
      </div>

      {connected ? (
        <div className="border-t border-ink-100 px-4 py-2">
          <Row label="代理地址">
            <span className="font-mono text-[11px]">{status.baseUrl}</span>
          </Row>
          <Row label="Playwright">
            {health?.playwright ? (
              '已安装'
            ) : (
              <span className="text-up">未安装</span>
            )}
          </Row>
          <Row label="浏览器">
            {health?.browserRunning ? '运行中' : <span className="text-ink-400">未启动（首次抓取时启动）</span>}
          </Row>
          <Row label="淘宝登录态">
            {health?.loggedIn ? (
              <span className="text-down">✓ 已登录</span>
            ) : (
              <span className="text-up">未登录</span>
            )}
          </Row>
          {health?.stats ? (
            <Row label="本次累计">
              {health.stats.scraped} 成功
              {health.stats.failed > 0 ? <span className="text-up"> / {health.stats.failed} 失败</span> : null}
            </Row>
          ) : null}

          {!health?.playwright ? (
            <div className="mt-2 rounded-lg bg-up/10 px-2.5 py-2 text-[11px] leading-5 text-up ring-1 ring-up/20">
              代理已启动但缺少 playwright，无法抓取。请先安装：
              <div className="mt-1.5">
                <CodeLine cmd={INSTALL_CMD} onCopied={copy} />
              </div>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={handleOpenLogin} disabled={busy}>
              打开登录窗口
            </button>
            <button type="button" className="btn-outline btn-sm" onClick={recheck} disabled={checking}>
              重新检测
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={handleResetLogin} disabled={busy}>
              清除登录态
            </button>
          </div>

          <p className="mt-2.5 text-[10px] leading-4 text-ink-400">
            抓取时若提示未登录，点「打开登录窗口」扫码即可，登录后无需重启代理。
          </p>
        </div>
      ) : (
        <div className="border-t border-ink-100 px-4 py-3">
          <p className="text-[11px] font-medium text-ink-600">两步启动（只需在电脑上做一次）</p>

          <div className="mt-2.5 space-y-2.5">
            <div>
              <p className="mb-1 text-[11px] text-ink-500">
                <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-[9px] font-semibold text-white">
                  1
                </span>
                安装浏览器内核
              </p>
              <CodeLine cmd={INSTALL_CMD} onCopied={copy} />
            </div>

            <div>
              <p className="mb-1 text-[11px] text-ink-500">
                <span className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-ink-900 text-[9px] font-semibold text-white">
                  2
                </span>
                启动代理（保持窗口开着）
              </p>
              <CodeLine cmd={START_CMD} onCopied={copy} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary btn-sm" onClick={recheck} disabled={checking}>
              {checking ? '检测中…' : '我已启动，重新检测'}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              {showAdvanced ? '收起' : '高级'}
            </button>
          </div>

          {showAdvanced ? (
            <div className="mt-3 rounded-xl bg-ink-50 p-3 ring-1 ring-ink-100">
              <label className="label">自定义代理地址</label>
              <div className="flex gap-2">
                <input
                  className="input font-mono text-[11px]"
                  placeholder={DEFAULT_AGENT_URL}
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-outline btn-sm shrink-0"
                  onClick={async () => {
                    await setSetting('agentUrl', customUrl.trim());
                    toast('已保存，正在重新检测', 'info');
                    void probeAgent({ customUrl: customUrl.trim() || undefined, force: true });
                  }}
                >
                  保存
                </button>
              </div>
              <p className="mt-1.5 text-[10px] leading-4 text-ink-400">
                默认自动探测 {DEFAULT_AGENT_URL} 与 http://127.0.0.1:7788。改了端口就在这填完整地址。
              </p>
            </div>
          ) : null}

          <p className="mt-3 rounded-lg bg-brand-50 px-2.5 py-2 text-[10px] leading-4 text-brand-800 ring-1 ring-brand-100">
            连接成功后，在「添加链接」和「刷新价格」时就会自动走本地代理，抓取体验和在线一样。
          </p>
        </div>
      )}
    </section>
  );
}
