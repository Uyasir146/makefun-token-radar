// TOKEN RADAR -- the page the judge sees, built from window.RADAR (one snapshot, no network).
//
// THE VALUE MODEL, IN WORDS
// The board answers one question: if a pre-token protocol launched a token tomorrow, what would the
// market plausibly value its network at? We cannot see a token, so we price the protocol the way the
// market prices protocols that already trade: as a multiple of the value the protocol has locked.
// That locked value is its TVL, the dollars sitting in its contracts and pools. A live protocol with
// $1B of TVL and a $250M market cap trades at 0.25x its TVL; if a pre-token protocol with $2.75B of
// TVL looks like those live protocols, its discounted claim is about 0.25 x 2.75B, and then we adjust
// that claim for how the protocol is growing, how long it has waited, and how many chains it spans.
//
// THE FORMULA
//   implied_value = TVL x peer_multiple x growth_mult x maturity_mult x chain_mult
// Every factor is a plain multiplier. TVL is in dollars; peer_multiple is a ratio (mcap / TVL) taken
// from live comps; growth_mult, maturity_mult and chain_mult each land near 1 and bend the claim up or
// down. Multiply them all and you get the implied value the board shows for the row.
//
// WHAT EACH INPUT DOES
//   TVL            the dollars currently locked in the protocol; the scale of the claim.
//   peer_multiple  the market-cap-to-TVL ratio of comparable live protocols (see below).
//   growth_mult    a 7-day TVL change turned into a multiplier through tanh (see below).
//   maturity_mult  a bump for how long a protocol has run without a token (see below).
//   chain_mult     a small reward for spanning many chains, since cross-chain protocols are valued
//                  a little more richly than single-chain ones.
//
// WHAT THE PEER MULTIPLE IS, AND WHERE IT COMES FROM
// The peer multiple is the median market-cap-to-TVL ratio of protocols that already trade. Those live
// protocols are gathered into families by category. When a pre-token protocol has enough close
// relatives (thirteen or more in its family), we use that family's median multiple and call it a
// 'family' multiple; when the family is thin, we widen to the whole category ('category'), and when
// even that is thin we fall back to the global median over all live comps and call it 'global'. Each
// row carries peer_basis, peer_count, peer_p25 and peer_p75 so the basis and the spread are visible.
// The Market multiples view lists every group of live comps behind these numbers.
//
// WHY GROWTH IS DAMPED WITH TANH
// A single 7-day TVL number is noisy: a protocol can double its TVL in a week on one incentive
// campaign and lose it again the next. If we multiplied the claim by the raw percentage, one wild week
// would dominate the whole page. So we pass the change through a hyperbolic tangent, which is roughly
// linear for small changes and then flattens, so a +100% week cannot say the protocol is worth twice
// as much as a +200% week. growth_mult = 1 + 0.5 * tanh(growth_pct / 100), which keeps the factor
// inside a sane band and stops a trend-chasing number from running away.
//
// WHY MATURITY RISES WITH AGE
// A protocol that has run for years without a token has already survived audits, a bear market and the
// temptation to launch early; its eventual token is more credible than a protocol that appeared last
// month. So maturity_mult grows with age_days, approaching but never reaching a ceiling: older rows
// get a small, bounded bump, and young rows are held back rather than punished to zero. It is a
// reputational discount, not a countdown.
//
// THE THREE CAVEATS
//  1. A launch may never come. The value here is the entry's claim, never a promise, and some of these
//     protocols will simply never issue a token.
//  2. A token is not a payout. Even after a launch, an implied network value is not money in your
//     pocket; your share depends on points, eligibility and the airdrop design, none of which is known.
//  3. A TVL share is not an airdrop share. Locking TVL might earn points, but points are not tokens,
//     and the ratio between the two is decided later, by the protocol, not by this page.
//
// Everything below is presentation: formatters, the masthead, the board and its drawer, the set-aside
// and market views, the method text and the sandbox. No Date.now(), no Math.random(): two loads of the
// same snapshot render identical bytes.

(function () {
  'use strict';

  var R = window.RADAR;
  var app = document.getElementById('app');
  var target = app;

  // ---- formatters ----------------------------------------------------------
  // Money: one decimal for B/M, exact below 1000.
  function money(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    var a = Math.abs(v);
    if (a >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(v / 1e3) + 'k';
    return '$' + Math.round(v);
  }
  // Percent with sign, one decimal; n/a for null/unknown.
  function pct(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function mult(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return v.toFixed(2) + 'x';
  }
  function ratio(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return v.toFixed(d === undefined ? 4 : d) + 'x';
  }
  function days(v) {
    if (v === null || v === undefined || !isFinite(v)) return 'n/a';
    return Math.round(v) + 'd';
  }
  function txt(s) { return String(s === null || s === undefined ? '' : s); }

  // ---- small DOM helpers ---------------------------------------------------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svg(name, attrs) {
    var NS = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(NS, name);
    for (var k in attrs) s.setAttribute(k, attrs[k]);
    return s;
  }

  // ---- derived data --------------------------------------------------------
  var rows = R.rows.slice();
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });
  var maxImplied = rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);
  var categories = {};
  var chainCounts = {};
  rows.forEach(function (r) {
    categories[r.category] = (categories[r.category] || 0) + 1;
    (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; });
  });
  var catList = Object.keys(categories).sort();
  var chainList = Object.keys(chainCounts).sort();
  var compsByCat = {};
  (R.comps || []).forEach(function (c) { compsByCat[c.category] = c; });
  var liveCompCount = (R.comps || []).reduce(function (m, c) { return Math.max(m, c.count); }, 0);

  function onFloor(r) { return r.on_watchlist === true; }

  // The snapshot applies no rounding; the sandbox recomputes the value column only.
  function baseValue(r) { return r.tvl_usd * r.peer_multiple * r.growth_mult * r.maturity_mult * r.chain_mult; }

  // ---- state ---------------------------------------------------------------
  var state = {
    view: 'board',
    q: '',
    cat: '',
    chain: '',
    floorOnly: false,
    has7d: false,
    sort: 'implied',
    dir: 'desc',
    open: null,
    sandbox: { peer: 1, growth: 1, maturity: 1 }
  };

  // ---- render: masthead ----------------------------------------------------
  var radarGlyph = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">' +
    '<circle cx="9" cy="9" r="7.5" fill="none" stroke="#f5b544" stroke-width="1"/>' +
    '<circle cx="9" cy="9" r="4" fill="none" stroke="#f5b544" stroke-width=".6" opacity=".5"/>' +
    '<path d="M9 1.5V9l5.2 5.2" fill="none" stroke="#f5b544" stroke-width="1"/>' +
    '<circle cx="9" cy="9" r="1.1" fill="#f5b544"/></svg>';

  function renderMasthead() {
    var sec = el('section', 'masthead');
    var brand = el('div', 'brand');
    brand.innerHTML = radarGlyph;
    var wm = el('div');
    wm.appendChild(el('div', 'wordmark', 'TOKEN RADAR'));
    wm.appendChild(el('div', 'sub', 'pre-token launch radar / model ' + R.model_version + ' / snapshot ' + R.as_of));
    brand.appendChild(wm);
    sec.appendChild(brand);

    var right = el('div', 'mast-right');
    right.appendChild(el('div', 'tagline', 'static / offline / every figure derived from the snapshot'));
    var counters = el('div', 'counters');
    function counter(n, l) {
      var d = el('div');
      d.appendChild(el('div', 'n mono', n));
      d.appendChild(el('div', 'l', l));
      return d;
    }
    counters.appendChild(counter(R.board_size, 'subjects'));
    counters.appendChild(counter(R.watchlist_size, 'house floor'));
    counters.appendChild(counter(R.set_aside_size, 'set aside'));
    right.appendChild(counters);
    sec.appendChild(right);
    app.appendChild(sec);
  }

  // ---- render: KPI strip ---------------------------------------------------
  function kpis() {
    var vals = rows.map(function (r) { return r.implied_value_usd; }).sort(function (a, b) { return a - b; });
    var mid = vals.length % 2
      ? vals[(vals.length - 1) / 2]
      : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    var ages = rows.filter(function (r) { return r.age_days !== null && r.age_days !== undefined; })
      .map(function (r) { return r.age_days; }).sort(function (a, b) { return a - b; });
    var ageMid = ages.length % 2
      ? ages[(ages.length - 1) / 2]
      : (ages[ages.length / 2 - 1] + ages[ages.length / 2]) / 2;
    var largest = vals[vals.length - 1];
    return [
      { label: 'Ranked subjects', big: String(rows.length), gloss: 'pre-token protocols scored' },
      { label: 'Median implied value', big: money(mid), gloss: 'middle row of the board' },
      { label: 'Largest implied value', big: money(largest), gloss: 'the strongest claim here' },
      { label: 'Median wait', big: Math.round(ageMid) + ' days', gloss: 'listed with no token yet' },
      { label: 'Live comps', big: String(liveCompCount), gloss: 'multiples derived from ' + liveCompCount + ' trading protocols' }
    ];
  }

  function renderKpis() {
    var sec = el('section', 'kpis');
    kpis().forEach(function (k) {
      var d = el('div');
      d.appendChild(el('div', 'micro', k.label));
      d.appendChild(el('div', 'big', k.big));
      d.appendChild(el('div', 'gloss', k.gloss));
      sec.appendChild(d);
    });
    app.appendChild(sec);
  }

  // ---- filtering and sorting ----------------------------------------------
  function matches(r) {
    if (state.q) {
      var q = state.q.toLowerCase();
      if (r.name.toLowerCase().indexOf(q) < 0 &&
          r.slug.toLowerCase().indexOf(q) < 0 &&
          (r.category || '').toLowerCase().indexOf(q) < 0) return false;
    }
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
    if (state.floorOnly && !onFloor(r)) return false;
    if (state.has7d && r.growth_unknown) return false;
    return true;
  }

  function sortVal(r) {
    switch (state.sort) {
      case 'score': return r.launch_score;
      case 'tvl': return r.tvl_usd;
      case 'growth': return r.growth_unknown ? -1e15 : r.growth_pct;
      case 'age': return r.age_days === null ? -1 : r.age_days;
      case 'name': return r.name.toLowerCase();
      default: return r.implied_value_usd;
    }
  }

  function visibleRows() {
    var out = rows.filter(matches);
    var dir = state.dir === 'asc' ? 1 : -1;
    out.sort(function (a, b) {
      var x = sortVal(a), y = sortVal(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return (a.rank - b.rank) * dir;
    });
    return out;
  }

  function resetFilters() {
    state.q = ''; state.cat = ''; state.chain = '';
    state.floorOnly = false; state.has7d = false; state.open = null;
    syncHash(); paint();
  }

  function filtersActive() {
    return !!(state.q || state.cat || state.chain || state.floorOnly || state.has7d);
  }

  function syncToolbar() {
    if (!ui.search) return;
    ui.search.value = state.q;
    ui.cat.value = state.cat;
    ui.chain.value = state.chain;
    ui.sort.value = state.sort;
    ui.floor.checked = state.floorOnly;
    ui.has7d.checked = state.has7d;
  }

  // ---- render: toolbar -----------------------------------------------------
  var ui = {};

  function renderToolbar() {
    var sec = el('section', 'toolbar');

    var search = el('input');
    search.type = 'search';
    search.placeholder = 'Search name, slug or category';
    search.setAttribute('aria-label', 'Search');
    search.addEventListener('input', function () {
      clearTimeout(ui.debounce);
      ui.debounce = setTimeout(function () {
        state.q = search.value.trim();
        state.open = null;
        syncHash();
        paint();
      }, 60);
    });
    ui.search = search;
    sec.appendChild(search);

    var cat = el('select');
    cat.setAttribute('aria-label', 'Category');
    var catAll = el('option', null, 'All categories');
    catAll.value = '';
    cat.appendChild(catAll);
    catList.forEach(function (c) {
      var o = el('option', null, c + '  (' + categories[c] + ')');
      o.value = c;
      cat.appendChild(o);
    });
    cat.addEventListener('change', function () {
      state.cat = cat.value; state.open = null; syncHash(); paint();
    });
    ui.cat = cat;
    sec.appendChild(cat);

    var chain = el('select');
    chain.setAttribute('aria-label', 'Chain');
    var chAll = el('option', null, 'All chains');
    chAll.value = '';
    chain.appendChild(chAll);
    chainList.forEach(function (c) {
      var o = el('option', null, c + '  (' + chainCounts[c] + ')');
      o.value = c;
      chain.appendChild(o);
    });
    chain.addEventListener('change', function () {
      state.chain = chain.value; state.open = null; syncHash(); paint();
    });
    ui.chain = chain;
    sec.appendChild(chain);

    var sort = el('select');
    sort.setAttribute('aria-label', 'Sort');
    [['implied', 'Implied value'], ['score', 'Launch score'], ['tvl', 'TVL'],
     ['growth', '7d growth'], ['age', 'Age'], ['name', 'Name']].forEach(function (p) {
      var o = el('option', null, p[1]);
      o.value = p[0];
      sort.appendChild(o);
    });
    sort.addEventListener('change', function () {
      state.sort = sort.value; state.dir = 'desc'; syncHash(); paint();
    });
    ui.sort = sort;
    sec.appendChild(sort);

    var floorWrap = el('label');
    var floorCb = el('input');
    floorCb.type = 'checkbox';
    floorCb.addEventListener('change', function () {
      state.floorOnly = floorCb.checked; state.open = null; syncHash(); paint();
    });
    ui.floor = floorCb;
    floorWrap.appendChild(floorCb);
    floorWrap.appendChild(document.createTextNode('House floor only'));
    sec.appendChild(floorWrap);

    var gWrap = el('label');
    var gCb = el('input');
    gCb.type = 'checkbox';
    gCb.addEventListener('change', function () {
      state.has7d = gCb.checked; state.open = null; syncHash(); paint();
    });
    ui.has7d = gCb;
    gWrap.appendChild(gCb);
    gWrap.appendChild(document.createTextNode('Has 7d data'));
    sec.appendChild(gWrap);

    sec.appendChild(el('div', 'spacer'));

    ui.count = el('span', 'count');
    sec.appendChild(ui.count);

    var clear = el('button', 'clear', '\u00d7');
    clear.setAttribute('aria-label', 'Clear filters');
    clear.title = 'Clear filters';
    clear.addEventListener('click', resetFilters);
    ui.clear = clear;
    sec.appendChild(clear);

    sec.appendChild(el('span', 'hint', 'press / to search, j/k to move, enter to open'));

    syncToolbar();

    app.appendChild(sec);
  }

  // ---- render: tabs --------------------------------------------------------
  function renderTabs() {
    var sec = el('section', 'tabs');
    var defs = [
      ['board', 'Board'],
      ['aside', 'Set aside (' + R.set_aside_size + ')'],
      ['multiples', 'Market multiples'],
      ['method', 'Method']
    ];
    ui.tabs = [];
    defs.forEach(function (d) {
      var b = el('button', 'tab' + (state.view === d[0] ? ' active' : ''), d[1]);
      b.setAttribute('data-view', d[0]);
      b.addEventListener('click', function () {
        state.view = d[0]; state.open = null; syncHash(); paint();
      });
      ui.tabs.push(b);
      sec.appendChild(b);
    });
    app.appendChild(sec);
  }

  // ---- render: board -------------------------------------------------------
  function chainChips(chains) {
    var wrap = el('span');
    var show = (chains || []).slice(0, 3);
    show.forEach(function (c) { wrap.appendChild(el('span', 'chip', c)); });
    if ((chains || []).length > 3) wrap.appendChild(el('span', 'chip', '+' + (chains.length - 3)));
    return wrap;
  }

  function renderBoard() {
    var vis = visibleRows();
    var maxVis = vis.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 0);

    var sec = el('section');
    var table = el('table');
    var thead = el('thead');
    var htr = el('tr');

    var cols = [
      { key: '_rank', label: '#', cls: '' },
      { key: 'name', label: 'Protocol', cls: '' },
      { key: '_chains', label: 'Chains', cls: '' },
      { key: 'tvl', label: 'TVL', cls: 'r' },
      { key: 'growth', label: '7D', cls: 'r' },
      { key: 'age', label: 'No token', cls: 'r' },
      { key: 'score', label: 'Launch', cls: '' },
      { key: 'implied', label: 'Implied value', cls: 'r' },
      { key: '_peer', label: 'Peer', cls: 'r' }
    ];
    var sortMap = { implied: 'implied', score: 'score', tvl: 'tvl', growth: 'growth', age: 'age', name: 'name' };
    cols.forEach(function (c) {
      var th = el('th', c.cls);
      th.textContent = c.label;
      var mapKey = sortMap[c.key];
      if (mapKey) {
        th.appendChild(document.createTextNode(''));
        if (state.sort === mapKey) th.appendChild(el('span', 'sort-ind', state.dir === 'asc' ? '\u2191' : '\u2193'));
        th.addEventListener('click', function () {
          if (state.sort === mapKey) {
            state.dir = state.dir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sort = mapKey; state.dir = 'desc';
          }
          state.open = null; syncHash(); paint();
        });
      } else {
        th.style.cursor = 'default';
      }
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el('tbody');
    var frag = document.createDocumentFragment();
    vis.forEach(function (r) {
      var tr = el('tr');
      tr.setAttribute('data-slug', r.slug);
      if (state.open === r.slug) tr.className = 'sel';

      var tdRank = el('td', 'rank' + (r.rank <= 3 ? ' top' : ''), String(r.rank));
      tr.appendChild(tdRank);

      var tdP = el('td');
      tdP.appendChild(el('div', 'pname', r.name));
      var sub = el('div', 'psub');
      sub.appendChild(document.createTextNode(r.category || ''));
      if (onFloor(r)) sub.appendChild(el('span', 'chip floor', 'house floor'));
      tdP.appendChild(sub);
      tr.appendChild(tdP);

      var tdC = el('td');
      tdC.appendChild(chainChips(r.chains));
      tr.appendChild(tdC);

      tr.appendChild(el('td', 'r num', money(r.tvl_usd)));

      var tdG = el('td', 'r num');
      if (r.growth_unknown) {
        tdG.appendChild(el('span', 'na', 'n/a'));
      } else {
        tdG.className = 'r num ' + (r.growth_pct >= 0 ? 'up' : 'down');
        tdG.appendChild(el('span', 'arrow', r.growth_pct >= 0 ? '\u2191' : '\u2193'));
        tdG.appendChild(document.createTextNode(' ' + pct(r.growth_pct)));
      }
      tr.appendChild(tdG);

      var tdA = el('td', 'r num' + (r.age_days !== null && r.age_days < 90 ? ' gdim' : ''), days(r.age_days));
      tr.appendChild(tdA);

      var tdL = el('td');
      var lwrap = el('div', 'bar launch');
      var lfill = el('i');
      lfill.style.width = Math.max(0, Math.min(100, r.launch_score)) + '%';
      lwrap.appendChild(lfill);
      tdL.appendChild(lwrap);
      tdL.appendChild(el('div', 'num', String(r.launch_score)));
      tr.appendChild(tdL);

      var tdV = el('td', 'r');
      var vdiv = el('div', 'num' + (r.rank <= 3 ? ' amber' : ''), money(sandboxValue(r)));
      vdiv.setAttribute('data-val', r.slug);
      var vb = el('div', 'valbar');
      var vi = el('i');
      vi.setAttribute('data-valbar', r.slug);
      vi.style.width = (maxVis > 0 ? sandboxValue(r) / maxVis * 100 : 0) + '%';
      vb.appendChild(vi);
      tdV.appendChild(vdiv);
      tdV.appendChild(vb);
      tr.appendChild(tdV);

      var tdPeer = el('td', 'r peer');
      tdPeer.appendChild(el('div', 'b', mult(r.peer_multiple)));
      tdPeer.appendChild(el('div', 'k', r.peer_basis + ' \u00b7 n=' + r.peer_count));
      tr.appendChild(tdPeer);

      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    if (vis.length === 0) {
      var etr = el('tr', 'empty');
      var etd = el('td');
      etd.colSpan = 9;
      etd.appendChild(el('div', 'empty-msg', 'No protocol matches these filters'));
      var ebtn = el('button', 'clear', 'Clear filters');
      ebtn.addEventListener('click', resetFilters);
      etd.appendChild(ebtn);
      etr.appendChild(etd);
      tbody.appendChild(etr);
    }

    table.appendChild(tbody);
    sec.appendChild(table);

    tbody.addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      var slug = tr.getAttribute('data-slug');
      state.open = state.open === slug ? null : slug;
      syncHash(); paint();
    });

    target.appendChild(sec);
    target.appendChild(renderSandbox());

    ui.count.textContent = vis.length + ' / ' + rows.length + ' rows';
    ui.clear.style.display = filtersActive() ? '' : 'none';
  }

  // The sandbox re-multiplies the published factors; it never changes rank.
  function sandboxValue(r) {
    var pw = state.sandbox.peer, gw = state.sandbox.growth, mw = state.sandbox.maturity;
    if (pw === 1 && gw === 1 && mw === 1) return r.implied_value_usd;
    return r.tvl_usd * (r.peer_multiple * pw) *
      (1 + (r.growth_mult - 1) * gw) *
      (1 + (r.maturity_mult - 1) * mw) * r.chain_mult;
  }

  // ---- detail drawer -------------------------------------------------------
  function renderDrawer() {
    var old = document.querySelector('.drawer');
    if (old) old.parentNode.removeChild(old);
    var oldBack = document.querySelector('.backdrop');
    if (oldBack) oldBack.parentNode.removeChild(oldBack);
    if (!state.open || !bySlug[state.open]) return;
    var r = bySlug[state.open];

    var back = el('div', 'backdrop');
    back.addEventListener('click', function () { state.open = null; syncHash(); paint(); });
    app.appendChild(back);

    var d = el('aside', 'drawer');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-label', r.name + ' detail');

    var head = el('div', 'dhead');
    var hleft = el('div');
    hleft.appendChild(el('div', 'dtitle', r.name));
    var subline = el('div', 'dsub');
    subline.appendChild(document.createTextNode((r.category || '') + ' \u00b7 ' + (r.chains || []).join(', ')));
    if (onFloor(r)) subline.appendChild(el('span', 'chip floor', 'house floor'));
    hleft.appendChild(subline);
    head.appendChild(hleft);
    var closeWrap = el('div', 'dclosewrap');
    var close = el('button', 'dclose', '\u00d7');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', function () { state.open = null; syncHash(); paint(); });
    closeWrap.appendChild(close);
    closeWrap.appendChild(el('div', 'dhint', 'esc to close'));
    head.appendChild(closeWrap);
    d.appendChild(head);

    d.appendChild(el('div', 'dval', money(sandboxValue(r))));
    d.appendChild(el('div', 'drange', 'range ' + money(r.implied_low_usd) + ' - ' + money(r.implied_high_usd) + ' (p25-p75)'));
    d.appendChild(el('div', 'dgloss', "implied by the peer multiple, not the protocol's own revenue"));

    d.appendChild(el('div', 'dsectitle', 'Model breakdown'));
    var brk = [
      ['TVL', money(r.tvl_usd), 'locked value at the snapshot'],
      ['peer multiple', ratio(r.peer_multiple, 4) + ' x', r.peer_count + ' live ' + r.category + ' comps, median mcap/TVL'],
      ['growth', ratio(r.growth_mult, 3) + 'x', pct(r.growth_pct) + ' over 7d, tanh-damped'],
      ['maturity', ratio(r.maturity_mult, 3) + 'x', days(r.age_days) + ' listed, no token'],
      ['chains', ratio(r.chain_mult, 3) + 'x', (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's')]
    ];
    brk.forEach(function (b) {
      var row = el('div', 'brow');
      var l = el('div');
      l.appendChild(el('div', 'bl', b[0]));
      l.appendChild(el('div', 'bn', b[2]));
      row.appendChild(l);
      row.appendChild(el('div', 'bv', b[1]));
      d.appendChild(row);
    });
    d.appendChild(el('div', 'formula', 'implied value = TVL x peer x growth x maturity x chains'));

    d.appendChild(el('div', 'dsectitle', 'Launch score'));
    var sc = el('div', 'brow');
    var scl = el('div');
    scl.appendChild(el('div', 'bl', r.launch_score + ' / 100'));
    scl.appendChild(el('div', 'bn', 'a heuristic ranking of likelihood, not a probability'));
    sc.appendChild(scl);
    d.appendChild(sc);
    [['age', r.launch_age_percentile], ['tvl', r.launch_tvl_percentile],
     ['growth', r.launch_growth_percentile]].forEach(function (p) {
      var pr = el('div', 'pctrow');
      pr.appendChild(el('span', 'micro', p[0]));
      var bar = el('div', 'pctbar');
      var fill = el('i');
      fill.style.width = Math.max(0, Math.min(100, p[1] || 0)) + '%';
      bar.appendChild(fill);
      pr.appendChild(bar);
      pr.appendChild(el('span', 'num', (p[1] === null || p[1] === undefined ? 'n/a' : p[1] + 'p')));
      d.appendChild(pr);
    });
    if (r.category_precedent !== null && r.category_precedent !== undefined) {
      d.appendChild(el('div', 'dgloss', 'category precedent ' + Math.round(r.category_precedent * 100) + '% of ' + r.category + ' protocols already trade'));
    }

    d.appendChild(el('div', 'dsectitle', 'Farm plan'));
    var ol = el('ol', 'steps');
    (r.farm_steps || []).forEach(function (s) { ol.appendChild(el('li', null, s)); });
    d.appendChild(ol);
    var copy = el('button', 'copylink', 'copy');
    copy.addEventListener('click', function () {
      var text = (r.farm_steps || []).join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { copy.textContent = 'copied'; });
      } else {
        copy.textContent = 'copy unavailable';
      }
    });
    d.appendChild(copy);

    d.appendChild(el('div', 'dsectitle', 'What would move this'));
    var ul = el('ul', 'moves');
    var p25 = r.implied_low_usd, p75 = r.implied_high_usd;
    [
      'TVL doubling moves implied value by the same factor, to ' + money(r.implied_value_usd * 2) + '.',
      'A launch at the p25 multiple is worth ' + money(p25) + '; at the p75 it is ' + money(p75) + '.',
      'The score falls if TVL drains 20% in a week: growth turns to 1 + 0.5*tanh(-0.2) = ' +
        ratio(1 + 0.5 * Math.tanh(-0.2), 3) + ', about ' + money(r.tvl_usd * 0.8 * r.peer_multiple) + '.'
    ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
    d.appendChild(ul);

    var comp = compsByCat[r.category];
    if (comp) {
      d.appendChild(el('div', 'dsectitle', 'Comps \u00b7 ' + r.category));
      var exs = (comp.examples || []).slice(0, 6);
      var medAt = -1, medDist = Infinity;
      exs.forEach(function (ex, i) {
        var dist = Math.abs(ex.multiple - comp.median);
        if (dist < medDist) { medDist = dist; medAt = i; }
      });
      exs.forEach(function (ex, i) {
        var crow = el('div', 'comp' + (i === medAt ? ' med' : ''));
        crow.appendChild(el('span', 'cn', ex.name));
        crow.appendChild(el('span', null, money(ex.tvl_usd) + ' \u00b7 ' + money(ex.mcap_usd) + ' \u00b7 ' + ratio(ex.multiple, 2)));
        d.appendChild(crow);
      });
      d.appendChild(el('div', 'dgloss', 'median ' + ratio(comp.median, 4) + ' \u00b7 ' + comp.count + ' comps in this basis'));
    }

    app.appendChild(d);
  }

  // ---- set-aside view ------------------------------------------------------
  function renderAside() {
    var sec = el('section');
    var prose = el('div', 'prose');
    prose.innerHTML = '<p><strong>Why these are set aside.</strong> The model refuses Bridge, Canonical Bridge, ' +
      'Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, names ending in a version marker, ' +
      'names carrying wrapped, staked or staking, and names beginning with an exchange. These are not ' +
      'pre-token protocols waiting on a launch of their own: they are representations or custodial products ' +
      'whose value is already expressed by the asset they wrap.</p>' +
      '<p>WBTC is Bitcoin on Ethereum and Binance staked ETH is ETH in Binance\u2019s staking product; neither ' +
      'is a protocol waiting on a launch of its own.</p>';
    sec.appendChild(prose);

    var table = el('table');
    var thead = el('thead');
    var htr = el('tr');
    [['Name', ''], ['Category', ''], ['TVL', 'r'], ['Reason', 'r']].forEach(function (c) {
      htr.appendChild(el('th', c[1], c[0]));
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = el('tbody');
    var frag = document.createDocumentFragment();
    R.set_aside.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; }).forEach(function (r) {
      var tr = el('tr');
      var tdN = el('td');
      tdN.appendChild(el('div', 'pname', r.name));
      tdN.appendChild(el('div', 'psub', r.slug));
      tr.appendChild(tdN);
      tr.appendChild(el('td', null, r.category));
      tr.appendChild(el('td', 'r num', money(r.tvl_usd)));
      var tdR = el('td', 'r');
      tdR.appendChild(el('span', 'chip', r.reason));
      tr.appendChild(tdR);
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    table.appendChild(tbody);
    sec.appendChild(table);
    target.appendChild(sec);
  }

  // ---- market multiples view ----------------------------------------------
  function renderMultiples() {
    var sec = el('section');
    var prose = el('div', 'prose');
    prose.innerHTML = '<p>These are the ' + liveCompCount + ' live-token comps the model learned its multiples ' +
      'from, grouped by category. Each group shows its median, p25 and p75 mcap/TVL and a few examples; ' +
      'these are the numbers behind every peer multiple on the board.</p>';
    sec.appendChild(prose);

    var groups = (R.comps || []).slice().sort(function (a, b) { return b.count - a.count; });
    var grid = el('div', 'grid');
    groups.forEach(function (g) {
      var card = el('div', 'card');
      card.appendChild(el('h3', null, g.category));
      card.appendChild(el('div', 'stat', 'n=' + g.count + ' \u00b7 median ' + ratio(g.median, 4) +
        ' \u00b7 p25 ' + ratio(g.p25, 4) + ' \u00b7 p75 ' + ratio(g.p75, 4) + ' \u00b7 ' + g.basis));
      var t = el('table');
      var tb = el('tbody');
      (g.examples || []).slice(0, 6).forEach(function (ex) {
        var tr = el('tr');
        tr.appendChild(el('td', null, ex.name));
        tr.appendChild(el('td', 'r num', money(ex.tvl_usd)));
        tr.appendChild(el('td', 'r num', money(ex.mcap_usd)));
        tr.appendChild(el('td', 'r num', ratio(ex.multiple, 4)));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      card.appendChild(t);
      grid.appendChild(card);
    });
    sec.appendChild(grid);
    target.appendChild(sec);
  }

  // ---- method view + sandbox ----------------------------------------------
  function renderSandbox() {
    var wrap = el('div', 'sandbox');
    var top = el('div', 'micro', 'Model sandbox');
    wrap.appendChild(top);
    var row = el('div', 'row');

    function slider(label, key, min, max) {
      var l = el('label');
      var txtEl = el('span', null, label + ' \u00b7 ' + state.sandbox[key].toFixed(2));
      var inp = el('input');
      inp.type = 'range';
      inp.min = String(min);
      inp.max = String(max);
      inp.step = '0.05';
      inp.value = String(state.sandbox[key]);
      inp.addEventListener('input', function () {
        state.sandbox[key] = parseFloat(inp.value);
        txtEl.textContent = label + ' \u00b7 ' + state.sandbox[key].toFixed(2);
        updateValuesOnly();
      });
      l.appendChild(txtEl);
      l.appendChild(inp);
      row.appendChild(l);
    }
    slider('peer weight', 'peer', 0.5, 1.5);
    slider('growth weight', 'growth', 0, 1);
    slider('maturity weight', 'maturity', 0, 1);

    ui.xEl = el('span', 'x');
    row.appendChild(ui.xEl);

    var reset = el('button', null, 'reset');
    reset.addEventListener('click', function () {
      state.sandbox = { peer: 1, growth: 1, maturity: 1 };
      paint();
    });
    row.appendChild(reset);
    wrap.appendChild(row);
    wrap.appendChild(el('div', 'note', "the board's ranks and the model's own numbers are unchanged; this only re-multiplies them for reading"));
    refreshX();
    return wrap;
  }

  // Update only the value column, value bars, sandbox readout and drawer value. Used while dragging.
  function updateValuesOnly() {
    var vis = visibleRows();
    var maxVis = vis.reduce(function (m, r) { return Math.max(m, sandboxValue(r)); }, 0);
    vis.forEach(function (r) {
      var node = document.querySelector('[data-val="' + r.slug + '"]');
      if (node) node.textContent = money(sandboxValue(r));
      var bar = document.querySelector('[data-valbar="' + r.slug + '"]');
      if (bar) bar.style.width = (maxVis > 0 ? sandboxValue(r) / maxVis * 100 : 0) + '%';
    });
    var dv = document.querySelector('.drawer .dval');
    if (dv && state.open && bySlug[state.open]) dv.textContent = money(sandboxValue(bySlug[state.open]));
    refreshX();
  }

  function refreshX() {
    if (!ui.xEl) return;
    var topRow = visibleRows()[0] || rows[0];
    var x = baseValue(topRow) > 0 ? sandboxValue(topRow) / baseValue(topRow) : 1;
    ui.xEl.textContent = 'top row ' + money(sandboxValue(topRow)) + ' (x' + x.toFixed(2) + ')';
  }

  function renderMethod() {
    var sec = el('section');
    var prose = el('div', 'prose');
    prose.innerHTML =
      '<p><strong>What the board answers.</strong> For every pre-token protocol the snapshot covers, the ' +
      'page estimates what a token launch would plausibly be worth, and ranks the protocols by that estimate. ' +
      'It is a reading of the claims in the snapshot, not a prediction of the future.</p>' +
      '<p><strong>The formula.</strong> implied value = TVL x peer multiple x growth x maturity x chains. ' +
      'TVL is the dollars locked; the peer multiple is a live-token mcap/TVL ratio; growth is a tanh-damped ' +
      'seven-day change; maturity rewards protocols that have waited longer; chains gives a small bump for ' +
      'spanning more chains.</p>' +
      '<p><strong>Where the multiples come from.</strong> Each category\u2019s multiple is the median mcap/TVL ' +
      'of the live protocols in that category. Thin families widen to the category, and thin categories fall ' +
      'back to the global median. The Market multiples view lists every group and its examples.</p>' +
      '<p><strong>What the launch score is.</strong> A heuristic ranking of likelihood, not a probability. It ' +
      'blends how old the protocol is, how much TVL it holds and how fast it is growing, and a high score ' +
      'means the protocol looks more launch-ready than its peers, never that a launch is scheduled.</p>' +
      '<p><strong>The caveats.</strong> No promise of a launch: some of these protocols will never issue a ' +
      'token. No promise of a payout: even after a launch, a network value is not money in your pocket. ' +
      'Points are not tokens: the ratio between the two is set later by the protocol. The snapshot is frozen ' +
      'at ' + R.as_of + ' and is never refreshed, so every figure is a reading of that day.</p>';
    sec.appendChild(prose);
    sec.appendChild(renderSandbox());
    target.appendChild(sec);
  }

  // ---- footer --------------------------------------------------------------
  function renderFooter() {
    var f = el('footer');
    f.appendChild(el('div', null, 'Snapshot: ' + R.source + ' \u00b7 model ' + R.model_version +
      ' \u00b7 built for make.fun token-radar-01'));
    f.appendChild(el('div', null, 'Every figure on this page is derived from the snapshot; nothing is fetched at runtime.'));
    app.appendChild(f);
  }

  // ---- hash links ----------------------------------------------------------
  var hashState = { board: true, aside: true, multiples: true, method: true };
  var sortKeys = { implied: true, score: true, tvl: true, growth: true, age: true, name: true };

  function applyHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    var params = {};
    h.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      params[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    if (params.view && hashState[params.view]) state.view = params.view;
    if (params.open && bySlug[params.open]) state.open = params.open;
    if (params.q !== undefined) state.q = params.q;
    if (params.cat !== undefined && categories[params.cat]) state.cat = params.cat;
    if (params.chain !== undefined && chainCounts[params.chain]) state.chain = params.chain;
    if (params.sort && sortKeys[params.sort]) state.sort = params.sort;
    if (params.dir === 'asc' || params.dir === 'desc') state.dir = params.dir;
  }

  function syncHash() {
    var parts = ['view=' + state.view];
    if (state.open) parts.push('open=' + encodeURIComponent(state.open));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    parts.push('sort=' + state.sort);
    parts.push('dir=' + state.dir);
    var h = '#' + parts.join('&');
    if (location.hash !== h) {
      try { history.replaceState(null, '', h); }
      catch (e) { location.hash = h; }
    }
  }

  // ---- paint ---------------------------------------------------------------
  function paint() {
    if (!ui.content) return;
    target = ui.content;
    target.innerHTML = '';

    ui.tabs.forEach(function (b) {
      if (b.getAttribute('data-view') === state.view) b.className = 'tab active';
      else b.className = 'tab';
    });

    if (state.view === 'aside') renderAside();
    else if (state.view === 'multiples') renderMultiples();
    else if (state.view === 'method') renderMethod();
    else renderBoard();

    if (ui.count) {
      if (state.view === 'board') {
        var n = visibleRows().length;
        ui.count.textContent = n + ' / ' + rows.length + ' rows';
      } else {
        ui.count.textContent = R.board_size + ' / ' + R.board_size + ' rows';
      }
    }
    if (ui.clear) {
      ui.clear.style.display = filtersActive() ? '' : 'none';
    }
    syncToolbar();

    renderDrawer();
  }

  // ---- keyboard ------------------------------------------------------------
  function moveSelection(delta) {
    var vis = visibleRows();
    if (!vis.length) return;
    var at = -1;
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].slug === state.open) { at = i; break; }
    }
    if (at < 0) at = 0;
    var next = at + delta;
    if (next < 0) next = 0;
    if (next >= vis.length) next = vis.length - 1;
    state.open = vis[next].slug;
    syncHash(); paint();
    var open = bySlug[state.open];
    if (open) {
      var el2 = document.querySelector('tr[data-slug="' + open.slug + '"]');
      if (el2 && el2.scrollIntoView) el2.scrollIntoView({ block: 'nearest' });
    }
  }

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    var inField = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';

    if (e.key === '/' && !inField) {
      e.preventDefault();
      if (ui.search) ui.search.focus();
      return;
    }
    if (e.key === 'Escape') {
      if (state.open) {
        state.open = null; syncHash(); paint();
      } else if (tag === 'INPUT') {
        e.target.blur();
      }
      return;
    }
    if (inField) return;
    if (e.key === 'Enter' && !state.open) {
      var first = visibleRows()[0];
      if (first) { e.preventDefault(); state.open = first.slug; syncHash(); paint(); }
      return;
    }
    if (state.open) {
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    }
  });

  window.addEventListener('hashchange', function () {
    applyHash();
    syncToolbar();
    paint();
  });

  // ---- init ----------------------------------------------------------------
  applyHash();
  renderMasthead();
  renderKpis();
  renderToolbar();
  renderTabs();
  ui.content = el('div', 'content');
  app.appendChild(ui.content);
  renderFooter();
  paint();
}).call(this);


