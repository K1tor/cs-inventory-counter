// 生成扩展图标(纯 Node,无依赖):暗色圆角底 + 箱子 + 橙色"+"徽章
// 用法: node tools/make-icons.js
'use strict';
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------- PNG 编码 ----------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 简单画布 ----------
function makeCanvas(w, h) {
  const buf = Buffer.alloc(w * h * 4); // 全透明
  return {
    w, h,
    set(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
      const i = (y * w + x) * 4;
      if (a >= 255) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; return; }
      const da = buf[i + 3];
      const na = a + da - (a * da) / 255;
      if (na <= 0) return;
      buf[i] = Math.round((r * a + buf[i] * da * (1 - a / 255)) / na);
      buf[i + 1] = Math.round((g * a + buf[i + 1] * da * (1 - a / 255)) / na);
      buf[i + 2] = Math.round((b * a + buf[i + 2] * da * (1 - a / 255)) / na);
      buf[i + 3] = Math.round(na);
    },
    rect(x0, y0, x1, y1, r, g, b, a) {
      for (let y = Math.max(0, y0); y < Math.min(h, y1); y++)
        for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) this.set(x, y, r, g, b, a);
    },
    roundRect(x0, y0, x1, y1, rad, r, g, b, a) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const dx = Math.max(x0 + rad - x, x - (x1 - rad - 1), 0);
          const dy = Math.max(y0 + rad - y, y - (y1 - rad - 1), 0);
          if (dx * dx + dy * dy <= rad * rad) this.set(x, y, r, g, b, a);
        }
      }
    },
    circle(cx, cy, radius, r, g, b, a) {
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          const dx = x - cx + 0.5, dy = y - cy + 0.5;
          if (dx * dx + dy * dy <= radius * radius) this.set(x, y, r, g, b, a);
        }
    },
    line(x0, y0, x1, y1, thickness, r, g, b, a) {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1;
      const half = thickness / 2;
      for (let t = 0; t <= len; t += 0.5) {
        const x = x0 + ((x1 - x0) * t) / len;
        const y = y0 + ((y1 - y0) * t) / len;
        for (let dy = -half; dy <= half; dy += 0.5)
          for (let dx = -half; dx <= half; dx += 0.5) this.set(Math.round(x + dx), Math.round(y + dy), r, g, b, a);
      }
    },
    toRGBA() { return buf; },
  };
}

function draw(size) {
  const c = makeCanvas(size, size);
  const s = size / 128; // 缩放系数

  // 背景圆角方块(Steam 深蓝)
  c.roundRect(2 * s, 2 * s, 126 * s, 126 * s, 22 * s, 27, 40, 56, 255);

  // 箱子主体
  const bx0 = 24 * s, by0 = 46 * s, bx1 = 104 * s, by1 = 102 * s;
  c.rect(bx0, by0, bx1, by1, 217, 160, 54, 255);              // 琥珀色
  c.rect(bx0, by0, bx0 + 4 * s, by1, 138, 90, 31, 255);       // 左边框
  c.rect(bx1 - 4 * s, by0, bx1, by1, 138, 90, 31, 255);       // 右边框
  c.rect(bx0, by1 - 4 * s, bx1, by1, 138, 90, 31, 255);       // 下边框
  c.rect(bx0, by0, bx1, by0 + 4 * s, 138, 90, 31, 255);       // 上边框

  // 箱盖(顶部深色条)
  c.rect(bx0, by0, bx1, 60 * s, 176, 125, 43, 255);
  c.rect(bx0, 60 * s, bx1, 63 * s, 138, 90, 31, 255);

  // 箱锁
  c.rect(58 * s, 32 * s, 70 * s, 46 * s, 201, 187, 129, 255);
  c.rect(60 * s, 34 * s, 68 * s, 44 * s, 138, 90, 31, 255);
  c.rect(63 * s, 40 * s, 65 * s, 44 * s, 60, 42, 18, 255); // 锁孔

  // 斜向高光条纹
  c.line(26 * s, 100 * s, 102 * s, 48 * s, 7 * s, 240, 192, 96, 180);

  // 右下角 "+" 徽章
  c.circle(102 * s, 106 * s, 21 * s, 227, 76, 38, 255);
  c.circle(102 * s, 106 * s, 21 * s, 176, 58, 28, 60); // 外圈加深
  const pw = 5 * s, pr = 9 * s;
  c.rect((102 - pr) * s, (106 - pw) * s, (102 + pr) * s, (106 + pw) * s, 255, 255, 255, 255);
  c.rect((102 - pw) * s, (106 - pr) * s, (102 + pw) * s, (106 + pr) * s, 255, 255, 255, 255);

  return encodePNG(size, size, c.toRGBA());
}

// 最近邻降采样
function downsample(rgba, from, to) {
  const out = Buffer.alloc(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const sx = Math.min(from - 1, Math.floor(x * ratio));
      const sy = Math.min(from - 1, Math.floor(y * ratio));
      const si = (sy * from + sx) * 4;
      const di = (y * to + x) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
const png128 = draw(128);
fs.writeFileSync(path.join(outDir, 'icon128.png'), png128);
for (const sz of [64, 48, 32, 16]) {
  const big = draw(sz * 4); // 先生成大图再降采样,保证边缘平滑
  const rgba = big.subarray ? big : big; // Buffer 已是 RGBA 数据
  // 直接从大图取子区域:重新按比例画更好 —— 简化:直接画对应尺寸再降采样
  const small = encodePNG(sz, sz, downsample(rgba, sz * 4, sz));
  fs.writeFileSync(path.join(outDir, `icon${sz}.png`), small);
}
console.log('icons generated:', fs.readdirSync(outDir).join(', '));
