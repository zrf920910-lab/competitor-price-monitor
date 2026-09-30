/**
 * 零依赖 PWA 图标生成器
 * 手写 PNG 编码（zlib + CRC32），用 SDF 距离场做抗锯齿绘制，按目标尺寸矢量渲染。
 * 用法：node scripts/gen-icons.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'icons');

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- SDF 图元 ---------------- */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

/** 圆角矩形距离场 */
function sdRoundRect(px, py, hx, hy, r) {
  const qx = Math.abs(px) - hx + r;
  const qy = Math.abs(py) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** 线段距离场 */
function sdSegment(px, py, ax, ay, bx, by) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h);
}

const coverage = (d) => clamp(0.5 - d, 0, 1);

/* ---------------- 绘制 ---------------- */

// 折线（价格走势）设计坐标，基于 512 画布
const POLYLINE = [
  [116, 356],
  [196, 258],
  [266, 306],
  [348, 184],
  [428, 230],
];
const STROKE = 30;

function drawIcon({ size = 512, maskable = false } = {}) {
  const W = size;
  const k = size / 512; // 设计坐标 → 输出坐标
  const buf = Buffer.alloc(W * W * 4);

  // maskable 需要安全区，内容缩到 76%
  const scale = maskable ? 0.76 : 1;

  const bgHalf = maskable ? W / 2 : W / 2 - W * 0.02;
  const bgRadius = maskable ? W / 2 : W * 0.22;

  const pts = POLYLINE.map(([x, y]) => [x * k, y * k]);
  const stroke = STROKE * k;

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      const i = (y * W + x) * 4;

      // --- 背景圆角矩形 ---
      const aBg = coverage(sdRoundRect(cx - W / 2, cy - W / 2, bgHalf, bgHalf, bgRadius));
      if (aBg <= 0) continue;

      // 对角渐变 #457aff → #1a2f9e + 左上高光
      const t = clamp((cx + cy) / (2 * W), 0, 1);
      let r = mix(0x45, 0x1a, t);
      let g = mix(0x7a, 0x2f, t);
      let b = mix(0xff, 0x9e, t);
      const glow = Math.max(0, 1 - Math.hypot(cx - W * 0.26, cy - W * 0.2) / (W * 0.72));
      r = mix(r, 0x8f, glow * 0.42);
      g = mix(g, 0xb4, glow * 0.42);
      b = mix(b, 0xff, glow * 0.42);

      // --- 前景：设计坐标换算 ---
      const px = (cx - W / 2) / scale + W / 2;
      const py = (cy - W / 2) / scale + W / 2;

      let dLine = Infinity;
      for (let s = 0; s < pts.length - 1; s++) {
        dLine = Math.min(dLine, sdSegment(px, py, pts[s][0], pts[s][1], pts[s + 1][0], pts[s + 1][1]));
      }
      const lineA = coverage(dLine - stroke / 2) * scale;

      let dotA = 0;
      for (const [ax, ay] of pts) {
        dotA = Math.max(dotA, coverage(Math.hypot(px - ax, py - ay) - stroke * 0.68) * scale);
      }

      // 末端高亮点（涨红）
      const [ex, ey] = pts[pts.length - 1];
      const endA = coverage(Math.hypot(px - ex, py - ey) - stroke * 1.0) * scale;

      const alphaFg = Math.max(lineA, dotA, endA);
      const fr = mix(255, 0xe5, endA);
      const fg = mix(255, 0x48, endA);
      const fb = mix(255, 0x4d, endA);

      r = mix(r, fr, alphaFg);
      g = mix(g, fg, alphaFg);
      b = mix(b, fb, alphaFg);

      buf[i] = Math.round(clamp(r, 0, 255));
      buf[i + 1] = Math.round(clamp(g, 0, 255));
      buf[i + 2] = Math.round(clamp(b, 0, 255));
      buf[i + 3] = Math.round(aBg * 255);
    }
  }

  return encodePNG(W, W, buf);
}

/* ---------------- 输出 ---------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-512.png', { size: 512 }],
  ['icon-192.png', { size: 192 }],
  ['apple-touch-icon.png', { size: 180 }],
  ['icon-maskable-512.png', { size: 512, maskable: true }],
  ['favicon.png', { size: 64 }],
];

for (const [name, opts] of targets) {
  const data = drawIcon(opts);
  fs.writeFileSync(path.join(OUT_DIR, name), data);
  console.log(`  ✓ icons/${name}  ${opts.size}x${opts.size}  (${(data.length / 1024).toFixed(1)} KB)`);
}

console.log('\n图标生成完成 →', OUT_DIR);
