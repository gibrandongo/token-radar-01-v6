/* Token Launch Radar — entrypoint.
 * Reads the sealed DefiLlama snapshot, fits a monotone multiple curve with
 * robust binned-median corrections, ranks every pre-token protocol that
 * passes the house screen, and writes board.json, the dashboard data, and
 * the dossier. Plain JavaScript, standard library only, deterministic:
 * two runs write the same bytes. No network, no clock, no randomness. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import RadarSteps from './dashboard/steps.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* ---------- invocation: flags, env, then the sealed paths ---------- */
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const INPUT = argValue('--input') || process.env.MAKEFUN_INPUT || '/input/snapshot.json';
const OUTPUT = argValue('--output') || process.env.MAKEFUN_OUTPUT_DIR || '/output';

/* ---------- small numeric helpers ---------- */
function median(values) {
  const s = values.slice().sort(function (a, b) { return a - b; });
  const n = s.length;
  if (n === 0) return 0;
  const m = Math.floor(n / 2);
  return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(sorted, p) {
  return sorted[Math.floor(p * (sorted.length - 1))];
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ---------- snapshot features ---------- */
const DAY_MS = 86400000;
function ageDays(listedAt, asOfMs) {
  if (!listedAt) return null;
  return Math.floor((asOfMs - Date.parse(listedAt + 'T00:00:00Z')) / DAY_MS);
}
function features(protocol, asOfMs) {
  return {
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl: protocol.tvl_usd,
    x: Math.log(protocol.tvl_usd),
    growth: protocol.change_7d,
    age: ageDays(protocol.listed_at, asOfMs),
    listedAt: protocol.listed_at,
    y: (protocol.mcap_usd && protocol.mcap_usd > 0 && protocol.tvl_usd > 0)
      ? Math.log(protocol.mcap_usd / protocol.tvl_usd) : null
  };
}

/* ---------- buckets ---------- */
function ageBucket(age) {
  if (age === null) return 'null';
  if (age < 180) return 'a<180';
  if (age < 365) return 'a180..365';
  if (age < 730) return 'a365..730';
  if (age < 1460) return 'a730..1460';
  return 'a>1460';
}
function chainBucket(n) {
  if (n <= 1) return 'c1';
  if (n === 2) return 'c2';
  if (n <= 5) return 'c3..5';
  return 'c6+';
}

/* ---------- the model ----------
 * Curve: protocols are split into six contiguous bands by log TVL; the
 * median log-multiple in each band is fitted with a decreasing isotonic
 * regression (pool adjacent violators), then linearly interpolated.
 * Corrections: one backfitting pass of centered median residuals, in the
 * order category, growth quartile, age band, chain-count band. A bucket
 * with fewer than 8 protocols contributes no correction. */
const N_BINS = 6;
const MIN_BUCKET = 8;

function pavaDecreasing(points) {
  const blocks = [];
  for (const pt of points) {
    blocks.push({ sum: pt.y, n: 1, xmin: pt.x, xmax: pt.x });
    while (blocks.length >= 2) {
      const a = blocks[blocks.length - 2], b = blocks[blocks.length - 1];
      if (a.sum / a.n >= b.sum / b.n) break;
      blocks.splice(blocks.length - 2, 2,
        { sum: a.sum + b.sum, n: a.n + b.n, xmin: a.xmin, xmax: b.xmax });
    }
  }
  return blocks.map(function (b) { return { x: (b.xmin + b.xmax) / 2, level: b.sum / b.n }; });
}

function bandMedians(train) {
  const sorted = train.slice().sort(function (a, b) { return a.x - b.x; });
  const k = Math.min(N_BINS, sorted.length);
  const base = Math.floor(sorted.length / k), rem = sorted.length % k;
  const points = [];
  let start = 0;
  for (let i = 0; i < k; i++) {
    const size = base + (i < rem ? 1 : 0);
    const group = sorted.slice(start, start + size);
    start += size;
    points.push({ x: median(group.map(function (c) { return c.x; })),
                  y: median(group.map(function (c) { return c.y; })) });
  }
  return points;
}

function fitCurve(train) {
  return pavaDecreasing(bandMedians(train));
}

function curvePredict(points, x) {
  if (x <= points[0].x) return points[0].level;
  const last = points[points.length - 1];
  if (x >= last.x) return last.level;
  for (let i = 0; i < points.length - 1; i++) {
    if (x >= points[i].x && x <= points[i + 1].x) {
      const t = (x - points[i].x) / (points[i + 1].x - points[i].x);
      return points[i].level + t * (points[i + 1].level - points[i].level);
    }
  }
  return last.level;
}

function growthEdges(train) {
  const vals = train.map(function (c) { return c.growth; })
    .filter(function (g) { return g !== null && g !== undefined; })
    .sort(function (a, b) { return a - b; });
  if (vals.length === 0) return [];
  return [quantile(vals, 0.25), quantile(vals, 0.5), quantile(vals, 0.75)];
}
function growthBucket(growth, edges) {
  if (growth === null || growth === undefined) return 'null';
  let b = 0;
  for (const e of edges) if (growth > e) b++;
  return 'q' + b;
}

function fitModel(train) {
  const points = fitCurve(train);
  const edges = growthEdges(train);
  const keyers = [
    ['cat', function (c) { return c.category; }],
    ['growth', function (c) { return growthBucket(c.growth, edges); }],
    ['age', function (c) { return ageBucket(c.age); }],
    ['chains', function (c) { return chainBucket(c.chains.length); }]
  ];
  const corr = {};
  let resid = train.map(function (c) { return c.y - curvePredict(points, c.x); });
  for (const [name, keyer] of keyers) {
    const groups = new Map();
    train.forEach(function (c, i) {
      const k = keyer(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(resid[i]);
    });
    const gm = median(resid);
    const table = {};
    for (const [k, rs] of groups) {
      table[k] = rs.length >= MIN_BUCKET ? median(rs) - gm : 0;
    }
    corr[name] = { keyer: keyer, table: table };
    resid = train.map(function (c, i) {
      return resid[i] - (table[keyer(c)] || 0);
    });
  }
  const ys = train.map(function (c) { return c.y; });
  return { points: points, edges: edges, corr: corr,
           ymin: Math.min.apply(null, ys), ymax: Math.max.apply(null, ys) };
}

function predictLogMultiple(model, c) {
  let v = curvePredict(model.points, c.x);
  for (const name of ['cat', 'growth', 'age', 'chains']) {
    const entry = model.corr[name];
    v += entry.table[entry.keyer(c)] || 0;
  }
  return clamp(v, model.ymin, model.ymax);
}

/* ---------- honest validation: the model refitted from scratch ---------- */
function summarize(pairs) {
  const errs = pairs.map(function (p) { return Math.abs(p[0] - p[1]) / p[1]; });
  const ratios = pairs.map(function (p) { return p[0] / p[1]; });
  return {
    n: pairs.length,
    med: median(errs),
    w2: ratios.filter(function (r) { return r >= 0.5 && r <= 2; }).length / ratios.length,
    w3: ratios.filter(function (r) { return r >= 1 / 3 && r <= 3; }).length / ratios.length
  };
}
function predictAll(model, cases) {
  return cases.map(function (c) {
    return [Math.exp(predictLogMultiple(model, c)), Math.exp(c.y)];
  });
}
function runValidation(cal) {
  const out = [];
  const dated = cal.filter(function (c) { return c.listedAt; })
    .sort(function (a, b) {
      return a.listedAt < b.listedAt ? -1 : (a.listedAt > b.listedAt ? 1 : (a.slug < b.slug ? -1 : 1));
    });
  const cut = Math.floor(dated.length * 0.7);
  out.push(Object.assign({ split: 'Time split (oldest 70% fit, newest 30% tested)' },
    summarize(predictAll(fitModel(dated.slice(0, cut)), dated.slice(cut)))));
  const slugSorted = cal.slice().sort(function (a, b) { return a.slug < b.slug ? -1 : 1; });
  const folds = [0, 1, 2, 3, 4].map(function (i) { return slugSorted.filter(function (_, j) { return j % 5 === i; }); });
  const pooled = [], pooledBase = [], crossResid = [];
  for (let i = 0; i < 5; i++) {
    const test = folds[i];
    const train = [];
    folds.forEach(function (f, j) { if (j !== i) train.push.apply(train, f); });
    const model = fitModel(train);
    const base = median(train.map(function (c) { return c.y; }));
    for (const c of test) {
      pooled.push([Math.exp(predictLogMultiple(model, c)), Math.exp(c.y)]);
      pooledBase.push([Math.exp(base), Math.exp(c.y)]);
      crossResid.push(c.y - predictLogMultiple(model, c));
    }
  }
  out.push(Object.assign({ split: '5-fold (slug order, pooled)' }, summarize(pooled)));
  const baseline = Object.assign({ split: 'Global-median baseline' }, summarize(pooledBase));
  const cats = Array.from(new Set(cal.map(function (c) { return c.category; }))).sort();
  const loco = [];
  for (const cat of cats) {
    const test = cal.filter(function (c) { return c.category === cat; });
    const train = cal.filter(function (c) { return c.category !== cat; });
    if (train.length < 10) continue;
    loco.push.apply(loco, predictAll(fitModel(train), test));
  }
  out.push(Object.assign({ split: 'Leave-one-category-out (pooled)' }, summarize(loco)));
  const loo = [];
  for (let i = 0; i < cal.length; i++) {
    const train = cal.slice(0, i).concat(cal.slice(i + 1));
    loo.push.apply(loo, predictAll(fitModel(train), [cal[i]]));
  }
  out.push(Object.assign({ split: 'Leave-one-out (pooled)' }, summarize(loo)));
  crossResid.sort(function (a, b) { return a - b; });
  const band = { lo: Math.exp(quantile(crossResid, 0.10)), hi: Math.exp(quantile(crossResid, 0.90)) };
  return { splits: out, baseline: baseline, band: band };
}

/* ---------- board inclusion: the house screen, from snapshot fields ---------- */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking',
  'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
function passesScreen(p) {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const e of EXCHANGES) if (p.name.indexOf(e) === 0) return false;
  return true;
}

/* ---------- main ---------- */
function main() {
  const snapshot = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const asOfMs = Date.parse(snapshot.as_of + 'T00:00:00Z');
  const protocols = snapshot.protocols;
  const watchlist = new Set(snapshot.watchlist);

  const feats = protocols.map(function (p) { return features(p, asOfMs); });
  const cal = feats.filter(function (c) { return c.y !== null; });
  const model = fitModel(cal);
  const validation = runValidation(cal);

  const boardProtocols = protocols.filter(function (p) {
    return passesScreen(p) || watchlist.has(p.slug);
  });
  const rows = boardProtocols.map(function (p) {
    const c = features(p, asOfMs);
    const logMult = predictLogMultiple(model, c);
    const implied = Math.max(1, Math.round(p.tvl_usd * Math.exp(logMult)));
    const steps = RadarSteps.renderSteps({
      name: p.name, category: p.category, chains: p.chains, tvl: p.tvl_usd
    });
    return {
      slug: p.slug, name: p.name, rank: 0, implied_value_usd: implied,
      farm_steps: steps,
      category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, age_days: c.age,
      multiple: Math.exp(logMult),
      band_lo_usd: Math.max(1, Math.round(implied * validation.band.lo)),
      band_hi_usd: Math.max(1, Math.round(implied * validation.band.hi)),
      watchlist: watchlist.has(p.slug)
    };
  });
  rows.sort(function (a, b) {
    return (b.implied_value_usd - a.implied_value_usd) || (a.slug < b.slug ? -1 : 1);
  });
  rows.forEach(function (r, i) { r.rank = i + 1; });

  /* Gate-shape assertions: fail loudly rather than ship an invalid board. */
  if (rows.length < 100) throw new Error('board has fewer than 100 rows: ' + rows.length);
  const seen = new Set(rows.map(function (r) { return r.slug; }));
  for (const s of watchlist) if (!seen.has(s)) throw new Error('watchlist slug missing: ' + s);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
      throw new Error('board not sorted by implied value at rank ' + rows[i].rank);
    }
  }
  if (rows.every(function (r) { return r.implied_value_usd === rows[0].implied_value_usd; })) {
    throw new Error('all implied values equal');
  }
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) throw new Error('bad step count: ' + r.slug);
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) throw new Error('bad step length: ' + r.slug);
    }
  }

  /* ---------- write the output tree (never remove the directory itself) ---------- */
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const child of fs.readdirSync(OUTPUT)) {
    fs.rmSync(path.join(OUTPUT, child), { recursive: true, force: true });
  }
  const dashOut = path.join(OUTPUT, 'dashboard');
  const shotsOut = path.join(OUTPUT, 'screenshots');
  fs.mkdirSync(dashOut, { recursive: true });
  fs.mkdirSync(shotsOut, { recursive: true });

  fs.writeFileSync(path.join(OUTPUT, 'board.json'), JSON.stringify({
    as_of: snapshot.as_of,
    source: snapshot.source,
    model: 'isotonic TVL-multiple curve (6 bands) + median-residual corrections ' +
      '(category, growth quartile, age band, chain-count band)',
    rows: rows
  }, null, 2) + '\n');

  const dashSrc = path.join(HERE, 'dashboard');
  for (const f of fs.readdirSync(dashSrc).sort()) {
    if (f === 'data.js') continue;
    fs.copyFileSync(path.join(dashSrc, f), path.join(dashOut, f));
  }
  const shotsSrc = path.join(HERE, 'screenshots');
  for (const f of fs.readdirSync(shotsSrc).sort()) {
    fs.copyFileSync(path.join(shotsSrc, f), path.join(shotsOut, f));
  }

  const round4 = function (v) { return Math.round(v * 10000) / 10000; };
  const data = {
    meta: {
      asOf: snapshot.as_of,
      source: snapshot.source,
      floor: snapshot.floor_usd,
      nProtocols: protocols.length,
      nCal: cal.length,
      nBoard: rows.length,
      nWatch: watchlist.size,
      bandLo: round4(validation.band.lo),
      bandHi: round4(validation.band.hi),
      curve: {
        centers: model.points.map(function (p) { return round4(p.x); }),
        levels: model.points.map(function (p) { return round4(p.level); }),
        rawCenters: bandMedians(cal).map(function (p) { return round4(p.x); }),
        rawLevels: bandMedians(cal).map(function (p) { return round4(p.y); })
      },
      clamp: [round4(model.ymin), round4(model.ymax)],
      corr: {
        cat: roundTable(model.corr.cat.table, round4),
        growth: { edges: model.edges.map(round4), table: roundTable(model.corr.growth.table, round4) },
        age: roundTable(model.corr.age.table, round4),
        chains: roundTable(model.corr.chains.table, round4)
      },
      validation: validation.splits.map(function (s) {
        return { split: s.split, n: s.n, med: round4(s.med * 100), w2: round4(s.w2), w3: round4(s.w3) };
      }),
      baseline: { n: validation.baseline.n, med: round4(validation.baseline.med * 100),
                  w2: round4(validation.baseline.w2), w3: round4(validation.baseline.w3) }
    },
    rows: rows.map(function (r) {
      return [r.slug, r.name, r.category, r.chains.join(','), r.tvl_usd,
              r.change_7d, r.age_days, r.implied_value_usd, r.watchlist ? 1 : 0];
    })
  };
  fs.writeFileSync(path.join(dashOut, 'data.js'),
    'var RADAR_DATA = ' + JSON.stringify(data) + ';\n');

  const dossierBytes = buildDossier(OUTPUT, { text_max_bytes: 65536 });
  fs.writeFileSync(path.join(OUTPUT, 'dossier.json'), dossierBytes);
}

function roundTable(table, round4) {
  const out = {};
  Object.keys(table).sort().forEach(function (k) { out[k] = round4(table[k]); });
  return out;
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
