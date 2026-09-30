'use client';

import { useRef, useState } from 'react';
import clsx from 'clsx';
import { clearAll, exportBundle, importBundle, listProducts, pruneSnapshots } from '@/lib/db';
import { useIsClient, useLive } from '@/lib/use-live';
import { autoParse } from '@/lib/import';
import { Field, ConfirmDialog } from '@/components/ui';
import { useToast } from '@/components/Toast';

const CODE = 'font-mono text-[11px]';

export default function DataPage() {
  const toast = useToast();
  const isClient = useIsClient();
  const products = useLive(() => listProducts(), [], []);
  const fileRef = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ lines: string[]; warnings: string[] } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmPrune, setConfirmPrune] = useState(false);

  const handleImport = async (raw: string) => {
    if (!raw.trim()) {
      toast('请先粘贴或选择要导入的内容', 'error');
      return;
    }
    setBusy(true);
    try {
      const { bundle, warnings, detected } = autoParse(raw);
      const hasData =
        (bundle.products?.length ?? 0) + (bundle.results?.length ?? 0) + (bundle.categories?.length ?? 0) > 0;
      if (!hasData) {
        setReport({ lines: [], warnings: warnings.length ? warnings : ['没有解析出任何可导入的数据'] });
        toast('没有解析出数据', 'error');
        return;
      }
      const stat = await importBundle(bundle);
      setReport({
        lines: [
          `识别格式：${detected.join(' + ') || 'JSON'}`,
          `导入商品 ${stat.products} 个${stat.skipped ? `（跳过重复 ${stat.skipped} 个）` : ''}`,
          stat.categories ? `导入分类 ${stat.categories} 个` : '',
          stat.shops ? `导入店铺 ${stat.shops} 家` : '',
        ].filter(Boolean),
        warnings,
      });
      toast('导入完成', 'success');
      setText('');
    } catch (e) {
      console.error(e);
      toast(`导入失败：${e instanceof Error ? e.message : '未知错误'}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    const content = await file.text();
    setText(content.slice(0, 200000));
    await handleImport(content);
  };

  const handleExport = async () => {
    const bundle = await exportBundle();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `竞品价格备份-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出备份文件', 'success');
  };

  const handleExportCsv = () => {
    const header = ['店铺', '标题', '规格', '规格键', '价格', '原价', '库存', '链接'];
    const lines = [header.join(',')];
    for (const p of products) {
      for (const s of p.skus) {
        lines.push(
          [
            p.shopName,
            p.title,
            s.specText,
            s.manualSpecKey ?? s.specKey,
            s.price,
            s.originalPrice ?? '',
            s.stock ?? '',
            p.url,
          ]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
      }
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `竞品价格明细-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 CSV', 'success');
  };

  if (!isClient) {
    return <div className="card h-40 animate-pulse bg-white/60" />;
  }

  return (
    <div className="space-y-3">
      {/* 本地抓取脚本 */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 px-4 pb-2 pt-3.5">
          <span className="text-base">🖥️</span>
          <div>
            <p className="text-[13px] font-semibold text-ink-900">本地脚本抓取（推荐）</p>
            <p className="text-[11px] text-ink-500">复用你浏览器的登录态，能拿到完整的 SKU 价格</p>
          </div>
        </div>
        <div className="space-y-2.5 px-4 pb-4">
          <Step n={1} title="安装浏览器内核（仅首次）">
            <code className={CODE}>npx playwright install chromium</code>
          </Step>
          <Step n={2} title="把要抓的商品链接写进 data/urls.txt（一行一个），然后运行">
            <code className={CODE}>npm run scrape</code>
            <span className="block w-full text-[10px] leading-4 text-ink-400">
              首次运行会弹出浏览器，请扫码登录淘宝，登录态保存在 .playwright-profile/
            </span>
          </Step>
          <Step n={3} title="抓取完成后得到 data/scrape-result.json，在下面导入">
            <code className={CODE}>data/scrape-result.json</code>
          </Step>
          <p className="rounded-xl bg-brand-50 px-3 py-2 text-[11px] leading-5 text-brand-800 ring-1 ring-brand-100">
            脚本支持增量：只抓取 urls.txt 里的链接，结果会合并到同一个 JSON 文件，可反复运行更新价格。
          </p>
        </div>
      </section>

      {/* 导入 */}
      <section className="card p-4">
        <p className="text-[13px] font-semibold text-ink-900">导入数据</p>
        <p className="mt-0.5 text-[11px] text-ink-500">
          支持：脚本输出的 JSON · 完整备份 JSON · CSV · 从 Excel 直接复制的表格
        </p>

        <div className="mt-3">
          <Field
            label="粘贴内容"
            hint="从 Excel 复制时请保留表头，列名含「价格」即可，会自动识别 店铺/标题/规格/链接 等列"
          >
            <textarea
              className="input min-h-[120px] resize-y font-mono text-[11px] leading-5"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'店铺,标题,规格,价格\n张三消防,4KG干粉灭火器,4KG手提式,45.00'}
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => handleImport(text)} disabled={busy}>
            {busy ? '导入中…' : '开始导入'}
          </button>
          <button type="button" className="btn-outline" onClick={() => fileRef.current?.click()} disabled={busy}>
            选择文件
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.tsv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = '';
            }}
          />
          {text ? (
            <button type="button" className="btn-ghost" onClick={() => setText('')}>
              清空
            </button>
          ) : null}
        </div>

        {report ? (
          <div className="mt-3 rounded-xl bg-ink-50 px-3 py-2.5 ring-1 ring-ink-100">
            <ul className="space-y-0.5">
              {report.lines.map((l, i) => (
                <li key={i} className="text-[11px] text-ink-700">
                  ✓ {l}
                </li>
              ))}
              {report.warnings.map((w, i) => (
                <li key={`w${i}`} className="text-[11px] text-up">
                  ! {w}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* 导出 */}
      <section className="card p-4">
        <p className="text-[13px] font-semibold text-ink-900">导出与备份</p>
        <p className="mt-0.5 text-[11px] text-ink-500">
          数据全部保存在本机浏览器，换设备或清理缓存前请先导出备份
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={handleExport}>
            导出完整备份（JSON）
          </button>
          <button type="button" className="btn-outline" onClick={handleExportCsv} disabled={products.length === 0}>
            导出价格明细（CSV）
          </button>
        </div>
      </section>

      {/* 维护 */}
      <section className="card p-4">
        <p className="text-[13px] font-semibold text-ink-900">数据维护</p>
        <p className="mt-0.5 text-[11px] text-ink-500">
          当前 {products.length} 个商品 ·{' '}
          {products.reduce((s, p) => s + p.skus.length, 0)} 个 SKU
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-outline" onClick={() => setConfirmPrune(true)}>
            清理 180 天前价格历史
          </button>
          <button type="button" className="btn-danger" onClick={() => setConfirmClear(true)}>
            清空所有数据
          </button>
        </div>
      </section>

      <p className="px-1 pb-2 text-center text-[10px] leading-4 text-ink-400">
        本应用为纯前端 PWA，不采集、不上传任何数据。
      </p>

      <ConfirmDialog
        open={confirmPrune}
        title="清理历史价格？"
        message="将删除 180 天前的价格快照记录，不影响当前价格与商品数据。"
        confirmText="清理"
        onConfirm={async () => {
          const n = await pruneSnapshots(180);
          setConfirmPrune(false);
          toast(`已清理 ${n} 条历史记录`, 'success');
        }}
        onCancel={() => setConfirmPrune(false)}
      />

      <ConfirmDialog
        open={confirmClear}
        danger
        title="清空所有数据？"
        message="所有商品、SKU、分类规则和历史价格都会被删除，且无法恢复。建议先导出备份。"
        confirmText="全部清空"
        onConfirm={async () => {
          await clearAll();
          setConfirmClear(false);
          setReport(null);
          toast('已清空所有数据', 'success');
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-semibold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-5 text-ink-700">{title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {children}
        </div>
      </div>
    </div>
  );
}
