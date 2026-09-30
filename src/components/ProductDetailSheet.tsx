'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { getProduct, listCategories, updateProduct, updateSku, deleteSku } from '@/lib/db';
import { useLive } from '@/lib/use-live';
import { buildSpecKey, buildSpecLabel } from '@/lib/normalize';
import { Sheet, Field, ConfirmDialog } from './ui';
import { useToast } from './Toast';
import { refreshProduct } from '@/lib/actions';
import type { SkuRecord } from '@/lib/types';

const yuan = (n: number) => `¥${n.toFixed(2)}`;

export function ProductDetailSheet({
  productId,
  open,
  onClose,
  onChanged,
}: {
  productId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const product = useLive(
    () => (productId ? getProduct(productId) : Promise.resolve(undefined)),
    [productId],
    undefined
  );
  const categories = useLive(() => listCategories(), [], []);

  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ specText: string; price: string; specKey: string }>({
    specText: '',
    price: '',
    specKey: '',
  });
  const [confirmDel, setConfirmDel] = useState<{ type: 'sku' | 'product'; id: string; name: string } | null>(null);

  const minPrice = useMemo(
    () => (product?.skus.length ? Math.min(...product.skus.map((s) => s.price || Infinity)) : 0),
    [product]
  );

  if (!open || !product) {
    return (
      <Sheet open={open} onClose={onClose} title="商品详情">
        <div className="py-10 text-center text-sm text-ink-400">加载中…</div>
      </Sheet>
    );
  }

  const startEdit = (sku: SkuRecord) => {
    setEditing(sku.id);
    setDraft({ specText: sku.specText, price: String(sku.price), specKey: sku.manualSpecKey ?? sku.specKey });
  };

  const saveEdit = async (skuId: string) => {
    const price = parseFloat(draft.price);
    if (!Number.isFinite(price) || price < 0) {
      toast('请输入有效价格', 'error');
      return;
    }
    const specText = draft.specText.trim() || '默认规格';
    await updateSku(product.id, skuId, {
      specText,
      price,
      specKey: buildSpecKey(specText),
      specLabel: buildSpecLabel(specText),
      manualSpecKey: draft.specKey.trim() || undefined,
      updatedAt: Date.now(),
    });
    setEditing(null);
    onChanged?.();
    toast('已保存', 'success');
  };

  const handleRefresh = async () => {
    setBusy(true);
    const r = await refreshProduct(product.id);
    setBusy(false);
    if (r.ok) {
      toast(`已更新 ${r.count} 个 SKU`, 'success');
      onChanged?.();
    } else {
      toast(`刷新失败：${r.error}`, 'error');
    }
  };

  const handleDeleteSku = async () => {
    if (!confirmDel || confirmDel.type !== 'sku') return;
    await deleteSku(product.id, confirmDel.id);
    setConfirmDel(null);
    onChanged?.();
    toast('已删除该规格', 'success');
  };

  const handleDeleteProduct = async () => {
    if (!confirmDel || confirmDel.type !== 'product') return;
    const { deleteProduct } = await import('@/lib/db');
    await deleteProduct(product.id);
    setConfirmDel(null);
    onClose();
    onChanged?.();
    toast('已删除商品', 'success');
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        size="lg"
        title={product.title || '(未命名商品)'}
        description={`${product.shopName} · ${product.skus.length} 个规格 · 最低 ${minPrice ? yuan(minPrice) : '—'}`}
        footer={
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => setConfirmDel({ type: 'product', id: product.id, name: product.title })}
            >
              删除商品
            </button>
            <div className="flex gap-2">
              <a href={product.url} target="_blank" rel="noreferrer" className="btn-outline">
                打开淘宝
              </a>
              <button type="button" className="btn-primary" onClick={handleRefresh} disabled={busy}>
                {busy ? '刷新中…' : '刷新价格'}
              </button>
            </div>
          </div>
        }
      >
        {/* 基本信息 */}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="商品链接">
              <input
                className="input font-mono text-[11px]"
                defaultValue={product.url}
                onBlur={async (e) => {
                  const v = e.target.value.trim();
                  if (v && v !== product.url) {
                    await updateProduct(product.id, { url: v });
                    onChanged?.();
                  }
                }}
              />
            </Field>
            <Field label="店铺名称">
              <input
                className="input"
                defaultValue={product.shopName}
                onBlur={async (e) => {
                  const v = e.target.value.trim();
                  if (v && v !== product.shopName) {
                    await updateProduct(product.id, { shopName: v });
                    onChanged?.();
                  }
                }}
              />
            </Field>
          </div>

          <Field
            label="商品标题"
            hint="标题会影响自动分类结果，可手动修正"
          >
            <input
              className="input"
              defaultValue={product.title}
              onBlur={async (e) => {
                const v = e.target.value.trim();
                if (v && v !== product.title) {
                  await updateProduct(product.id, { title: v });
                  onChanged?.();
                }
              }}
            />
          </Field>

          <Field label="分类" hint="手动指定后，将覆盖自动分类结果">
            <select
              className="input"
              value={product.manualCategoryId ?? ''}
              onChange={async (e) => {
                const v = e.target.value || null;
                await updateProduct(product.id, { manualCategoryId: v });
                onChanged?.();
              }}
            >
              <option value="">
                自动（当前：{categories.find((c) => c.id === product.autoCategoryId)?.name ?? '未分类'}）
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          {product.status === 'error' && product.error ? (
            <div className="rounded-xl bg-up/8 px-3 py-2.5 text-[11px] leading-5 text-up ring-1 ring-up/15">
              上次抓取失败：{product.error}
            </div>
          ) : null}

          {/* SKU 列表 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-ink-500">SKU 与价格</p>
              <p className="text-[11px] text-ink-400">点规格行可编辑</p>
            </div>

            {product.skus.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink-200 px-3 py-6 text-center text-xs text-ink-400">
                还没有规格数据，点上方「刷新价格」抓取，或手动添加。
              </div>
            ) : (
              <ul className="space-y-1.5">
                {[...product.skus]
                  .sort((a, b) => b.price - a.price)
                  .map((sku) => {
                    const isEditing = editing === sku.id;
                    return (
                      <li
                        key={sku.id}
                        className={clsx(
                          'rounded-xl px-3 py-2 ring-1 transition',
                          isEditing ? 'bg-brand-50 ring-brand-200' : 'bg-ink-50/60 ring-ink-100'
                        )}
                      >
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              className="input"
                              value={draft.specText}
                              placeholder="规格名"
                              onChange={(e) => {
                                const v = e.target.value;
                                setDraft((d) => ({ ...d, specText: v, specKey: buildSpecKey(v) }));
                              }}
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                className="input"
                                type="number"
                                step="0.01"
                                inputMode="decimal"
                                value={draft.price}
                                placeholder="价格"
                                onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                              />
                              <input
                                className="input font-mono text-xs"
                                value={draft.specKey}
                                placeholder="规格键"
                                onChange={(e) => setDraft((d) => ({ ...d, specKey: e.target.value }))}
                              />
                            </div>
                            <p className="text-[10px] leading-4 text-ink-400">
                              规格键用于跨店对齐：同键的 SKU 会被拉到同一行对比。留空则用规格名自动推导。
                            </p>
                            <div className="flex justify-end gap-2">
                              <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(null)}>
                                取消
                              </button>
                              <button type="button" className="btn-primary btn-sm" onClick={() => saveEdit(sku.id)}>
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 items-center gap-3 text-left"
                              onClick={() => startEdit(sku)}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-ink-800">
                                  {sku.specText}
                                </span>
                                <span className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-400">
                                  <span className="font-mono">{sku.manualSpecKey ?? sku.specKey}</span>
                                  {sku.manualSpecKey ? (
                                    <span className="chip bg-brand-100 text-brand-700">手动对齐</span>
                                  ) : null}
                                  {sku.stock !== undefined && sku.stock >= 0 ? <span>库存 {sku.stock}</span> : null}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-[14px] font-semibold text-ink-900">
                                {yuan(sku.price)}
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label="删除规格"
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-300 transition hover:bg-up/10 hover:text-up"
                              onClick={() => setConfirmDel({ type: 'sku', id: sku.id, name: sku.specText })}
                            >
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                                <path d="M6 6l12 12M18 6L6 18" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDel !== null}
        danger
        title={confirmDel?.type === 'product' ? '删除这个商品？' : '删除这个规格？'}
        message={
          confirmDel?.type === 'product'
            ? `「${confirmDel.name}」及其全部 SKU 与历史价格记录都会被删除，无法恢复。`
            : `「${confirmDel?.name}」将从对比表中移除。`
        }
        confirmText="删除"
        onConfirm={confirmDel?.type === 'product' ? handleDeleteProduct : handleDeleteSku}
        onCancel={() => setConfirmDel(null)}
      />
    </>
  );
}
