'use client';

/**
 * 本地抓取代理客户端
 *
 * 在用户电脑上跑 `npm run agent` 后，PWA 会自动探测到 http://localhost:7788，
 * 抓取请求直接发给本地浏览器（复用淘宝登录态），不受机房 IP 风控影响。
 *
 * 说明：HTTPS 页面访问 http://localhost 属于浏览器认可的「可信来源」，
 * 不会被 Mixed Content 拦截；代理已配置 CORS 与 Private Network Access 头。
 */

import type { ScrapeResult } from './types';

export const DEFAULT_AGENT_URL = 'http://localhost:7788';
export const AGENT_CANDIDATES = ['http://localhost:7788', 'http://127.0.0.1:7788'];
const PROBE_TIMEOUT = 1600;
const CACHE_TTL = 20_000;

export interface AgentHealth {
  ok: boolean;
  service: string;
  version: string;
  playwright: boolean;
  browserRunning: boolean;
  loggedIn: boolean;
  stats?: { scraped: number; failed: number; uptimeMs: number };
}

export interface AgentStatus {
  connected: boolean;
  baseUrl?: string;
  health?: AgentHealth;
  /** 探测失败的原因（用于给用户提示） */
  error?: string;
}

/* ---------------- 状态订阅 ---------------- */

type Listener = (s: AgentStatus) => void;

const listeners = new Set<Listener>();
let current: AgentStatus = { connected: false };
let lastProbeAt = 0;
let inflight: Promise<AgentStatus> | null = null;

const SSR_SNAPSHOT: AgentStatus = { connected: false };

function emit(next: AgentStatus) {
  current = next;
  listeners.forEach((fn) => fn(next));
}

export function subscribeAgent(fn: Listener): () => void {
  listeners.add(fn);
  fn(current);
  return () => {
    listeners.delete(fn);
  };
}

export const getAgentSnapshot = () => current;
export const getAgentServerSnapshot = () => SSR_SNAPSHOT;

/* ---------------- 探测 ---------------- */

async function fetchHealth(baseUrl: string): Promise<AgentHealth | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: ctrl.signal,
      cache: 'no-store',
      mode: 'cors',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AgentHealth;
    return data?.service === 'cpm-local-agent' ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 探测本地代理。默认走 20 秒缓存，`force` 强制重新探测。
 * @param customUrl 用户在设置里填的自定义地址
 */
export async function probeAgent(options: { force?: boolean; customUrl?: string } = {}): Promise<AgentStatus> {
  const { force = false, customUrl } = options;

  if (!force && Date.now() - lastProbeAt < CACHE_TTL) return current;
  if (inflight) return inflight;

  inflight = (async () => {
    const candidates = customUrl
      ? [customUrl.replace(/\/+$/, ''), ...AGENT_CANDIDATES.filter((c) => c !== customUrl)]
      : AGENT_CANDIDATES;

    for (const base of candidates) {
      const health = await fetchHealth(base);
      if (health) {
        const next: AgentStatus = { connected: true, baseUrl: base, health };
        lastProbeAt = Date.now();
        emit(next);
        return next;
      }
    }

    const next: AgentStatus = {
      connected: false,
      error: '未检测到本地代理',
    };
    lastProbeAt = Date.now();
    emit(next);
    return next;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** 同步读取当前状态（不发请求） */
export const getAgentStatus = (): AgentStatus => current;

/* ---------------- 调用 ---------------- */

export interface AgentScrapeResponse {
  ok: boolean;
  result?: ScrapeResult;
  error?: string;
  hint?: string;
}

export async function agentScrape(baseUrl: string, url: string): Promise<AgentScrapeResponse> {
  try {
    const res = await fetch(`${baseUrl}/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      cache: 'no-store',
    });
    const data = (await res.json()) as AgentScrapeResponse & { hint?: string };
    return data;
  } catch (e) {
    return {
      ok: false,
      error: `本地代理连接中断：${e instanceof Error ? e.message : '未知错误'}`,
    };
  }
}

export async function agentOpenLogin(baseUrl: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/open-login`, { method: 'POST', cache: 'no-store' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '调用失败' };
  }
}

export async function agentResetLogin(baseUrl: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/reset-login`, { method: 'POST', cache: 'no-store' });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '调用失败' };
  }
}

/* ---------------- 抓取通道 ---------------- */

export interface ScrapeChannel {
  kind: 'agent' | 'api';
  label: string;
  baseUrl?: string;
  /** 本地代理是否已登录淘宝 */
  loggedIn?: boolean;
}

/**
 * 决定这次抓取走哪条路：本地代理优先，其次线上 API。
 * @param customUrl 设置里的自定义代理地址
 */
export async function resolveChannel(customUrl?: string): Promise<ScrapeChannel> {
  const status = await probeAgent({ customUrl });
  if (status.connected && status.baseUrl) {
    return {
      kind: 'agent',
      label: '本地代理',
      baseUrl: status.baseUrl,
      loggedIn: status.health?.loggedIn,
    };
  }
  return { kind: 'api', label: '线上接口' };
}

/** 本地代理未安装 playwright 时的提示 */
export const AGENT_SETUP_HINT = [
  'npm i -D playwright',
  'npx playwright install chromium',
  'npm run agent',
].join('\n');
