'use client';

import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  createCategory,
  deleteCategory,
  listCategories,
  listProducts,
  reclassifyAll,
  updateCategory,
} from '@/lib/db';
import { useIsClient, useLive } from '@/lib/use-live';
import { DEFAULT_CATEGORY_COLORS, resolveCategoryId, suggestCategories } from '@/lib/classify';
import { EmptyState, Field, Sheet, ConfirmDialog, Tag } from '@/components/ui';
import { useToast } from '@/components/Toast';
import type { CategoryRecord } from '@/lib/types';

export default function CategoriesPage() {
  const toast = useToast();
  const isClient = useIsClient();
  const categories = useLive(() => listCategories(), [], []);
  const products = useLive(() => listProducts(), [], []);

  const [editing, setEditing] = useState<CategoryRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDel, setConfirmDel] = useState<CategoryRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let uncategorized = 0;
    for (const p of products) {
      const id = resolveCategoryId(p);
      if (!id) uncategorized += 1;
      else map.set(id, (map.get(id) ?? 0) + 1);
    }
    return { map, uncategorized };
  }, [products]);

  const uncategorizedProducts = useMemo(
    () => products.filter((p) => !resolveCategoryId(p)),
    [products]
  );

  const suggestions = useMemo(
    () => suggestCategories(uncategorizedProducts).filter((s) => s.count >= 1).slice(0, 8),
    [uncategorizedProducts]
  );

  const handleReapply = async () => {
    setBusy(true);
    const n = await reclassifyAll();
    setBusy(false);
    toast(n > 0 ? `已重新分类 ${n} 个商品` : '所有商品分类已是最新', 'success');
  };

  const handleDelete = async () => {
    if (!confirmDel) return;
    await deleteCategory(confirmDel.id);
    setConfirmDel(null);
    toast('已删除分类', 'success');
  };

  const move = async (cat: CategoryRecord, dir: -1 | 1) => {
    const idx = categories.findIndex((c) => c.id === cat.id);
    const target = categories[idx + dir];
    if (!target) return;
    await Promise.all([
      updateCategory(cat.id, { order: target.order }),
      updateCategory(target.id, { order: cat.order }),
    ]);
  };

  if (!isClient) {
    return (
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-20 animate-pulse bg-white/60" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="card flex items-center justify-between gap-2 p-3">
        <div>
          <p className="text-[13px] font-semibold text-ink-900">分类规则</p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            按关键词自动归类，优先级高的先匹配 · 共 {categories.length} 个分类
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn-outline btn-sm" onClick={handleReapply} disabled={busy}>
            {busy ? '应用中…' : '重新应用'}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            新建
          </button>
        </div>
      </div>

      {/* 智能建议 */}
      {suggestions.length > 0 ? (
        <div className="card p-3">
          <div className="flex items-center gap-2">
            <span className="text-base">✨</span>
            <div>
              <p className="text-[13px] font-semibold text-ink-900">
                发现 {counts.uncategorized} 个未分类商品
              </p>
              <p className="text-[11px] text-ink-500">根据标题里的品类词，可以一键建这些分类：</p>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={async () => {
                  await createCategory({ name: s.name, patterns: [s.name], priority: 50 });
                  const n = await reclassifyAll();
                  toast(`已创建「${s.name}」，归类 ${n} 个商品`, 'success');
                }}
                className="group flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 transition hover:bg-brand-100"
              >
                {s.name}
                <span className="tabular-nums text-[10px] text-brand-500">{s.count}</span>
                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* 分类列表 */}
      {categories.length === 0 ? (
        <EmptyState
          icon="🏷️"
          title="还没有分类"
          description="创建分类并填上关键词，商品会自动归入对应分类。"
          action={
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              新建分类
            </button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {categories.map((cat, i) => (
            <li key={cat.id} className="card px-3.5 py-3">
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 h-8 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: cat.color }}
                />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(cat)}>
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink-900">{cat.name}</span>
                    <span className="chip bg-ink-100 text-ink-500">{counts.map.get(cat.id) ?? 0} 个商品</span>
                    {cat.matchMode === 'all' ? (
                      <span className="chip bg-ink-100 text-ink-500">全部命中</span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {cat.patterns.slice(0, 6).map((p) => (
                      <Tag key={p}>{p}</Tag>
                    ))}
                    {cat.patterns.length > 6 ? <Tag>+{cat.patterns.length - 6}</Tag> : null}
                    {cat.patterns.length === 0 ? (
                      <span className="text-[11px] text-ink-400">未设置关键词，不会自动匹配</span>
                    ) : null}
                  </div>
                  {cat.excludes.length > 0 ? (
                    <p className="mt-1 text-[10px] text-ink-400">排除：{cat.excludes.join('、')}</p>
                  ) : null}
                </button>

                <div className="flex shrink-0 flex-col items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="上移"
                    disabled={i === 0}
                    onClick={() => move(cat, -1)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition hover:bg-ink-100 hover:text-ink-600 disabled:opacity-25"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                      <path d="M6 15l6-6 6 6" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    aria-label="下移"
                    disabled={i === categories.length - 1}
                    onClick={() => move(cat, 1)}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition hover:bg-ink-100 hover:text-ink-600 disabled:opacity-25"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CategoryEditor
        open={creating || editing !== null}
        category={editing}
        products={products}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onDelete={(c) => {
          setEditing(null);
          setConfirmDel(c);
        }}
      />

      <ConfirmDialog
        open={confirmDel !== null}
        danger
        title="删除这个分类？"
        message={`「${confirmDel?.name}」将被移除，商品会回到未分类状态（商品本身不会被删除）。`}
        confirmText="删除"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

/* ---------------- 分类编辑器 ---------------- */

function CategoryEditor({
  open,
  category,
  products,
  onClose,
  onDelete,
}: {
  open: boolean;
  category: CategoryRecord | null;
  products: Array<{ id: string; title: string; skus: Array<{ specText: string }>; manualCategoryId?: string | null; autoCategoryId?: string | null }>;
  onClose: () => void;
  onDelete: (c: CategoryRecord) => void;
}) {
  const toast = useToast();
  const isNew = category === null;

  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_CATEGORY_COLORS[0]);
  const [patterns, setPatterns] = useState('');
  const [excludes, setExcludes] = useState('');
  const [matchMode, setMatchMode] = useState<'any' | 'all'>('any');
  const [priority, setPriority] = useState(50);

  useEffect(() => {
    if (!open) return;
    if (category) {
      setName(category.name);
      setColor(category.color);
      setPatterns(category.patterns.join(', '));
      setExcludes(category.excludes.join(', '));
      setMatchMode(category.matchMode);
      setPriority(category.priority);
    } else {
      setName('');
      setColor(DEFAULT_CATEGORY_COLORS[Math.floor(Math.random() * DEFAULT_CATEGORY_COLORS.length)]);
      setPatterns('');
      setExcludes('');
      setMatchMode('any');
      setPriority(50);
    }
  }, [open, category]);

  // 实时预览命中数量
  const preview = useMemo(() => {
    const pats = patterns
      .split(/[,，、\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const exs = excludes
      .split(/[,，、\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (pats.length === 0) return { hit: 0, samples: [] as string[] };

    const hit: string[] = [];
    for (const p of products) {
      if (p.manualCategoryId) continue;
      const text = `${p.title} ${p.skus.map((s) => s.specText).join(' ')}`.toLowerCase();
      if (exs.some((e) => text.includes(e))) continue;
      const ok = matchMode === 'all' ? pats.every((x) => text.includes(x)) : pats.some((x) => text.includes(x));
      if (ok) hit.push(p.title);
    }
    return { hit: hit.length, samples: hit.slice(0, 3) };
  }, [patterns, excludes, matchMode, products]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast('请填写分类名称', 'error');
      return;
    }
    const pats = patterns
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const exs = excludes
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (category) {
      await updateCategory(category.id, {
        name: trimmed,
        color,
        patterns: pats,
        excludes: exs,
        matchMode,
        priority,
      });
    } else {
      await createCategory({ name: trimmed, color, patterns: pats, excludes: exs, matchMode, priority });
    }
    const n = await reclassifyAll();
    toast(category ? `已保存，重新归类 ${n} 个商品` : `已创建「${trimmed}」`, 'success');
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={isNew ? '新建分类' : '编辑分类'}
      description="关键词之间用逗号分隔，命中任一即归类"
      footer={
        <div className="flex items-center justify-between gap-2">
          {!isNew && category ? (
            <button type="button" className="btn-danger btn-sm" onClick={() => onDelete(category)}>
              删除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              取消
            </button>
            <button type="button" className="btn-primary" onClick={handleSave}>
              保存
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3.5">
        <Field label="分类名称">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：4KG 干粉灭火器" />
        </Field>

        <div>
          <span className="label">颜色</span>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_CATEGORY_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => setColor(c)}
                className={clsx(
                  'h-7 w-7 rounded-full transition',
                  color === c ? 'ring-2 ring-ink-900 ring-offset-2' : 'hover:scale-110'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        <Field label="关键词（命中任一即归类）" hint="例：干粉, ABC, MFZ">
          <textarea
            className="input min-h-[76px] resize-y"
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            placeholder="干粉, ABC, MFZ"
          />
        </Field>

        <Field label="排除词（命中则跳过）" hint="例：箱 —— 避免把「干粉灭火器箱」归进灭火器">
          <input className="input" value={excludes} onChange={(e) => setExcludes(e.target.value)} placeholder="箱, 支架" />
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="匹配模式">
            <select className="input" value={matchMode} onChange={(e) => setMatchMode(e.target.value as 'any' | 'all')}>
              <option value="any">任一关键词命中</option>
              <option value="all">全部关键词命中</option>
            </select>
          </Field>
          <Field label="优先级" hint="数字大的先匹配">
            <input
              className="input"
              type="number"
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
            />
          </Field>
        </div>

        <div className="rounded-xl bg-ink-50 px-3 py-2.5 ring-1 ring-ink-100">
          <p className="text-[11px] font-medium text-ink-600">
            规则预览：将匹配 <span className="text-brand-600">{preview.hit}</span> 个商品
          </p>
          {preview.samples.length > 0 ? (
            <ul className="mt-1 space-y-0.5">
              {preview.samples.map((s, i) => (
                <li key={i} className="truncate text-[10px] text-ink-400">
                  · {s}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
