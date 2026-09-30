'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Sheet, Field } from './ui';
import { useToast } from './Toast';
import { addByUrls, type ProgressEvent } from '@/lib/actions';
import { findUrls } from '@/lib/taobao';
import {
  getAgentServerSnapshot,
  getAgentSnapshot,
  probeAgent,
  subscribeAgent,
} from '@/lib/local-agent';
import clsx from 'clsx';

export function AddProductSheet({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const agentStatus = useSyncExternalStore(subscribeAgent, getAgentSnapshot, getAgentServerSnapshot);
  const [text, setText] = useState('');
  const [scrape, setScrape] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);

  // 打开时探测一次本地代理，保证通道提示准确
  useEffect(() => {
    if (open) void probeAgent();
  }, [open]);

  const reset = () => {
    setText('');
    setProgress([]);
    setBusy(false);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    const urls = findUrls(text);
    if (urls.length === 0) {
      toast('没有识别到淘宝/天猫链接，请检查内容', 'error');
      return;
    }

    setBusy(true);
    setProgress([]);
    const result = await addByUrls(urls, {
      scrape,
      keepFailed: true,
      onProgress: (e) => {
        setProgress((prev) => {
          const next = [...prev];
          next[e.index] = e;
          return next;
        });
      },
    });

    setBusy(false);

    if (result.failed.length === 0) {
      toast(`已添加 ${result.ok} 个商品`, 'success');
      reset();
      onClose();
      onDone?.();
      return;
    }

    if (result.ok > 0) {
      toast(`成功 ${result.ok} 个，失败 ${result.failed.length} 个`, 'info');
      onDone?.();
    } else {
      toast('全部抓取失败，可改用本地脚本或手动录入', 'error');
    }
  };

  const urlCount = findUrls(text).length;
  const failedCount = progress.filter((p) => p?.status === 'failed').length;

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      title="添加竞品链接"
      description="粘贴淘宝 / 天猫商品链接，支持一行一个或多个混排"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={scrape}
              disabled={busy}
              onChange={(e) => setScrape(e.target.checked)}
              className="h-4 w-4 rounded border-ink-300 text-brand-500 focus:ring-brand-500/30"
            />
            自动抓取价格
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={handleClose} disabled={busy}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary min-w-[92px]"
              onClick={handleSubmit}
              disabled={busy || urlCount === 0}
            >
              {busy ? '抓取中…' : urlCount > 0 ? `添加 ${urlCount} 个` : '添加'}
            </button>
          </div>
        </div>
      }
    >
      {scrape ? (
        <div
          className={clsx(
            'mb-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[11px] leading-5 ring-1',
            agentStatus.connected
              ? 'bg-down/10 text-ink-700 ring-down/20'
              : 'bg-brand-50 text-brand-800 ring-brand-100'
          )}
        >
          <span className="mt-px shrink-0">{agentStatus.connected ? '⚡' : 'ℹ️'}</span>
          <span>
            {agentStatus.connected ? (
              <>
                抓取将走<span className="font-semibold">本地代理</span>
                {agentStatus.health?.loggedIn
                  ? '（淘宝已登录），稳定性最高。'
                  : '，但淘宝尚未登录——请先到「数据」页打开登录窗口扫码。'}
              </>
            ) : (
              <>
                当前只能走<span className="font-semibold">线上接口</span>，淘宝对服务器 IP 有风控，成功率不稳定。
                在电脑上运行{' '}
                <code className="rounded bg-white/70 px-1 font-mono text-[10px]">npm run agent</code>{' '}
                可启用本地代理。
              </>
            )}
          </span>
        </div>
      ) : null}

      <Field label="商品链接" hint={scrape ? undefined : '仅登记链接，稍后手动录入价格。'}>
        <textarea
          className="input min-h-[132px] resize-y font-mono text-xs leading-6"
          placeholder={'https://item.taobao.com/item.htm?id=123456789\nhttps://detail.tmall.com/item.htm?id=987654321'}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
      </Field>

      {urlCount > 0 ? (
        <p className="mt-2 text-xs text-ink-500">
          识别到 <span className="font-semibold text-brand-600">{urlCount}</span> 个链接
        </p>
      ) : null}

      {progress.length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-ink-500">抓取进度</p>
            {failedCount > 0 && !busy ? (
              <p className="text-xs text-up">{failedCount} 个失败</p>
            ) : null}
          </div>
          <ul className="space-y-1.5">
            {progress.map((p, i) =>
              p ? (
                <li key={`${p.url}-${i}`} className="card-flat flex items-start gap-2.5 px-3 py-2">
                  <span
                    className={clsx(
                      'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                      p.status === 'ok' && 'bg-down',
                      p.status === 'failed' && 'bg-up',
                      p.status === 'pending' && 'animate-pulse bg-brand-400'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] text-ink-500">{p.url}</p>
                    <p
                      className={clsx(
                        'flex items-center gap-1.5 text-xs',
                        p.status === 'failed' ? 'text-up' : p.status === 'ok' ? 'text-ink-800' : 'text-ink-500'
                      )}
                    >
                      {p.channel ? (
                        <span
                          className={clsx(
                            'chip shrink-0',
                            p.channel === 'agent' ? 'bg-down/10 text-down' : 'bg-ink-100 text-ink-500'
                          )}
                        >
                          {p.channel === 'agent' ? '本地代理' : '线上'}
                        </span>
                      ) : null}
                      <span className="truncate">{p.message}</span>
                    </p>
                  </div>
                </li>
              ) : null
            )}
          </ul>

          {failedCount > 0 && !busy ? (
            <div className="mt-3 rounded-xl bg-brand-50 px-3 py-2.5 text-[11px] leading-5 text-brand-800 ring-1 ring-brand-100">
              抓取失败的商品已保留为「待录入」。你可以在本地运行{' '}
              <code className="rounded bg-white px-1 py-0.5 font-mono text-[10px]">npm run scrape</code>{' '}
              抓取后，在「数据」页导入 JSON。
            </div>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
