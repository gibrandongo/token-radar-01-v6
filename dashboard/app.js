/* Token Launch Radar — board, filters, detail view, curve chart.
 * Reads RADAR_DATA (written by main.ts) and RadarSteps (farm templates).
 * No network: every figure comes from the snapshot via data.js. */
(function () {
  'use strict';
  var D = window.RADAR_DATA;
  var META = D.meta;
  var ROWS = D.rows;
  var IDX = { slug: 0, name: 1, cat: 2, chains: 3, tvl: 4, growth: 5, age: 6, implied: 7, wl: 8 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function usd(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }
  function usdFull(v) { return '$' + Math.round(v).toLocaleString('en-US'); }
  function pct(g) {
    if (g === null || g === undefined) return '—';
    var cls = g > 0 ? 'up' : (g < 0 ? 'down' : '');
    return '<span class="' + cls + '">' + (g > 0 ? '+' : '') + g.toFixed(1) + '%</span>';
  }
  function chainsFmt(s) {
    var parts = s.split(',');
    if (parts.length <= 3) return esc(s.split(',').join(', '));
    return esc(parts.slice(0, 3).join(', ')) + ' <span class="band">+' + (parts.length - 3) + ' more</span>';
  }
  function ageFmt(a) {
    if (a === null || a === undefined) return '—';
    if (a >= 365) return (a / 365).toFixed(1) + 'y';
    return a + 'd';
  }

  /* ---- model recompute (same math as main.ts) for the detail breakdown ---- */
  function curveAt(logTvl) {
    var c = META.curve.centers, l = META.curve.levels;
    if (logTvl <= c[0]) return l[0];
    if (logTvl >= c[c.length - 1]) return l[l.length - 1];
    for (var i = 0; i < c.length - 1; i++) {
      if (logTvl >= c[i] && logTvl <= c[i + 1]) {
        var t = (logTvl - c[i]) / (c[i + 1] - c[i]);
        return l[i] + t * (l[i + 1] - l[i]);
      }
    }
    return l[l.length - 1];
  }
  function ageBucket(a) {
    if (a === null || a === undefined) return 'null';
    if (a < 180) return 'a<180';
    if (a < 365) return 'a180..365';
    if (a < 730) return 'a365..730';
    if (a < 1460) return 'a730..1460';
    return 'a>1460';
  }
  function chainBucket(n) {
    if (n <= 1) return 'c1';
    if (n === 2) return 'c2';
    if (n <= 5) return 'c3..5';
    return 'c6+';
  }
  function breakdown(row) {
    var logTvl = Math.log(row[IDX.tvl]);
    var base = curveAt(logTvl);
    var adj = base;
    adj += META.corr.cat[row[IDX.cat]] || 0;
    var g = row[IDX.growth];
    var gk = 'null';
    if (g !== null && g !== undefined) {
      var b = 0, e = META.corr.growth.edges;
      for (var i = 0; i < e.length; i++) if (g > e[i]) b++;
      gk = 'q' + b;
    }
    adj += META.corr.growth.table[gk] || 0;
    adj += META.corr.age[ageBucket(row[IDX.age])] || 0;
    adj += META.corr.chains[chainBucket(row[IDX.chains].split(',').length)] || 0;
    adj = Math.max(META.clamp[0], Math.min(META.clamp[1], adj));
    return { base: Math.exp(base), adjusted: Math.exp(adj), logTvl: logTvl, curveLevel: base };
  }

  /* ---- header, stats, validation, curve ---- */
  document.getElementById('metaLine').textContent =
    'Snapshot ' + META.asOf + ' · ' + META.nProtocols + ' protocols at $5M+ TVL · ' +
    'floor $' + (META.floor / 1e6) + 'M · ' + META.source;
  document.getElementById('statsBar').innerHTML = [
    ['<b>' + META.nBoard + '</b><span>protocols ranked</span>'],
    ['<b>' + META.nWatch + '/' + META.nWatch + '</b><span>watchlist covered</span>'],
    ['<b>' + META.nCal + '</b><span>token-bearing protocols calibrate the curve</span>'],
    ['<b>' + META.validation[1].med.toFixed(0) + '%</b><span>median error, 5-fold validation</span>']
  ].map(function (s) { return '<div class="stat">' + s[0] + '</div>'; }).join('');

  var vt = '<tr><th>Split</th><th>n</th><th>Median error</th><th>Within 2x</th><th>Within 3x</th></tr>';
  META.validation.forEach(function (v) {
    vt += '<tr><td>' + esc(v.split) + '</td><td>' + v.n + '</td><td>' + v.med.toFixed(1) +
      '%</td><td>' + (v.w2 * 100).toFixed(0) + '%</td><td>' + (v.w3 * 100).toFixed(0) + '%</td></tr>';
  });
  vt += '<tr><td>Global-median baseline (same 5 folds)</td><td>' + META.baseline.n + '</td><td>' +
    META.baseline.med.toFixed(1) + '%</td><td>' + (META.baseline.w2 * 100).toFixed(0) +
    '%</td><td>' + (META.baseline.w3 * 100).toFixed(0) + '%</td></tr>';
  document.getElementById('validTable').innerHTML = vt;

  function drawCurve(markerLogTvl, markerLevel) {
    var W = 460, H = 250, P = { l: 46, r: 12, t: 12, b: 30 };
    var xs = META.curve.centers, ys = META.curve.levels;
    var rx = META.curve.rawCenters || [], ry = META.curve.rawLevels || [];
    var allX = xs.concat(rx), allY = ys.concat(ry);
    if (markerLogTvl !== null && markerLogTvl !== undefined) {
      allX.push(markerLogTvl); allY.push(markerLevel);
    }
    var x0 = Math.min.apply(null, allX) - 0.3, x1 = Math.max.apply(null, allX) + 0.3;
    var y0 = Math.min.apply(null, allY) - 0.4, y1 = Math.max.apply(null, allY) + 0.4;
    function X(v) { return P.l + (v - x0) / (x1 - x0) * (W - P.l - P.r); }
    function Y(v) { return H - P.b - (v - y0) / (y1 - y0) * (H - P.t - P.b); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fitted multiple curve">';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#101724"/>';
    [[5e6, '$5M'], [5e7, '$50M'], [5e8, '$500M'], [5e9, '$5B']].forEach(function (t) {
      var x = X(Math.log(t[0]));
      if (x < P.l || x > W - P.r) return;
      s += '<line x1="' + x.toFixed(1) + '" y1="' + P.t + '" x2="' + x.toFixed(1) + '" y2="' + (H - P.b) +
        '" stroke="#2a3648"/><text x="' + x.toFixed(1) + '" y="' + (H - 10) + '" fill="#97a3b6" font-size="11" text-anchor="middle">' + t[1] + '</text>';
    });
    [[0.03, '0.03x'], [0.1, '0.1x'], [0.3, '0.3x'], [1, '1x']].forEach(function (t) {
      var y = Y(Math.log(t[0]));
      if (y < P.t || y > H - P.b) return;
      s += '<line x1="' + P.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - P.r) + '" y2="' + y.toFixed(1) +
        '" stroke="#2a3648"/><text x="' + (P.l - 6) + '" y="' + (y + 4).toFixed(1) + '" fill="#97a3b6" font-size="11" text-anchor="end">' + t[1] + '</text>';
    });
    var pts = xs.map(function (x, i) { return X(x).toFixed(1) + ',' + Y(ys[i]).toFixed(1); }).join(' ');
    s += '<polyline points="' + pts + '" fill="none" stroke="#e6b34d" stroke-width="2.5"/>';
    rx.forEach(function (x, i) {
      s += '<circle cx="' + X(x).toFixed(1) + '" cy="' + Y(ry[i]).toFixed(1) + '" r="4" fill="#101724" stroke="#97a3b6" stroke-width="1.5"/>';
    });
    xs.forEach(function (x, i) {
      s += '<circle cx="' + X(x).toFixed(1) + '" cy="' + Y(ys[i]).toFixed(1) + '" r="4.5" fill="#e6b34d"/>';
    });
    if (markerLogTvl !== null && markerLogTvl !== undefined) {
      s += '<circle cx="' + X(markerLogTvl).toFixed(1) + '" cy="' + Y(markerLevel).toFixed(1) +
        '" r="7" fill="none" stroke="#4cc2a5" stroke-width="2.5"/>';
    }
    s += '<text x="' + (W / 2) + '" y="' + (H - 10) + '" fill="#6b788d" font-size="11" text-anchor="middle"></text></svg>';
    document.getElementById('curveChart').innerHTML = s;
  }
  drawCurve(null, null);

  /* ---- board ---- */
  var state = { q: '', cat: '', chain: '', wl: false, sort: 'rank' };
  var catSel = document.getElementById('catFilter');
  var chainSel = document.getElementById('chainFilter');
  var cats = [], chainsSeen = {};
  ROWS.forEach(function (r) {
    if (cats.indexOf(r[IDX.cat]) < 0) cats.push(r[IDX.cat]);
    r[IDX.chains].split(',').forEach(function (c) { chainsSeen[c] = 1; });
  });
  cats.sort();
  catSel.innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  chainSel.innerHTML = '<option value="">All chains</option>' +
    Object.keys(chainsSeen).sort().map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  function filtered() {
    var q = state.q.toLowerCase();
    var rows = ROWS.filter(function (r) {
      if (q && (r[IDX.name].toLowerCase().indexOf(q) < 0 && r[IDX.slug].toLowerCase().indexOf(q) < 0)) return false;
      if (state.cat && r[IDX.cat] !== state.cat) return false;
      if (state.chain && r[IDX.chains].split(',').indexOf(state.chain) < 0) return false;
      if (state.wl && !r[IDX.wl]) return false;
      return true;
    });
    var key = state.sort;
    var val = {
      rank: function (r) { return ROWS.indexOf(r); },
      tvl: function (r) { return -r[IDX.tvl]; },
      growth: function (r) { return -(r[IDX.growth] === null ? -1e9 : r[IDX.growth]); },
      age: function (r) { return -(r[IDX.age] === null ? -1 : r[IDX.age]); },
      implied: function (r) { return -r[IDX.implied]; }
    }[key];
    rows.sort(function (a, b) { return val(a) - val(b); });
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    var html = rows.map(function (r) {
      var rank = ROWS.indexOf(r) + 1;
      var lo = r[IDX.implied] * META.bandLo, hi = r[IDX.implied] * META.bandHi;
      return '<tr data-slug="' + esc(r[IDX.slug]) + '"><td class="rank">' + rank + '</td>' +
        '<td><span class="name">' + esc(r[IDX.name]) + '</span>' +
        (r[IDX.wl] ? '<span class="wl">watchlist</span>' : '') + '</td>' +
        '<td>' + esc(r[IDX.cat]) + '</td><td>' + chainsFmt(r[IDX.chains]) + '</td>' +
        '<td class="num">' + usd(r[IDX.tvl]) + '</td><td class="num">' + pct(r[IDX.growth]) + '</td>' +
        '<td class="num">' + ageFmt(r[IDX.age]) + '</td>' +
        '<td class="num implied">' + usd(r[IDX.implied]) + '</td>' +
        '<td class="band">' + usd(lo) + ' – ' + usd(hi) + '</td></tr>';
    }).join('');
    document.getElementById('boardBody').innerHTML = html;
    document.getElementById('rowCount').textContent =
      rows.length === ROWS.length ? ROWS.length + ' protocols' : rows.length + ' of ' + ROWS.length + ' shown';
  }

  /* ---- detail ---- */
  function showDetail(slug) {
    var row = null;
    ROWS.forEach(function (r) { if (r[IDX.slug] === slug) row = r; });
    if (!row) { showBoard(); return; }
    var rank = ROWS.indexOf(row) + 1;
    var bd = breakdown(row);
    var lo = row[IDX.implied] * META.bandLo, hi = row[IDX.implied] * META.bandHi;
    var steps = window.RadarSteps.renderSteps({
      name: row[IDX.name], category: row[IDX.cat],
      chains: row[IDX.chains].split(','), tvl: row[IDX.tvl]
    });
    document.getElementById('detailBody').innerHTML =
      '<h2>' + esc(row[IDX.name]) + '</h2>' +
      '<p class="small">Rank #' + rank + ' of ' + ROWS.length + ' · ' + esc(row[IDX.cat]) +
      (row[IDX.wl] ? ' · on the snapshot watchlist' : ' · below the watchlist floor') +
      ' · records no token in the snapshot</p>' +
      '<div class="facts">' +
      '<div class="fact"><span>TVL</span><b>' + usdFull(row[IDX.tvl]) + '</b></div>' +
      '<div class="fact"><span>7-day TVL change</span><b>' + pct(row[IDX.growth]) + '</b></div>' +
      '<div class="fact"><span>Tracked for</span><b>' + ageFmt(row[IDX.age]) + '</b></div>' +
      '<div class="fact"><span>Chains</span><b>' + row[IDX.chains].split(',').length + '</b></div>' +
      '</div>' +
      '<div class="estimate"><span class="small">IMPLIED VALUE IF ITS RECORD STAYED AS IT IS</span>' +
      '<div class="big">' + usdFull(row[IDX.implied]) + '</div>' +
      '<p>80% band ' + usdFull(lo) + ' – ' + usdFull(hi) + ', from out-of-fold residuals.</p>' +
      '<p>How this number is built: the fitted curve gives a multiple of <code>' +
      bd.base.toFixed(3) + 'x</code> at this TVL; category, seven-day growth, age and chain ' +
      'breadth adjust it to <code>' + bd.adjusted.toFixed(3) + 'x</code>; times TVL of ' +
      usd(row[IDX.tvl]) + ' gives the value above. The teal ring on the curve marks this protocol.</p></div>' +
      '<h3>Farm plan</h3><ol class="steps">' +
      steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    document.getElementById('boardView').hidden = true;
    document.getElementById('detailView').hidden = false;
    drawCurve(bd.logTvl, bd.curveLevel);
    document.getElementById('detailView').scrollIntoView();
  }
  function showBoard() {
    document.getElementById('boardView').hidden = false;
    document.getElementById('detailView').hidden = true;
    drawCurve(null, null);
  }

  /* ---- wiring ---- */
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('wlOnly').addEventListener('change', function (e) { state.wl = e.target.checked; renderBoard(); });
  document.getElementById('sortSel').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-sort');
      document.getElementById('sortSel').value = state.sort;
      renderBoard();
    });
  });
  document.getElementById('boardBody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) location.hash = '#/' + tr.getAttribute('data-slug');
  });
  document.getElementById('backLink').addEventListener('click', function (e) {
    e.preventDefault();
    history.pushState('', document.title, location.pathname + location.search);
    showBoard();
  });
  window.addEventListener('hashchange', route);
  function route() {
    var m = /^#\/([^/]+)$/.exec(location.hash);
    if (m) showDetail(decodeURIComponent(m[1])); else showBoard();
  }
  renderBoard();
  route();
})();
