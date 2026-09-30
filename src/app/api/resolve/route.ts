import { NextResponse } from 'next/server';
import { extractItemId, isShortLink } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

export async function POST(req: Request) {
  let url = '';
  try {
    const body = (await req.json()) as { url?: string };
    url = (body.url ?? '').trim();
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  if (!url) return NextResponse.json({ ok: false, error: '缺少 url' }, { status: 400 });

  const direct = extractItemId(url);
  if (direct && !isShortLink(url)) {
    return NextResponse.json({ ok: true, itemId: direct, finalUrl: url });
  }

  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA }, cache: 'no-store' });
    let finalUrl = res.url;
    let itemId = extractItemId(finalUrl);

    if (!itemId) {
      const html = await res.text();
      const m = html.match(/https?:\/\/[^\s"'<>]*(?:item\.taobao|detail\.tmall|item\.tmall)[^\s"'<>]*/i);
      if (m) {
        finalUrl = m[0];
        itemId = extractItemId(finalUrl);
      }
    }

    if (!itemId) {
      return NextResponse.json({ ok: false, error: '短链已跳转，但未找到商品 ID', finalUrl });
    }
    return NextResponse.json({ ok: true, itemId, finalUrl });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: `解析失败：${e instanceof Error ? e.message : '未知错误'}`,
    });
  }
}
