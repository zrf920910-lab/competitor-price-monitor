import { NextResponse } from 'next/server';
import { scrapeTaobaoItem } from '@/lib/scrape/taobao-server';
import { extractItemId, isShortLink } from '@/lib/normalize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  url?: string;
  itemId?: string;
}

/** 跟随短链重定向，拿到最终 URL */
async function followShortLink(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    },
    cache: 'no-store',
  });
  const finalUrl = res.url;
  if (extractItemId(finalUrl)) return finalUrl;

  // 有些短链返回 HTML + JS 跳转，从正文里再找一次
  const html = await res.text();
  const m = html.match(/https?:\/\/[^\s"'<>]*(?:item\.taobao|detail\.tmall|item\.tmall)[^\s"'<>]*/i);
  return m ? m[0] : finalUrl;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const raw = (body.itemId || body.url || '').trim();
  if (!raw) {
    return NextResponse.json({ ok: false, error: '缺少 url 或 itemId' }, { status: 400 });
  }

  let itemId = extractItemId(raw);
  let finalUrl = raw;

  if (!itemId && isShortLink(raw)) {
    try {
      finalUrl = await followShortLink(raw);
      itemId = extractItemId(finalUrl);
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: `短链解析失败：${e instanceof Error ? e.message : '未知错误'}`,
      });
    }
  }

  if (!itemId) {
    return NextResponse.json({
      ok: false,
      error: '未能从链接中识别商品 ID，请确认是淘宝/天猫商品链接',
    });
  }

  const result = await scrapeTaobaoItem(itemId, finalUrl);

  if (result.error && result.skus.length === 0) {
    return NextResponse.json({
      ok: false,
      error: result.error,
      hint: '淘宝对服务器 IP 有风控限制。请在本地运行 npm run scrape 使用登录态抓取，或手动粘贴价格数据。',
      result,
    });
  }

  return NextResponse.json({ ok: true, result });
}
