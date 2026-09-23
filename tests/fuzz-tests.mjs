// Randomised stress test with an INDEPENDENT geometry checker (does not reuse
// the engine's validator). Usage: node tests/fuzz-tests.mjs [cases]
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.match(/<script id="engine-src">([\s\S]*?)<\/script>/)[1];
const Engine = new Function(`${src}\nreturn PalletEngineFactory;`)()();

let seed = Number(process.env.SEED || 12345);
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = a => a[Math.floor(rnd() * a.length)];
const TOL = 1e-3;

function checkPlan(plan, unit, products, counts, clearance, overhang, extra) {
  const P = extra ? plan.placements.concat(extra) : plan.placements;
  const byId = {}; products.forEach(p => { byId[p.id] = p; }); Engine.DEFAULTS.products.forEach(p => { if (!byId[p.id]) byId[p.id] = p; });
  const prodOf = p => (p.forecast ? byId[p.productId] : products[p.itemIdx]);
  const errs = checkPlacements(P, unit, prodOf, clearance, overhang);
  if (!extra) {
    const got = counts.map(() => 0);
    P.forEach(p => { got[p.itemIdx]++; });
    if (got.some((g, i) => g !== counts[i])) errs.push(`counts ${got} vs ${counts}`);
    if (!plan.validation.ok) errs.push('engine validation flagged: ' + plan.validation.errors[0]);
  }
  return errs;
}
function checkPlacements(P, unit, prodOf, clearance, overhang) {
  const errs = [];
  const products = null;
  const usable = unit.maxHeight - (unit.baseHeight || 0) - (unit.topClearance || 0);
  const ov = unit.kind === 'pallet' ? overhang : 0;
  for (const p of P) {
    if (p.x < -ov - TOL || p.y < -ov - TOL || p.x + p.l > unit.L + ov + TOL || p.y + p.w > unit.W + ov + TOL) errs.push(`bounds #${p.id}`);
    if (p.z < -TOL || p.z + p.h > usable + TOL) errs.push(`height #${p.id}`);
    const pr = prodOf(p);
    const k = pr.dimUnit === 'mm' ? 1 : 10;
    const orig = [pr.length * k, pr.width * k, pr.height * k].sort((a, b) => a - b);
    const got = [p.l, p.w, p.h].sort((a, b) => a - b);
    if (orig.some((v, i) => Math.abs(v - got[i]) > TOL)) errs.push(`dims #${p.id}`);
  }
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j];
    const ox = Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x);
    const oy = Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y);
    const oz = Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z);
    if (ox > TOL && oy > TOL && oz > TOL) errs.push(`overlap #${a.id}/#${b.id}`);
    const gx = Math.max(a.x, b.x) - Math.min(a.x + a.l, b.x + b.l);
    const gy = Math.max(a.y, b.y) - Math.min(a.y + a.w, b.y + b.w);
    if (oz > TOL && clearance > 0 && ((gx < clearance - TOL && gx > -TOL && oy > TOL) || (gy < clearance - TOL && gy > -TOL && ox > TOL))) errs.push(`clearance #${a.id}/#${b.id}`);
  }
  // support by point sampling: every sample point of a raised carton base must lie on a carton top at that height
  for (const p of P) {
    if (p.z <= TOL) continue;
    const at = (v, len, k) => v + (k === 0 ? 0.5 : k === 8 ? len - 0.5 : (len * k) / 8); // includes points 0.5 mm inside every edge
    for (let sx = 0; sx < 9; sx++) for (let sy = 0; sy < 9; sy++) {
      const x = at(p.x, p.l, sx), y = at(p.y, p.w, sy);
      const ok = P.some(q => Math.abs(q.z + q.h - p.z) < TOL && x >= q.x - TOL && x <= q.x + q.l + TOL && y >= q.y - TOL && y <= q.y + q.w + TOL && prodOf(q).canSupport !== false && !prodOf(q).fragile);
      if (!ok) { errs.push(`unsupported #${p.id}`); sx = sy = 99; }
    }
  }
  // stacking limits: longest chain of cartons resting on a carton ≤ (max stack layers − 1); fragile/non-supporting: 0
  const kids = new Map();
  for (const p of P) { if (p.z <= TOL) continue; for (const q of P) { if (Math.abs(q.z + q.h - p.z) > TOL) continue; const ox = Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x), oy = Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y); if (ox > TOL && oy > TOL) { if (!kids.has(q)) kids.set(q, []); kids.get(q).push(p); } } }
  const dm = new Map(); const depth = p => { if (dm.has(p)) return dm.get(p); let d = 0; for (const c of kids.get(p) || []) d = Math.max(d, 1 + depth(c)); dm.set(p, d); return d; };
  for (const p of P) { const pr = prodOf(p); const lim = (pr.canSupport === false || pr.fragile) ? 0 : (pr.maxStackLayers ? Number(pr.maxStackLayers) - 1 : Infinity); if (depth(p) > lim) errs.push(`stacking #${p.id} has ${depth(p)} tiers on it (limit ${lim})`); }
  const net = P.reduce((s, p) => s + Number(prodOf(p).weight), 0);
  if (unit.maxGross && net + (unit.kind === 'pallet' ? unit.tare || 0 : 0) > unit.maxGross + 1e-6) errs.push(`weight ${net}`);
  return errs;
}

function randomProduct(i) {
  const cm = rnd() < 0.7;
  const L = cm ? 15 + rnd() * 50 : 150 + rnd() * 500, W = cm ? 15 + rnd() * 45 : 150 + rnd() * 450, H = cm ? 15 + rnd() * 50 : 150 + rnd() * 500;
  const r = v => Math.round(v * 2) / 2;
  return { id: 'r' + i, sku: 'R' + i, length: r(L), width: r(W), height: r(H), dimUnit: cm ? 'cm' : 'mm', unitsPerCarton: 1 + Math.floor(rnd() * 40), weight: Math.round((1 + rnd() * 40) * 100) / 100, keepUpright: rnd() < 0.8, fragile: rnd() < 0.08, canSupport: true, maxStackLayers: rnd() < 0.2 ? 1 + Math.floor(rnd() * 3) : null };
}

const N = Number(process.argv[2] || 60);
let fails = 0, plans = 0, addChecks = 0, forecasts = 0;
const t0 = Date.now();
for (let n = 0; n < N; n++) {
  const container = rnd() < 0.2;
  const c = pick(Engine.DEFAULTS.containers), pl = pick(Engine.DEFAULTS.pallets);
  const unit = container
    ? { kind: 'container', name: c.name, L: c.length, W: c.width, maxHeight: c.height, topClearance: 0, maxGross: rnd() < 0.3 ? 8000 : c.maxPayload }
    : { kind: 'pallet', name: pl.name, L: pl.length, W: pl.width, maxHeight: pl.maxHeight, baseHeight: rnd() < 0.3 ? 144 : 0, tare: rnd() < 0.5 ? 25 : 0, maxGross: rnd() < 0.4 ? 300 + Math.round(rnd() * 900) : null };
  const k = 1 + Math.floor(rnd() * (container ? 4 : 6));
  const products = Array.from({ length: k }, (_, i) => (rnd() < 0.5 ? { ...Engine.DEFAULTS.products[Math.floor(rnd() * 6)], id: 'd' + i + n, sku: 'D' + i } : randomProduct(i)));
  const raw = products.map(() => 1 + rnd() * 10), tot = raw.reduce((s, v) => s + v, 0);
  const targets = raw.map(v => Math.round((v / tot) * 1000) / 10);
  targets[targets.length - 1] = Math.round((100 - targets.slice(0, -1).reduce((s, v) => s + v, 0)) * 10) / 10;
  const clearance = rnd() < 0.25 ? pick([5, 20, 50]) : 0;
  const overhang = !container && rnd() < 0.15 ? 20 : 0;
  const base = { unit, orientationPolicy: pick(['sku', 'sku', 'upright', 'full']), clearance, allowOverhang: overhang > 0, overhangMm: overhang };
  const which = pick(['mix', 'mix', 'mix', 'single', 'multi', 'exact']);
  base.fillProducts = Engine.DEFAULTS.products;
  let res;
  if (which === 'single') res = Engine.calcSingle({ ...base, product: products[0] });
  else if (which === 'mix') res = Engine.optimiseMix({ ...base, basis: pick(['cartons', 'units', 'weight']), tolerance: pick([0, 2, 5, 10]), mode: pick(['match', 'balanced', 'util']), rows: products.map((p, i) => ({ product: p, target: targets[i], priority: pick(['High', 'Normal', 'Low']), min: null, max: rnd() < 0.15 ? 1 + Math.floor(rnd() * 6) : null, locked: false })) });
  else res = Engine[which === 'multi' ? 'planMulti' : 'planExact']({ ...base, basis: 'cartons', strategy: pick(['shipment', 'perUnit']), rows: products.map(p => ({ product: p, qty: Math.floor(rnd() * (container ? 400 : 40)) })) });
  if (!res.ok) { if (!res.errors || !res.errors.length) { fails++; console.log('FAIL no message', which); } continue; }
  const list = which === 'single' ? [[res.plan, [res.plan.placements.length]]] : which === 'mix' ? res.scenarios.map(s => [s.plan, s.counts]) : res.units.map(u => [u.plan, u.counts]);
  for (const [plan, counts] of list) {
    plans++;
    if (!plan) { fails++; console.log('FAIL missing plan', which); continue; }
    const cnt = which === 'single' ? [plan.placements.length] : counts;
    const e = checkPlan(plan, unit, products, cnt, clearance, overhang);
    if (which === 'mix') {
      const sc = res.scenarios.find(s => s.plan === plan);
      const f = products.map(p => (res.input.basis === 'units' ? p.unitsPerCarton : res.input.basis === 'weight' ? p.weight : 1));
      const B = counts.reduce((s, x, i) => s + x * f[i], 0);
      sc.rows.forEach((r, i) => { const a = B ? (100 * counts[i] * f[i]) / B : 0; if (Math.abs(a - r.achieved) > 1e-6 || Math.abs(a - targets[i] - r.deviation) > 1e-6) e.push('percent ' + r.sku); });
    }
    const holder = which === 'mix' ? res.scenarios.find(s => s.plan === plan) : which === 'single' ? res : res.units.find(u => u.plan === plan);
    const a = holder.assessment;
    if (holder.forecast && holder.forecast.placements.length) {
      forecasts++;
      const e2 = checkPlan(plan, unit, products, cnt, clearance, overhang, holder.forecast.placements);
      if (e2.length) e.push('forecast overlay: ' + e2.slice(0, 3).join('; '));
      if (!holder.forecast.valid) e.push('forecast marked invalid');
      const capBefore = Math.max(plan.kpis.volumeUtil, plan.kpis.weightUtil || 0);
      if (holder.forecast.after && holder.forecast.after.capUtil + 1e-6 < capBefore) e.push('forecast reduces utilisation');
    }
    if (!a || !['green', 'amber', 'red'].includes(a.status) || a.checks.length < 4) e.push('assessment missing');
    if (which === 'mix' && plan === res.scenarios[0].plan) {
      const sc = res.scenarios[0], fill = sc.fill;
      const sug = fill && (fill.combined || fill.suggestions[0]);
      if (sug) {
        const rows = products.map((p, i) => ({ product: p, target: targets[i], priority: 'Normal' }));
        const cnt = sc.counts.slice();
        const extraProducts = [];
        sug.adds.forEach(ad => {
          const i = rows.findIndex(r => r.product.id === ad.productId);
          if (i >= 0) cnt[i] += ad.add;
          else { const p = Engine.DEFAULTS.products.find(x => x.id === ad.productId); rows.push({ product: p, locked: true, lockedQty: ad.add, priority: 'Normal' }); cnt.push(ad.add); extraProducts.push(p); }
        });
        const adj = Engine.optimiseMix({ ...base, basis: res.input.basis, tolerance: res.input.tolerance, mode: 'balanced', rows, fixedCounts: cnt, noFill: true });
        if (!adj.ok) e.push('add-to-plan failed: ' + adj.errors[0]);
        else {
          const e2 = checkPlan(adj.scenarios[0].plan, unit, products.concat(extraProducts), cnt, clearance, overhang);
          if (e2.length) e.push('add-to-plan layout: ' + e2.slice(0, 3).join('; '));
          addChecks++;
        }
      }
    }
    if (which === 'multi' || which === 'exact') {
      const totals = products.map((_, i) => res.units.reduce((s, u) => s + u.counts[i], 0));
      if (totals.some((t, i) => t !== res.required[i].cartons)) e.push('allocation totals');
    }
    if (e.length) { fails++; console.log(`FAIL case ${n} ${which} ${unit.kind}:`, e.slice(0, 5).join('; ')); }
  }
}
console.log(`${N} random cases, ${plans} plans independently checked, ${addChecks} “Add to plan” re-plans checked, ${forecasts} forecast overlays checked, ${fails} failures, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fails ? 1 : 0);
