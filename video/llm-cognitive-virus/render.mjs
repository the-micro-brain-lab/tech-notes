// Render the 9:16 video frames from build/timeline.json and pipe them into ffmpeg.
// Usage: node render.mjs [--still t1,t2,...]   (stills go to build/still-<t>.png)
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';

const W = 1080, H = 1920, FPS = 30;
const TL = JSON.parse(fs.readFileSync('build/timeline.json', 'utf8'));
const SC = Object.fromEntries(TL.scenes.map(s => [s.id, s]));
const CUE = Object.assign({}, ...TL.scenes.map(s => s.cues));
const TOTAL = TL.total;

for (const f of fs.readdirSync('fonts')) GlobalFonts.registerFromPath('fonts/' + f);
const BV = { 400: 'Be Vietnam Pro', 500: 'Be Vietnam Pro Medium', 600: 'Be Vietnam Pro SemiBold', 700: 'Be Vietnam Pro', 800: 'Be Vietnam Pro ExtraBold' };
const sans = (w, px) => `${w === 700 ? 700 : 400} ${px}px '${BV[w]}'`;
const serif = (w, px, it = false) => `${it ? 'italic ' : ''}${w} ${px}px 'Literata'`;
const mono = (w, px) => `${w} ${px}px 'JetBrains Mono'`;

// Palette: the note's dark-mode colours.
const COL = {
  bg: '#0f1115', ink: '#e8e9ed', muted: '#9b9fa9', faint: '#5d616b', line: '#2d3037',
  U: '#929AF2', C: '#E9AE4C', D: '#F27FA8', G: '#52C7AD', band: '#E9C46A', paper: '#F3EFE6', paperInk: '#22242a',
};
const RGB = Object.fromEntries(Object.entries(COL).map(([k, v]) => [k, [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16))]));
const STATE_RGB = [RGB.U, RGB.C, RGB.D];

// ---------- helpers ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const easeOut = x => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = x => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const backOut = x => { x = clamp(x); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
// Fade in over [a, a+fi], hold, fade out over [b-fo, b].
const win = (t, a, b, fi = 0.4, fo = 0.4) => Math.min(smooth((t - a) / fi), smooth((b - t) / fo));
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
const fmt = (v, d = 2) => v.toFixed(d).replace('.', ',');
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Be Vietnam Pro has no Greek, arrows or radicals; Literata has no angle brackets.
// Split a string into runs so every character is drawn with a font that has it.
const GREEK = /[ΓΛκλμρσ]/, SERIF_SYM = /[→√≥]/, ANGLE = /[⟨⟩]/;
function segments(s, font) {
  const px = +(font.match(/(\d+)px/) || [0, 30])[1], isSans = font.includes('Be Vietnam'), isMono = font.includes('JetBrains');
  const it = font.startsWith('italic');
  const pick = ch => {
    if (ANGLE.test(ch) && !isMono) return mono(700, Math.round(px * 0.9));
    if (isSans && GREEK.test(ch)) return serif(500, Math.round(px * 1.1), true);
    if (isSans && SERIF_SYM.test(ch)) return serif(500, px, it);
    return font;
  };
  const out = [];
  for (const ch of s) { const f = pick(ch); if (out.length && out[out.length - 1][1] === f) out[out.length - 1][0] += ch; else out.push([ch, f]); }
  return out;
}
const GLYPHLOG = process.env.GLYPHLOG ? new Set() : null;
function fill(s, x, y) { if (GLYPHLOG) GLYPHLOG.add(ctx.font + '|' + s); ctx.fillText(s, x, y); }
function text(s, x, y, font, color, align = 'left', alpha = 1) {
  if (alpha <= 0) return;
  rich([[s, font, color]], x, y, align, alpha);
}
// Rich text: runs of [string, font, color?, dy?]; returns width. align: 'left' | 'center'.
function rich(runs, x, y, align = 'left', alpha = 1, color = COL.ink) {
  runs = runs.flatMap(([s, f, c, dy]) => segments(s, f).map(([s2, f2]) => [s2, f2, c, dy]));
  ctx.save(); ctx.globalAlpha *= alpha; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  const ws = runs.map(([s, f]) => { ctx.font = f; return ctx.measureText(s).width; });
  const total = ws.reduce((a, b) => a + b, 0);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const boxes = [];
  runs.forEach(([s, f, c, dy], i) => { ctx.font = f; ctx.fillStyle = c || color; fill(s, cx, y + (dy || 0)); boxes.push([cx, ws[i]]); cx += ws[i]; });
  ctx.restore();
  return { total, boxes };
}
function rrect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function arrowHead(x, y, ang, size, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size, -size * 0.55); ctx.lineTo(-size * 0.7, 0); ctx.lineTo(-size, size * 0.55); ctx.closePath(); ctx.fill(); ctx.restore();
}
function wrapLines(s, font, maxW) {
  ctx.font = font; const out = []; let line = '';
  for (const w of s.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; }
  if (line) out.push(line); return out;
}

// ---------- the model (paper's illustrative parameters) ----------
const P = { rho: 0.1, kappa: 0.4, mu: 0.2, sigma: 0.1, eps: 0.0004 };
const LAM_TC = P.rho + P.kappa, LAM_SN = 2 * Math.sqrt(P.kappa * P.rho);
const GU = 1, GC = 0.5, GD = 0.1, g = (GC * P.sigma + GD * P.mu) / (P.mu + P.sigma);
const disc = l => l * l - 4 * P.kappa * P.rho;
const Ulow = l => (l - Math.sqrt(disc(l))) / (2 * P.kappa);
const Uhigh = l => (l + Math.sqrt(disc(l))) / (2 * P.kappa);
function deriv([U, C, D], l) {
  const inf = (l * C + P.eps) * U, back = P.kappa * U * U * C;
  return [-inf + P.rho * C + back, inf - (P.mu + P.rho) * C + P.sigma * D - back, P.mu * C - P.sigma * D];
}
function rk4(y, l, h) {
  const a = deriv(y, l), b = deriv(y.map((v, i) => v + h / 2 * a[i]), l), c = deriv(y.map((v, i) => v + h / 2 * b[i]), l), d = deriv(y.map((v, i) => v + h * c[i]), l);
  return y.map((v, i) => v + h / 6 * (a[i] + 2 * b[i] + 2 * c[i] + d[i]));
}
const ramp = (t, a, b, t0, t1) => lerp(a, b, smooth((t - t0) / (t1 - t0)));
function lamAt(t) {
  if (t < CUE.cross) return ramp(t, 0.30, 0.45, CUE.up, CUE.at45 - 0.1);
  if (t < CUE.down) return ramp(t, 0.45, 0.60, CUE.cross + 0.1, CUE.cross + 0.9);
  if (t < CUE.below) return ramp(t, 0.60, 0.45, CUE.down, CUE.down + 0.8);
  return ramp(t, 0.45, 0.30, CUE.below, CUE.below + 0.7);
}
// Precompute the demo trajectory frame by frame (sim speed: 50 model time units per second).
const DEMO0 = SC.demo.start - 0.6, DEMO1 = SC.why.start + 1.5, K = 50;
const traj = [];
{
  let y = [0.996, 0.003, 0.001];
  for (let i = 0; i < 4000; i++) y = rk4(y, 0.30, 0.05);
  for (let f = Math.floor(DEMO0 * FPS); f <= Math.ceil(DEMO1 * FPS) + 1; f++) {
    const t = f / FPS, l = lamAt(t), h = K / FPS / 20;
    traj.push({ t, l, U: y[0], C: y[1], D: y[2] });
    for (let k = 0; k < 20; k++) y = rk4(y, l, h);
  }
}
const trajAt = t => traj[clamp(Math.round((t - DEMO0) * FPS), 0, traj.length - 1)];

// ---------- agents ----------
const N = 360, GOLD = Math.PI * (3 - Math.sqrt(5));
const agents = [];
{
  const order = [...Array(N).keys()].sort(() => rnd() - 0.5);
  for (let i = 0; i < N; i++) {
    const r = Math.sqrt((i + 0.5) / N) * 0.93, th = i * GOLD + (rnd() - 0.5) * 0.5;
    const hx = r * Math.cos(th) + (rnd() - 0.5) * 0.04, hy = r * Math.sin(th) + (rnd() - 0.5) * 0.04;
    agents.push({
      i, hx, hy, rank: order.indexOf(i) / N, w: [0.4 + rnd() * 0.5, 0.4 + rnd() * 0.5, rnd() * 6.28, rnd() * 6.28],
      om: 4.2 + rnd() * 3.2, x: 540 + hx * 360, y: 780 + hy * 360, vx: 0, vy: 0, s: 0, prev: 0, tc: -9, rad: 5,
      noise: rnd(), dhash: rnd(),
    });
  }
}
// Spatial contagion for the hook, seeded from one agent near the centre.
const SEED = agents.reduce((b, a) => (Math.hypot(a.hx - 0.08, a.hy + 0.05) < Math.hypot(b.hx - 0.08, b.hy + 0.05) ? a : b));
agents.forEach(a => { a.dist = Math.hypot(a.hx - SEED.hx, a.hy - SEED.hy); });

function hookState(a, t) {
  if (t < CUE.ai) return 0;
  if (a === SEED) return 1;
  const R = 1.25 * easeInOut((t - CUE.spread) / 2.4);
  const tHit = a.dist + a.noise * 0.12;
  if (t < CUE.spread || tHit > R) return 0;
  return a.dhash < 0.3 && R - tHit > 0.35 ? 2 : 1;
}
const stateFromFractions = (a, u, c) => (a.rank < u ? 0 : a.rank < u + c ? 1 : 2);
// Fractions (U, C) for the compartment scenes.
function compFractions(t) {
  let u = 1, c = 0;
  if (t > CUE.C) { const p = smooth((t - CUE.C) / 0.7); u = lerp(1, 0.6, p); c = lerp(0, 0.4, p); }
  if (t > CUE.D) { const p = smooth((t - CUE.D) / 0.7); c = lerp(0.4, 0.25, p); }
  if (t > CUE.lam) { const p = smooth((t - CUE.lam - 0.6) / 1.2); u = lerp(0.6, 0.45, p); c = lerp(0.25, 0.33, p); }
  if (t > CUE.kap) { const p = smooth((t - CUE.kap - 0.6) / 1.2); u = lerp(0.45, 0.6, p); c = lerp(0.33, 0.25, p); }
  return [u, c];
}
function agentState(a, t) {
  if (t < SC.states.start + 0.2 || t < CUE.U) return hookState(a, Math.min(t, SC.source.start + 1.0));
  if (t < DEMO0 + 0.3) { const [u, c] = compFractions(t); return stateFromFractions(a, u, c); }
  if (t < DEMO1) { const y = trajAt(t); return stateFromFractions(a, y.U, y.C); }
  return 0;
}

// Layouts: where each agent wants to be.
const COMP_BIG = { cx: [190, 540, 890], cy: 680, R: 128 };
const COMP_SMALL = { cx: [210, 540, 870], cy: 450, R: 100 };
const DISH_HOOK = { cx: 540, cy: 850, R: 370 };
const DISH_DEMO = { cx: 290, cy: 445, R: 205 };
const DISH_END = { cx: 540, cy: 830, R: 300 };
function lerpRect(a, b, p) { const o = {}; for (const k in a) o[k] = Array.isArray(a[k]) ? a[k].map((v, i) => lerp(v, b[k][i], p)) : lerp(a[k], b[k], p); return o; }
function compLayout(t) { return lerpRect(COMP_BIG, COMP_SMALL, easeInOut((t - SC.forces.start + 0.2) / 0.9)); }
function layoutMode(t) {
  if (t < CUE.U - 0.05) return { mode: 'dish', d: DISH_HOOK, r: 5.4 };
  if (t < SC.demo.start - 0.35) { const L = compLayout(t); return { mode: 'comp', c: L, r: lerp(4.6, 3.5, (128 - L.R) / 30) }; }
  if (t < CUE.q - 0.3) return { mode: 'dish', d: DISH_DEMO, r: 3.9 };
  return { mode: 'dish', d: DISH_END, r: 4.6 };
}
function updateAgents(t, dt) {
  const L = layoutMode(t);
  const counts = [0, 0, 0];
  const sorted = [...agents].sort((p, q) => p.rank - q.rank);
  for (const a of sorted) {
    const s = agentState(a, t);
    if (s !== a.s) { a.prev = a.s; a.s = s; a.tc = t; }
    let tx, ty;
    if (L.mode === 'dish') {
      const wob = 0.035;
      tx = L.d.cx + (a.hx + wob * Math.sin(t * a.w[0] + a.w[2])) * L.d.R;
      ty = L.d.cy + (a.hy + wob * Math.cos(t * a.w[1] + a.w[3])) * L.d.R;
    } else {
      const j = counts[a.s]++, s0 = L.c.R * 0.9 / Math.sqrt(N * 0.62);
      const r = s0 * Math.sqrt(j + 0.5), th = j * GOLD;
      tx = L.c.cx[a.s] + r * Math.cos(th) + 1.5 * Math.sin(t * a.w[0] * 2 + a.w[2]);
      ty = L.c.cy + r * Math.sin(th) + 1.5 * Math.cos(t * a.w[1] * 2 + a.w[3]);
    }
    // Critically damped spring towards the target, two substeps.
    for (let k = 0; k < 2; k++) {
      const h = dt / 2, om = a.om;
      a.vx += (om * om * (tx - a.x) - 2 * om * a.vx) * h; a.vy += (om * om * (ty - a.y) - 2 * om * a.vy) * h;
      a.x += a.vx * h; a.y += a.vy * h;
    }
    a.rad = lerp(a.rad, L.r, 1 - Math.exp(-dt * 5));
  }
}
function drawAgents(t, alpha) {
  if (alpha <= 0) return;
  ctx.save(); ctx.globalAlpha = alpha;
  for (const a of agents) {
    const p = clamp((t - a.tc) / 0.45);
    const c = mix(STATE_RGB[a.prev], STATE_RGB[a.s], p);
    ctx.fillStyle = rgba(c, 0.13); ctx.beginPath(); ctx.arc(a.x, a.y, a.rad * 2.7, 0, 6.2832); ctx.fill();
    ctx.fillStyle = rgba(c, 1); ctx.beginPath(); ctx.arc(a.x, a.y, a.rad, 0, 6.2832); ctx.fill();
    if (t - a.tc < 0.7 && a.tc > 0) {
      const q = (t - a.tc) / 0.7;
      ctx.strokeStyle = rgba(STATE_RGB[a.s], 0.7 * (1 - q)); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.rad + 18 * easeOut(q), 0, 6.2832); ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- background, grain, chrome ----------
const grain = [];
for (let k = 0; k < 4; k++) {
  const g = createCanvas(540, 960), gx = g.getContext('2d'), id = gx.createImageData(540, 960);
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  gx.putImageData(id, 0, 0); grain.push(g);
}
function background(t) {
  ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);
  const gr = ctx.createRadialGradient(540, 760, 60, 540, 760, 1250);
  gr.addColorStop(0, 'rgba(60,66,120,0.20)'); gr.addColorStop(0.5, 'rgba(25,28,40,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
}
function finishGrain(f) {
  ctx.save(); ctx.globalAlpha = 0.045; ctx.globalCompositeOperation = 'overlay';
  ctx.drawImage(grain[f % 4], 0, 0, W, H); ctx.restore();
}
const CHAPTERS = [
  ['hook', '01', 'Câu hỏi'], ['source', '02', 'Nguồn'], ['states', '03', 'Mô hình'], ['forces', '04', 'Hai lực'],
  ['demo', '05', 'Thí nghiệm'], ['why', '06', 'Vì sao'], ['take', '07', 'Bài học'],
];
function chrome(t) {
  const a = smooth(t / 0.8) * smooth((TOTAL - 0.2 - t) / 0.5);
  // progress
  const pw = W * clamp(t / TOTAL);
  const pg = ctx.createLinearGradient(0, 0, W, 0); pg.addColorStop(0, COL.U); pg.addColorStop(0.55, COL.C); pg.addColorStop(1, COL.D);
  ctx.fillStyle = COL.line; ctx.fillRect(0, 0, W, 6); ctx.fillStyle = pg; ctx.fillRect(0, 0, pw, 6);
  // brand
  ctx.save(); ctx.globalAlpha = a * 0.9; ctx.translate(72, 92); ctx.rotate(Math.PI / 4); ctx.fillStyle = COL.U; ctx.fillRect(-8, -8, 16, 16); ctx.restore();
  text('THE MICRO BRAIN LAB', 98, 101, sans(600, 25), COL.muted, 'left', a);
  // chapter
  let cur = CHAPTERS[0];
  for (const c of CHAPTERS) if (t >= SC[c[0]].start - 0.3) cur = c;
  if (t < TOTAL - TL_END_LEN) {
    const since = t - (SC[cur[0]].start - 0.3), ca = a * smooth(since / 0.4);
    rich([['§' + Number(cur[1]) + '  ', serif(500, 28, true), COL.muted], [cur[2], sans(600, 25), COL.ink]], W - 64, 101, 'right', ca);
  }
}
const TL_END_LEN = TOTAL - SC.take.end - 0.5;

// ---------- captions ----------
// One colour per concept, used the same way in captions, labels, equations and charts:
// U / tự chủ / κ, ρ (pull back to autonomy) · C / dùng có kiểm soát / λ, sức lây (push to use)
// D / lệ thuộc / lật / λTC · G / hồi phục / năng lực Γ / λSN · band / hiện tượng trễ.
const TERMS = [
  ['tự chủ', 'U'], ['sức kéo tập thể', 'U'], ['dùng có kiểm soát', 'C'], ['λ', 'C'], ['sức lây', 'C'], ['virus', 'C'],
  ['lệ thuộc', 'D'], ['lật', 'D'], ['0,5', 'D'], ['hồi phục', 'G'], ['0,4', 'G'], ['năng lực', 'G'],
  ['hiện tượng trễ', 'band'], ['phòng dễ hơn chữa', 'G'],
];
const CAP_FONT = sans(600, 50), CAP_MAX = 940, CAP_Y = 1478, CAP_LH = 68;
// Attach the punctuation that follows each spoken word in the scene text.
{
  const pos = {};
  for (const w of TL.words) {
    const sc = SC[w.scene], spoken = w.w === 'λ' ? 'lam-đa' : w.w;
    const i = sc.text.indexOf(spoken, pos[w.scene] || 0);
    let j = i + spoken.length;
    while (j < sc.text.length && /[.,:;?!]/.test(sc.text[j])) j++;
    w.disp = w.w + sc.text.slice(i + spoken.length, j);
    pos[w.scene] = j;
  }
  // Colour key terms (multi-word phrases matched on the bare words).
  const bare = s => s.toLowerCase().replace(/[.,:;?!]/g, '');
  TL.words.forEach((w, i) => {
    for (const [ph, col] of TERMS) {
      const parts = ph.split(' ');
      if (parts.every((p, k) => TL.words[i + k] && TL.words[i + k].scene === w.scene && bare(TL.words[i + k].w) === p))
        parts.forEach((_, k) => { TL.words[i + k].col = TL.words[i + k].col || col; });
    }
  });
}
const chunks = [];
{
  let cur = [];
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; };
  TL.words.forEach((w, i) => {
    const prev = TL.words[i - 1];
    if (prev && prev.scene !== w.scene) flush();
    ctx.font = CAP_FONT;
    const test = [...cur, w].map(x => x.w).join(' ');
    if (cur.length && ctx.measureText(test).width > CAP_MAX * 1.75) flush();
    cur.push(w);
    if (w.brk && ctx.measureText(cur.map(x => x.w).join(' ')).width > CAP_MAX * 0.55) flush();
  });
  flush();
}
function captions(t) {
  const idx = chunks.findIndex((c, i) => t >= c[0].t - 0.12 && (i + 1 >= chunks.length || t < chunks[i + 1][0].t - 0.12));
  if (idx < 0) return;
  const c = chunks[idx], last = c[c.length - 1];
  const a = smooth((t - c[0].t + 0.12) / 0.15) * smooth((last.e + 0.9 - t) / 0.25);
  if (a <= 0) return;
  ctx.font = CAP_FONT;
  const space = ctx.measureText(' ').width;
  const ws = c.map(w => segments(w.disp, CAP_FONT).reduce((s, [str, f]) => { ctx.font = f; return s + ctx.measureText(str).width; }, 0));
  ctx.font = CAP_FONT;
  const span = (a, b) => ws.slice(a, b).reduce((s, v) => s + v, 0) + space * Math.max(0, b - a - 1);
  // One line if it fits; otherwise the split that best balances the two lines, preferring punctuation.
  let lines = [c.map((w, i) => ({ ...w, ww: ws[i] }))];
  if (span(0, c.length) > CAP_MAX) {
    let best = 1, bestCost = Infinity;
    for (let k = 1; k < c.length; k++) {
      const m = Math.max(span(0, k), span(k, c.length));
      const cost = m - (/[.,:;?!]$/.test(c[k - 1].disp) ? 120 : 0);
      if (m <= CAP_MAX && cost < bestCost) { bestCost = cost; best = k; }
    }
    lines = [lines[0].slice(0, best), lines[0].slice(best)];
  }
  const y0 = CAP_Y - (lines.length - 1) * CAP_LH / 2;
  // soft backdrop
  ctx.save(); ctx.globalAlpha = a * 0.55;
  const bg = ctx.createRadialGradient(540, CAP_Y, 20, 540, CAP_Y, 560); bg.addColorStop(0, 'rgba(8,9,12,0.9)'); bg.addColorStop(1, 'rgba(8,9,12,0)');
  ctx.fillStyle = bg; ctx.fillRect(0, CAP_Y - 200, W, 400); ctx.restore();
  lines.forEach((ln, li) => {
    const tw = ln.reduce((s, w) => s + w.ww, 0) + space * (ln.length - 1);
    let x = 540 - tw / 2;
    for (const w of ln) {
      const spoken = t >= w.t - 0.03;
      text(w.disp, x, y0 + li * CAP_LH, CAP_FONT, w.col ? COL[w.col] : COL.ink, 'left', a * (spoken ? 1 : 0.42));
      x += w.ww + space;
    }
  });
}
function footer(t) {
  const a = win(t, SC.source.start + 0.6, TOTAL - TL_END_LEN, 0.6, 0.4) * 0.85;
  text('Solé, Ruffini, …, Krakauer, Levin · arXiv:2609.03344 (2026)', 540, 1660, sans(500, 25), COL.faint, 'center', a);
}

// ---------- scene: hook ----------
function dishRing(d, a, glow = 0.18) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  const gr = ctx.createRadialGradient(d.cx, d.cy, d.R * 0.2, d.cx, d.cy, d.R * 1.12);
  gr.addColorStop(0, `rgba(146,154,242,${glow * 0.35})`); gr.addColorStop(1, 'rgba(146,154,242,0)');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(d.cx, d.cy, d.R * 1.12, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = 'rgba(232,233,237,0.14)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(d.cx, d.cy, d.R * 1.03, 0, 6.2832); ctx.stroke();
  ctx.restore();
}
function sceneHook(t) {
  const a = win(t, 0, SC.source.start + 0.3, 0.9, 0.6);
  dishRing(DISH_HOOK, a);
  // ripple from the first infected agent
  if (t > CUE.ai) {
    for (let k = 0; k < 3; k++) {
      const q = (t - CUE.ai - k * 0.35) / 1.6;
      if (q > 0 && q < 1) { ctx.strokeStyle = rgba(RGB.C, 0.55 * (1 - q)); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(SEED.x, SEED.y, 10 + 300 * easeOut(q), 0, 6.2832); ctx.stroke(); }
    }
  }
  const ta = win(t, CUE.title - 0.1, SC.source.start + 0.2, 0.5, 0.5);
  const dy = 24 * (1 - easeOut((t - CUE.title + 0.1) / 0.6));
  text('LLM như một', 540, 252 + dy, serif(600, 80), COL.ink, 'center', ta);
  rich([['virus', serif(500, 84, true), COL.C], [' nhận thức?', serif(500, 84, true), COL.ink]], 540, 350 + dy, 'center', ta);
  // question mark watermark before title
  const qa = win(t, 0.3, CUE.title, 0.6, 0.3) * 0.9;
  text('Nếu tư duy cũng lây?', 540, 330, serif(500, 64, true), COL.muted, 'center', qa);
}

// ---------- scene: source (paper card) ----------
function sceneSource(t) {
  const t0 = SC.source.start - 0.15, t1 = SC.states.start + 0.2;
  const a = win(t, t0, t1, 0.5, 0.45);
  if (a <= 0) return;
  const rise = easeOut((t - t0) / 0.8), out = easeInOut((t - (t1 - 0.45)) / 0.45);
  ctx.save(); ctx.globalAlpha = a;
  ctx.translate(540, 820 + 140 * (1 - rise) - 120 * out); ctx.rotate((-2.5 * (1 - rise)) * Math.PI / 180);
  const cw = 880, ch = 760, x = -cw / 2, y = -ch / 2;
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24;
  ctx.fillStyle = COL.paper; rrect(x, y, cw, ch, 18); ctx.fill(); ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#B31B1B'; ctx.fillRect(x, y + 34, 10, 52);
  text('arXiv:2609.03344', x + 56, y + 74, mono(700, 30), '#B31B1B');
  text('tháng 9/2026', x + cw - 50, y + 74, sans(500, 26), '#6b6f78', 'right');
  text('Large-Language Models', x + 56, y + 178, serif(700, 58), COL.paperInk);
  text('as a Cognitive Virus', x + 56, y + 248, serif(700, 58), COL.paperInk);
  const auth = 'R. Solé · G. Ruffini · F. Castaldo · M. Tuccio · L. F. Seoane · M. De Domenico · S. F. Elena · D. C. Krakauer · M. Levin';
  wrapLines(auth, sans(500, 27), cw - 112).forEach((l, i) => text(l, x + 56, y + 312 + i * 40, sans(500, 27), '#4a4e57'));
  ctx.fillStyle = '#d9d4c8'; ctx.fillRect(x + 56, y + 420, cw - 112, 2);
  // mini compartment diagram
  const ma = smooth((t - CUE.model) / 0.5);
  const mx = [x + 180, 0, x + cw - 180], my = y + 540; mx[1] = (mx[0] + mx[2]) / 2;
  ctx.globalAlpha = a * ma;
  ['U', 'C', 'D'].forEach((k, i) => {
    ctx.fillStyle = ['#3D46A8', '#B5740F', '#C23A6E'][i]; ctx.beginPath(); ctx.arc(mx[i], my, 50, 0, 6.2832); ctx.fill();
    text(k, mx[i], my + 16, serif(600, 46, true), '#fff', 'center');
  });
  ctx.strokeStyle = '#6b6f78'; ctx.lineWidth = 3;
  for (let i = 0; i < 2; i++) {
    ctx.beginPath(); ctx.moveTo(mx[i] + 62, my - 10); ctx.lineTo(mx[i + 1] - 66, my - 10); ctx.stroke(); arrowHead(mx[i + 1] - 62, my - 10, 0, 14, '#6b6f78');
    ctx.beginPath(); ctx.moveTo(mx[i + 1] - 62, my + 14); ctx.lineTo(mx[i] + 66, my + 14); ctx.stroke(); arrowHead(mx[i] + 62, my + 14, Math.PI, 14, '#6b6f78');
  }
  text('mô hình ngăn', x + cw / 2, my + 100, sans(600, 28), '#4a4e57', 'center');
  ctx.globalAlpha = a * smooth((t - CUE.epi) / 0.5);
  text('cùng họ với mô hình SIR của dịch tễ học', x + cw / 2, my + 146, sans(500, 27), '#6b6f78', 'center');
  ctx.restore();
}

// ---------- compartments (states + forces) ----------
function flowPath(L, from, to, upper) {
  const x0 = L.cx[from], x1 = L.cx[to], y = L.cy, R = L.R, dir = Math.sign(x1 - x0), lift = upper ? -1 : 1;
  const sx = x0 + dir * R * 0.82, sy = y + lift * R * 0.5, ex = x1 - dir * R * 0.82, ey = sy;
  const mx = (sx + ex) / 2, my = y + lift * (R * 0.5 + 34 + R * 0.28);
  return { sx, sy, mx, my, ex, ey, at: u => ({ x: (1 - u) * (1 - u) * sx + 2 * u * (1 - u) * mx + u * u * ex, y: (1 - u) * (1 - u) * sy + 2 * u * (1 - u) * my + u * u * ey }) };
}
const FLOWS = [
  { from: 0, to: 1, up: true, label: [['λ', 'C'], ['UC']], col: 'C', cue: 'C', key: 'lam' },
  { from: 1, to: 2, up: true, label: [['μ', 'D'], ['C']], col: 'D', cue: 'D', key: 'mu' },
  { from: 1, to: 0, up: false, label: [['ρ', 'U'], ['C + '], ['κ', 'U'], ['U²C']], col: 'U', cue: 'D', key: 'kap' },
  { from: 2, to: 1, up: false, label: [['σ', 'G'], ['D']], col: 'G', cue: 'D', key: 'sig' },
];
function sceneCompartments(t) {
  const t0 = CUE.U - 0.5, t1 = SC.demo.start - 0.1;
  const a = win(t, t0, t1, 0.5, 0.5);
  if (a <= 0) return;
  const L = compLayout(t), small = clamp((128 - L.R) / 27);
  ctx.save(); ctx.globalAlpha = a;
  const names = [['Tự chủ'], ['Dùng có', 'kiểm soát'], ['Lệ thuộc']];
  const ex = ['tự đọc, tự viết,', 'tự kiểm chứng'], exC = ['hỏi AI,', 'rồi kiểm lại'], exD = ['dán vào,', 'chép ra'];
  const cues = ['U', 'C', 'D'];
  ['U', 'C', 'D'].forEach((k, i) => {
    const ap = smooth((t - CUE[cues[i]] + 0.25) / 0.45), pop = backOut((t - CUE[cues[i]] + 0.25) / 0.6);
    if (ap <= 0) return;
    const cx = L.cx[i], cy = L.cy, R = L.R * (0.7 + 0.3 * pop);
    ctx.save(); ctx.globalAlpha = a * ap;
    ctx.fillStyle = rgba(RGB[k], 0.08); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.fill();
    ctx.strokeStyle = rgba(RGB[k], 0.75); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();
    text(k, cx, cy - R - 22 + small * 6, serif(600, lerp(56, 40, small), true), COL[k], 'center');
    const ny = cy + R + lerp(58, 46, small);
    if (small < 0.98) {
      ctx.globalAlpha = a * ap * (1 - small);
      names[i].forEach((n, j) => text(n, cx, ny + j * 40, sans(700, 34), COL[k], 'center'));
      const exl = [ex, exC, exD][i], ey = ny + names[i].length * 40 + 10;
      exl.forEach((n, j) => text(n, cx, ey + j * 34, sans(400, 27), COL.muted, 'center'));
    }
    ctx.restore();
  });
  // arrows
  FLOWS.forEach(fl => {
    const ap = smooth((t - CUE[fl.cue] + 0.1) / 0.5) * (fl.key === 'kap' || fl.key === 'lam' ? 1 : 0.85);
    if (ap <= 0) return;
    const hi = highlight(fl.key, t), p = flowPath(L, fl.from, fl.to, fl.up);
    const col = RGB[fl.col];
    ctx.save(); ctx.globalAlpha = a * ap * (0.55 + 0.45 * Math.max(hi, 1 - small * 0.6));
    ctx.strokeStyle = rgba(col, 0.55 + 0.45 * hi); ctx.lineWidth = 3 + 3 * hi;
    ctx.beginPath(); ctx.moveTo(p.sx, p.sy); ctx.quadraticCurveTo(p.mx, p.my, p.ex, p.ey); ctx.stroke();
    const e = p.at(1), e0 = p.at(0.96); arrowHead(e.x, e.y, Math.atan2(e.y - e0.y, e.x - e0.x), 16 + 6 * hi, rgba(col, 0.9));
    // particles
    const n = 3 + Math.round(6 * hi);
    for (let k = 0; k < n; k++) { const u = ((t * (0.45 + 0.4 * hi) + k / n) % 1); const q = p.at(u); ctx.fillStyle = rgba(col, 0.9); ctx.beginPath(); ctx.arc(q.x, q.y, 3 + 2 * hi, 0, 6.2832); ctx.fill(); }
    // label (only once the forces scene starts)
    const la = smooth((t - SC.forces.start) / 0.6);
    if (la > 0) {
      const mid = p.at(0.5), ly = mid.y + (fl.up ? -18 : 40);
      const runs = fl.label.map(([s, k]) => [s, serif(500, 30 + 4 * hi, true), k ? COL[k] : COL.ink]);
      rich(runs, mid.x, ly, 'center', la);
    }
    ctx.restore();
  });
  // "no shortcut" note
  const na = win(t, CUE.D + 0.4, SC.forces.start + 0.2, 0.5, 0.4);
  rich([['Hình 1. ', sans(700, 25), COL.muted], ['Ba trạng thái, bốn dòng chảy. Không có mũi tên', sans(400, 25), COL.muted]], 540, 1100, 'center', a * na);
  text('đi thẳng từ U sang D: lệ thuộc phải qua giai đoạn dùng.', 540, 1138, sans(400, 25), COL.muted, 'center', a * na);
  ctx.restore();
}
function highlight(key, t) {
  if (key === 'lam') return win(t, CUE.lam - 0.1, CUE.kap - 0.1, 0.3, 0.4);
  if (key === 'kap') return win(t, CUE.kap - 0.1, SC.demo.start, 0.3, 0.4);
  return 0;
}

// ---------- scene: forces (equation + square bars) ----------
function sceneForces(t) {
  const t0 = SC.forces.start + 0.3, t1 = SC.demo.start - 0.1;
  const a = win(t, t0, t1, 0.6, 0.5);
  if (a <= 0) return;
  const hl = highlight('lam', t), hk = highlight('kap', t);
  ctx.save(); ctx.globalAlpha = a;
  // equation
  const ey = 820, F = serif(500, 60, true), Fu = serif(500, 60);
  const runs = [['dU/dt', F], [' =  ', Fu], ['−', Fu], ['λ', F, COL.C], ['UC', F], ['  + ', Fu], ['ρ', F, COL.U], ['C', F], [' +  ', Fu], ['κ', F, COL.U], ['U²C', F]];
  const box = rich(runs, 520, ey, 'center', 1);
  text('(1)', 1010, ey, serif(500, 32), COL.faint, 'right');
  const term = (b0, b1, h, col, label) => {
    if (h <= 0) return;
    const bx = box.boxes[b0][0], bw = box.boxes[b1][0] + box.boxes[b1][1] - bx;
    ctx.save(); ctx.globalAlpha = a * h;
    ctx.strokeStyle = col; ctx.lineWidth = 3; rrect(bx - 10, ey - 58, bw + 20, 80, 14); ctx.stroke();
    ctx.fillStyle = col.replace('rgb', 'rgba').replace(')', ',0.12)'); rrect(bx - 10, ey - 58, bw + 20, 80, 14); ctx.fill();
    text(label, bx + bw / 2, ey + 66, sans(700, 28), col, 'center');
    ctx.restore();
  };
  term(2, 4, hl, `rgb(${RGB.C})`, 'sức lây');
  term(9, 10, hk, `rgb(${RGB.U})`, 'sức kéo tập thể');
  // explanation lines under the equation
  const l1 = win(t, CUE.lam + 0.2, CUE.kap - 0.05, 0.4, 0.3), l2 = win(t, CUE.kap + 0.2, CUE.sq - 0.05, 0.4, 0.3);
  text('người này kéo người kia dùng AI', 540, 965, sans(500, 32), COL.ink, 'center', l1);
  text('càng đông người tự nghĩ, tự nghĩ càng dễ', 540, 965, sans(500, 32), COL.ink, 'center', l2);
  // square bars
  const ba = smooth((t - CUE.sq + 0.1) / 0.5);
  if (ba > 0) {
    ctx.globalAlpha = a * ba;
    const p1 = easeInOut((t - CUE.thin) / 0.9), p2 = easeInOut((t - CUE.weak - 0.1) / 0.8);
    const U = lerp(1, 0.5, p1) - 0.2 * p2, U2 = U * U;
    const bx = 150, bw = 780, y1 = 1050, y2 = 1190;
    text('Người tự chủ  U', bx, y1, sans(600, 30), COL.ink);
    text(Math.round(U * 100) + '%', bx + bw, y1, mono(700, 32), COL.U, 'right');
    ctx.fillStyle = COL.line; rrect(bx, y1 + 18, bw, 34, 10); ctx.fill();
    ctx.fillStyle = COL.U; rrect(bx, y1 + 18, bw * U, 34, 10); ctx.fill();
    rich([['Sức kéo tập thể, tỷ lệ với ', sans(600, 30), COL.ink], ['U²', serif(500, 34, true), COL.ink]], bx, y2, 'left', 1);
    text(Math.round(U2 * 100) + '%', bx + bw, y2, mono(700, 32), COL.U, 'right');
    ctx.fillStyle = COL.line; rrect(bx, y2 + 18, bw, 34, 10); ctx.fill();
    ctx.fillStyle = '#6f78d8'; rrect(bx, y2 + 18, Math.max(12, bw * U2), 34, 10); ctx.fill();
    const na = smooth((t - CUE.thin - 0.6) / 0.4);
    text('U giảm một nửa → sức kéo chỉ còn một phần tư', 540, 1300, sans(500, 29), COL.muted, 'center', na);
    text('(hiệu ứng Allee trong sinh thái học)', 540, 1342, sans(400, 25), COL.faint, 'center', smooth((t - CUE.weak - 0.3) / 0.4));
  }
  ctx.restore();
}
function mixCol(a, b, t) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  const c = mix(pa, pb, clamp(t)); return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ---------- the hysteresis chart (demo + why) ----------
const LMIN = 0.25, LMAX = 0.70;
const trail = [];
function chart(t, R, opt) {
  const { x, y, w, h } = R;
  const X = l => x + (l - LMIN) / (LMAX - LMIN) * w, Y = u => y + h - u * h;
  ctx.save(); ctx.globalAlpha *= opt.alpha;
  // band
  ctx.fillStyle = rgba(RGB.band, 0.13); ctx.fillRect(X(LAM_SN), y, X(LAM_TC) - X(LAM_SN), h);
  // axes
  ctx.strokeStyle = COL.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + h); ctx.lineTo(x + w, y + h); ctx.stroke();
  for (const l of [0.3, 0.4, 0.5, 0.6, 0.7]) text(fmt(l, 1), X(l), y + h + 38, mono(500, opt.big ? 26 : 22), COL.muted, 'center');
  for (const u of [0, 0.5, 1]) text(fmt(u, 1), x - 14, Y(u) + 8, mono(500, opt.big ? 24 : 20), COL.faint, 'right');
  rich([['λ', serif(500, opt.big ? 34 : 28, true), COL.ink], ['  sức lây', sans(500, opt.big ? 26 : 22), COL.muted]], x + w, y + h + 80, 'right', 1);
  rich([['U*', serif(500, opt.big ? 32 : 26, true), COL.U], ['  tỷ lệ tự chủ khi cân bằng', sans(500, opt.big ? 26 : 22), COL.muted]], x, y - 22, 'left', 1);
  // branches
  const line = (pts, col, dash, lw) => { ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([l, u], i) => (i ? ctx.lineTo(X(l), Y(u)) : ctx.moveTo(X(l), Y(u)))); ctx.stroke(); ctx.setLineDash([]); };
  const lw = opt.big ? 5 : 4;
  line([[LMIN, 1], [LAM_TC, 1]], COL.U, [], lw);
  line([[LAM_TC, 1], [LMAX, 1]], '#6b6f78', [10, 10], 2.5);
  const low = [], hi = [];
  for (let l = LAM_SN; l <= LMAX + 1e-9; l += 0.0025) low.push([l, Ulow(Math.max(l, LAM_SN))]);
  for (let l = LAM_SN; l <= LAM_TC + 1e-9; l += 0.0025) hi.push([l, Math.min(1, Uhigh(Math.max(l, LAM_SN)))]);
  line(hi, '#6b6f78', [10, 10], 2.5);
  line(low, COL.D, [], lw);
  // threshold markers
  const thr = (l, col, a, lab) => {
    if (a <= 0) return;
    ctx.save(); ctx.globalAlpha *= a; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(X(l), y - 6); ctx.lineTo(X(l), y + h); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    if (lab) lab();
  };
  thr(LAM_SN, COL.G, opt.snA, opt.snLab); thr(LAM_TC, COL.D, opt.tcA, opt.tcLab);
  if (opt.extra) opt.extra(X, Y);
  // live trajectory
  if (opt.trail) {
    ctx.lineCap = 'round';
    for (let i = 1; i < trail.length; i++) {
      const p = trail[i - 1], q = trail[i];
      ctx.strokeStyle = rgba(q.col, 0.9 * opt.trailA); ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(X(p.l), Y(p.U)); ctx.lineTo(X(q.l), Y(q.U)); ctx.stroke();
    }
    const cur = trail[trail.length - 1];
    if (cur && opt.dotA > 0) {
      ctx.globalAlpha *= opt.dotA;
      ctx.fillStyle = rgba(cur.col, 0.25); ctx.beginPath(); ctx.arc(X(cur.l), Y(cur.U), 22, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(cur.l), Y(cur.U), 9, 0, 6.2832); ctx.fill();
    }
  }
  ctx.restore();
  return { X, Y };
}

// ---------- scene: demo ----------
const DEMO_CHART = { x: 140, y: 895, w: 820, h: 300 };
function sceneDemo(t) {
  const t0 = SC.demo.start - 0.3, t1 = SC.why.start + 0.4;
  const a = win(t, t0, t1, 0.6, 0.5);
  const y = trajAt(t);
  // trail bookkeeping (always, so it is ready for the why scene)
  if (t >= SC.demo.start - 0.1 && t <= SC.why.start + 1.2) {
    const phase = t < CUE.cross + 0.9 ? 'up' : t < CUE.below ? 'stuck' : 'back';
    const col = phase === 'up' ? RGB.U : phase === 'stuck' ? RGB.D : RGB.G;
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(last.l - y.l, last.U - y.U) > 0.002) trail.push({ l: y.l, U: y.U, col });
  }
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  // shake on the flip
  const sh = Math.max(0, 1 - (t - CUE.flip + 0.6) / 0.9) * (t > CUE.flip - 0.6 ? 1 : 0);
  if (sh > 0) ctx.translate(Math.sin(t * 90) * 7 * sh, Math.cos(t * 77) * 5 * sh);
  dishRing(DISH_DEMO, 1, 0.12 + 0.3 * sh);
  if (sh > 0) { ctx.strokeStyle = rgba(RGB.D, 0.6 * sh); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(DISH_DEMO.cx, DISH_DEMO.cy, DISH_DEMO.R * (1.05 + 0.4 * (1 - sh)), 0, 6.2832); ctx.stroke(); }
  // readouts
  const rx = 560, rows = [['Tự chủ', y.U, 'U'], ['Dùng có kiểm soát', y.C, 'C'], ['Lệ thuộc', y.D, 'D']];
  rows.forEach(([n, v, k], i) => {
    const ry = 292 + i * 116;
    text(n, rx, ry, sans(600, 28), COL.muted);
    text(Math.round(v * 100) + '%', rx + 420, ry + 4, mono(700, 46), COL[k], 'right');
    ctx.fillStyle = COL.line; rrect(rx, ry + 22, 420, 14, 7); ctx.fill();
    ctx.fillStyle = COL[k]; rrect(rx, ry + 22, Math.max(6, 420 * v), 14, 7); ctx.fill();
  });
  const gam = GU * y.U + GC * y.C + GD * y.D;
  rich([['⟨Γ⟩', mono(700, 28), COL.G], [' năng lực tự làm', sans(600, 27), COL.muted]], rx, 642, 'left', 1);
  text(fmt(gam, 2), rx + 420, 644, mono(700, 34), COL.G, 'right');
  // slider
  const X = l => DEMO_CHART.x + (l - LMIN) / (LMAX - LMIN) * DEMO_CHART.w, sy = 770;
  ctx.fillStyle = rgba(RGB.band, 0.18); ctx.fillRect(X(LAM_SN), sy - 14, X(LAM_TC) - X(LAM_SN), 28);
  ctx.fillStyle = COL.line; rrect(DEMO_CHART.x, sy - 5, DEMO_CHART.w, 10, 5); ctx.fill();
  const gl = ctx.createLinearGradient(DEMO_CHART.x, 0, X(y.l), 0); gl.addColorStop(0, rgba(RGB.U, 0.9)); gl.addColorStop(1, rgba(RGB.C, 0.9));
  ctx.fillStyle = gl; rrect(DEMO_CHART.x, sy - 5, X(y.l) - DEMO_CHART.x, 10, 5); ctx.fill();
  const tcHot = win(t, CUE.cross - 0.2, CUE.down, 0.3, 0.6), snHot = win(t, CUE.below - 0.2, SC.why.start, 0.3, 0.6);
  rich([['λ', serif(500, 28, true), COL.G], ['SN', serif(500, 17, true), COL.G, 6], [' = 0,40 · hồi phục', sans(600, 23), COL.G]], X(LAM_SN) - 8, sy + 54, 'right', 0.55 + 0.45 * snHot);
  rich([['λ', serif(500, 28, true), COL.D], ['TC', serif(500, 17, true), COL.D, 6], [' = 0,50 · xâm nhập', sans(600, 23), COL.D]], X(LAM_TC) + 8, sy + 54, 'left', 0.55 + 0.45 * tcHot);
  for (const [l, h] of [[LAM_SN, snHot], [LAM_TC, tcHot]]) { ctx.fillStyle = l === LAM_SN ? COL.G : COL.D; ctx.fillRect(X(l) - 1.5, sy - 22 - 6 * h, 3, 44 + 12 * h); }
  const moving = Math.abs(lamAt(t + 0.05) - lamAt(t - 0.05)) > 0.0005;
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(y.l), sy, 20 + (moving ? 3 : 0), 0, 6.2832); ctx.fill();
  ctx.fillStyle = COL.C; ctx.beginPath(); ctx.arc(X(y.l), sy, 9, 0, 6.2832); ctx.fill();
  rich([['λ', serif(500, 40, true), COL.C], [' = ' + fmt(y.l, 2), mono(700, 34), COL.ink]], X(y.l), sy - 40, 'center', 1);
  // chart
  chart(t, DEMO_CHART, { alpha: 1, big: false, snA: 0.5 + 0.5 * snHot, tcA: 0.5 + 0.5 * tcHot, trail: true, trailA: 1, dotA: 1 });
  rich([['Hình 2. ', sans(700, 22), COL.muted], ['Tham số minh họa của bài báo: ρ = 0,1 · κ = 0,4 · μ = 0,2 · σ = 0,1', sans(400, 22), COL.muted]], 540, 1328, 'center', 1);
  // event tags
  const tag = (s, col, t0, t1) => { const ta = win(t, t0, t1, 0.25, 0.35); if (ta > 0) { ctx.save(); ctx.globalAlpha *= ta; ctx.font = sans(700, 30); const tw = ctx.measureText(s).width; ctx.fillStyle = rgba(col, 0.16); rrect(DISH_DEMO.cx - tw / 2 - 18, 186, tw + 36, 48, 24); ctx.fill(); ctx.strokeStyle = rgba(col, 0.8); ctx.lineWidth = 2; ctx.stroke(); text(s, DISH_DEMO.cx, 220, sans(700, 30), `rgb(${col})`, 'center'); ctx.restore(); } };
  tag('chưa có gì xảy ra', RGB.U, CUE.nothing - 0.2, CUE.cross);
  tag('LẬT!', RGB.D, CUE.flip - 0.35, CUE.down);
  tag('vẫn kẹt lại', RGB.D, CUE.stay - 0.2, CUE.below);
  tag('hồi phục', RGB.G, CUE.recover - 0.1, SC.why.start + 0.3);
  ctx.restore();
}

// ---------- scene: why (big hysteresis + capability) ----------
const WHY_CHART = { x: 150, y: 330, w: 800, h: 520 };
function sceneWhy(t) {
  const t0 = SC.why.start - 0.2, t1 = SC.take.start + 0.3;
  const a = win(t, t0, t1, 0.6, 0.5);
  if (a <= 0) return;
  const p = easeInOut((t - t0) / 0.9);
  const R = lerpRect(DEMO_CHART, WHY_CHART, p);
  const two = smooth((t - CUE.two) / 0.5), loopA = smooth((t - CUE.loop) / 0.5);
  ctx.save(); ctx.globalAlpha = a;
  const labSN = () => {
    const ax = R.x + (LAM_SN - LMIN) / (LMAX - LMIN) * R.w;
    rich([['λ', serif(500, 32, true), COL.G], ['SN', serif(500, 20, true), COL.G, 8], [' = 2√(', serif(500, 30), COL.G], ['κρ', serif(500, 30, true), COL.G], [') = 0,40', serif(500, 30), COL.G]], ax - 12, R.y + R.h + 128, 'right', two);
    text('hồi phục', ax - 12, R.y + R.h + 166, sans(600, 24), COL.G, 'right', two);
  };
  const labTC = () => {
    const ax = R.x + (LAM_TC - LMIN) / (LMAX - LMIN) * R.w;
    rich([['λ', serif(500, 32, true), COL.D], ['TC', serif(500, 20, true), COL.D, 8], [' = ', serif(500, 30), COL.D], ['ρ + κ', serif(500, 30, true), COL.D], [' = 0,50', serif(500, 30), COL.D]], ax + 12, R.y + R.h + 128, 'left', two);
    text('xâm nhập', ax + 12, R.y + R.h + 166, sans(600, 24), COL.D, 'left', two);
  };
  chart(t, R, {
    alpha: 1, big: true, snA: two, tcA: two, snLab: labSN, tcLab: labTC, trail: true, trailA: 1 - loopA, dotA: 1 - smooth((t - CUE.loop) / 0.3),
    extra: (X, Y) => {
      // band label
      text('hai trạng thái', (X(LAM_SN) + X(LAM_TC)) / 2, Y(0.08), sans(600, 22), COL.band, 'center', two * 0.9);
      if (loopA <= 0) return;
      // idealised loop: out along U=1 to λTC, drop, back along the low branch to λSN, jump up
      const pts = [];
      for (let l = 0.3; l <= LAM_TC; l += 0.004) pts.push([l, 1]);
      for (let u = 1; u >= Ulow(LAM_TC); u -= 0.02) pts.push([LAM_TC, u]);
      for (let l = LAM_TC; l >= LAM_SN; l -= 0.002) pts.push([l, Ulow(l)]);
      for (let u = Ulow(LAM_SN); u <= 1; u += 0.02) pts.push([LAM_SN, u]);
      for (let l = LAM_SN; l >= 0.3; l -= 0.004) pts.push([l, 1]);
      const cyc = ((t - CUE.loop) / 3.2) % 1, n = pts.length, head = Math.floor(cyc * n);
      ctx.lineCap = 'round';
      for (let k = 0; k < 70; k++) {
        const i = head - k; if (i < 1) break;
        const [l0, u0] = pts[i - 1], [l1, u1] = pts[i], seg = i / n;
        const col = seg < 0.36 ? RGB.U : seg < 0.75 ? RGB.D : RGB.G;
        ctx.strokeStyle = rgba(col, loopA * (1 - k / 70)); ctx.lineWidth = 9 * (1 - k / 90);
        ctx.beginPath(); ctx.moveTo(X(l0), Y(u0)); ctx.lineTo(X(l1), Y(u1)); ctx.stroke();
      }
      const [hl, hu] = pts[Math.max(0, head)];
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(hl), Y(hu), 10 * loopA, 0, 6.2832); ctx.fill();
      text('đường đi', X(0.34), Y(1) + 46, sans(700, 26), COL.U, 'center', loopA);
      text('đường về', X(0.6), Y(Ulow(0.6)) + 46, sans(700, 26), COL.D, 'center', loopA);
    },
  });
  // title
  const ha = smooth((t - CUE.hyst + 0.1) / 0.5);
  rich([['Hiện tượng trễ', serif(700, 56), COL.band], ['  hysteresis', serif(500, 34, true), COL.muted]], 540, 236, 'center', ha);
  const fa = smooth((t - CUE.two - 0.4) / 0.5);
  rich([['Hình 3. ', sans(700, 22), COL.muted], ['Nét liền: cân bằng ổn định · nét đứt: không ổn định · dải vàng: hai trạng thái', sans(400, 22), COL.muted]], 540, 1072, 'center', a * fa);
  // capability bar
  const ga = smooth((t - CUE.gamma + 0.1) / 0.5);
  if (ga > 0) {
    ctx.globalAlpha = a * ga;
    const bx = 150, bw = 780, by = 1190;
    rich([['⟨Γ⟩', mono(700, 32), COL.G], ['  năng lực tự làm khi bỏ công cụ', sans(600, 30), COL.ink]], bx, by - 24, 'left', 1);
    const drop = easeInOut((t - CUE.drop) / 0.9), v = lerp(1, 0.425, drop);
    ctx.fillStyle = COL.line; rrect(bx, by, bw, 46, 12); ctx.fill();
    ctx.fillStyle = COL.G; rrect(bx, by, bw * v, 46, 12); ctx.fill();
    if (drop > 0) { ctx.fillStyle = rgba(RGB.D, 0.25 * drop); rrect(bx + bw * v, by, bw * (1 - v), 46, 12); ctx.fill(); }
    text(fmt(v, 2), bx + bw * v - 14, by + 34, mono(700, 30), COL.bg, 'right');
    const da = smooth((t - CUE.drop - 0.6) / 0.4);
    text('−57%', bx + bw - 14, by + 34, mono(700, 30), COL.D, 'right', da);
    text('ngay khi lật ở λ = 0,50 · trên đường về vẫn kẹt ở 0,62', 540, by + 96, sans(500, 26), COL.muted, 'center', da);
    const G0 = serif(500, 25, true), Gs = serif(500, 16, true), Gt = sans(400, 23);
    rich([['Γ', G0], ['U', Gs, null, 5], [' = 1 · ', Gt], ['Γ', G0], ['C', Gs, null, 5], [' = 0,5 · ', Gt], ['Γ', G0], ['D', Gs, null, 5], [' = 0,1 là giả định minh họa của bài báo', Gt]], 540, by + 136, 'center', da, COL.faint);
  }
  ctx.restore();
}

// ---------- scene: take-home ----------
function icon(kind, x, y, col) {
  ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (kind === 'cliff') { ctx.beginPath(); ctx.moveTo(x - 30, y - 18); ctx.lineTo(x + 2, y - 18); ctx.lineTo(x + 2, y + 22); ctx.lineTo(x + 30, y + 22); ctx.stroke(); ctx.beginPath(); ctx.arc(x - 6, y - 30, 6, 0, 6.28); ctx.fill(); }
  if (kind === 'loop') { ctx.beginPath(); ctx.ellipse(x, y, 30, 18, 0, 0.3, 6.0); ctx.stroke(); arrowHead(x + 28, y - 6, -1.2, 14, col); }
  if (kind === 'shield') { ctx.beginPath(); ctx.moveTo(x, y - 30); ctx.lineTo(x + 26, y - 18); ctx.quadraticCurveTo(x + 24, y + 18, x, y + 32); ctx.quadraticCurveTo(x - 24, y + 18, x - 26, y - 18); ctx.closePath(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 2, y + 9); ctx.lineTo(x + 12, y - 9); ctx.stroke(); }
  ctx.restore();
}
function sceneTake(t) {
  const t0 = SC.take.start - 0.1, tq = CUE.q - 0.35;
  const a = win(t, t0, tq + 0.4, 0.5, 0.5);
  if (a > 0) {
    ctx.save(); ctx.globalAlpha = a;
    text('Ba điều rút ra', 540, 290, serif(700, 54), COL.ink, 'center', smooth((t - t0) / 0.5));
    const cards = [
      ['f1', 'cliff', 'D', 'Đột ngột', 'Vượt 0,50 là cả quần thể lật'],
      ['f2', 'loop', 'band', 'Khó đảo ngược', 'Vào ở 0,50, phải xuống 0,40 mới ra'],
      ['f3', 'shield', 'G', 'Phòng dễ hơn chữa', 'Giữ λ thấp và giữ việc tự làm (ρ cao)'],
    ];
    cards.forEach(([cue, ic, ck, title, sub], i) => {
      const p = backOut((t - CUE[cue] + 0.15) / 0.55), ap = smooth((t - CUE[cue] + 0.15) / 0.35);
      if (ap <= 0) return;
      const cy = 370 + i * 196, cx = 90 + 60 * (1 - p);
      ctx.save(); ctx.globalAlpha = a * ap;
      ctx.fillStyle = 'rgba(255,255,255,0.045)'; rrect(cx, cy, 900, 168, 22); ctx.fill();
      ctx.strokeStyle = rgba(RGB[ck], 0.55); ctx.lineWidth = 2; rrect(cx, cy, 900, 168, 22); ctx.stroke();
      ctx.fillStyle = rgba(RGB[ck], 0.14); ctx.beginPath(); ctx.arc(cx + 92, cy + 84, 54, 0, 6.28); ctx.fill();
      icon(ic, cx + 92, cy + 84, COL[ck]);
      text(title, cx + 180, cy + 76, sans(700, 40), COL.ink);
      text(sub, cx + 180, cy + 124, sans(500, 28), COL.muted);
      ctx.restore();
    });
    // caveat chip
    const ca = smooth((t - CUE.caveat + 0.1) / 0.4);
    if (ca > 0) {
      ctx.save(); ctx.globalAlpha = a * ca;
      const s = 'Lưu ý: mô hình lý thuyết · tham số minh họa · không phải dự báo';
      ctx.font = sans(500, 26); const tw = ctx.measureText(s).width;
      ctx.strokeStyle = 'rgba(155,159,169,0.6)'; ctx.lineWidth = 2; rrect(540 - tw / 2 - 30, 1010, tw + 60, 62, 31); ctx.stroke();
      text(s, 540, 1051, sans(500, 26), COL.ink, 'center');
      ctx.restore();
    }
    ctx.restore();
  }
  // the question + end card
  const qa = smooth((t - tq) / 0.7) * smooth((TOTAL - 0.05 - t) / 0.45);
  if (qa > 0) {
    dishRing(DISH_END, qa * 0.8, 0.25);
    const lift = easeInOut((t - (SC.take.end + 0.4)) / 0.8);
    const qy = lerp(420, 300, lift);
    text('Bỏ công cụ đi,', 540, qy, serif(500, 78, true), COL.ink, 'center', qa);
    text('mình còn lại gì?', 540, qy + 100, serif(500, 78, true), COL.U, 'center', qa);
    const ea = smooth((t - SC.take.end - 0.5) / 0.6) * qa;
    if (ea > 0) {
      ctx.save(); ctx.globalAlpha = ea;
      ctx.fillStyle = 'rgba(15,17,21,0.82)'; rrect(70, 1180, 940, 470, 26); ctx.fill();
      ctx.strokeStyle = COL.line; ctx.lineWidth = 2; rrect(70, 1180, 940, 470, 26); ctx.stroke();
      text('Đọc bản tương tác, tự kéo λ:', 540, 1262, sans(600, 32), COL.ink, 'center');
      text('the-micro-brain-lab.github.io/tech-notes', 540, 1318, mono(700, 32), COL.U, 'center');
      ctx.fillStyle = COL.line; ctx.fillRect(130, 1366, 820, 2);
      text('Nguồn', 130, 1420, sans(700, 24), COL.muted);
      const cite = 'Solé R., Ruffini G., Castaldo F., Tuccio M., Seoane L. F., De Domenico M., Elena S. F., Krakauer D. C., Levin M. “Large-Language Models as a Cognitive Virus”. arXiv:2609.03344 (2026).';
      wrapLines(cite, sans(400, 25), 820).forEach((l, i) => text(l, 130, 1462 + i * 36, sans(400, 25), COL.muted));
      ctx.restore();
    }
  }
}

// The source card covers the dish: draw dimmed agents under it by rendering them before the card.
function sceneSourceWithAgents(t) {
  if (t >= SC.source.start + 0.1 && t <= CUE.U - 0.4) {
    const dim = 1 - 0.72 * win(t, SC.source.start + 0.1, CUE.U - 0.1, 0.5, 0.4);
    drawAgents(t, dim);
  }
  sceneSource(t);
}

// ---------- main ----------
const args = process.argv.slice(2);
const stills = args[0] === '--still' ? args[1].split(',').map(Number) : null;
const nFrames = Math.round(TOTAL * FPS);
let proc = null;
if (!stills) {
  const ffmpeg = process.env.FFMPEG || execFileSync(process.env.PY || 'python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  proc = spawn(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'build/video.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const want = stills ? new Set(stills.map(s => Math.round(s * FPS))) : null;
const lastWanted = stills ? Math.max(...want) : nFrames - 1;
const started = Date.now();
for (let f = 0; f <= lastWanted; f++) {
  const t = f / FPS;
  updateAgents(t, 1 / FPS);
  background(t);
  sceneHook(t);
  sceneSourceWithAgents(t);
  const showDemo = 1 - smooth((t - SC.why.start + 0.2) / 0.5);
  const showEnd = smooth((t - CUE.q + 0.3) / 0.8);
  const hideTake = 1 - win(t, SC.take.start - 0.3, CUE.q - 0.2, 0.4, 0.3);
  const agentA = smooth(t / 0.9) * Math.max(showDemo, showEnd) * hideTake * smooth((TOTAL - 0.05 - t) / 0.45);
  sceneCompartments(t);
  sceneForces(t);
  if (t < SC.source.start + 0.1 || t > CUE.U - 0.4) drawAgents(t, agentA);
  sceneDemo(t);
  sceneWhy(t);
  sceneTake(t);
  captions(t);
  footer(t);
  chrome(t);
  finishGrain(f);
  if (stills) {
    if (want.has(f)) fs.writeFileSync(`build/still-${(f / FPS).toFixed(2)}.png`, canvas.toBuffer('image/png'));
  } else {
    const buf = Buffer.from(ctx.getImageData(0, 0, W, H).data.buffer);
    if (!proc.stdin.write(buf)) await new Promise(r => proc.stdin.once('drain', r));
    if (f % 150 === 0) process.stderr.write(`frame ${f}/${nFrames} (${((Date.now() - started) / 1000).toFixed(0)}s)\n`);
  }
}
if (GLYPHLOG) fs.writeFileSync('build/glyphlog.json', JSON.stringify([...GLYPHLOG]));
if (proc) { proc.stdin.end(); await new Promise(r => proc.on('close', r)); console.log('wrote build/video.mp4'); }
