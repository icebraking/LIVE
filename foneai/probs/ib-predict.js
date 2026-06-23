/* =======================================================================
   ib-predict.js — Icebraking 2026 end-of-season PREDICTION engine (browser)
   ----------------------------------------------------------------------
   Loads the post-Round-7 baseline (predict-seed.js), pulls every NEW race
   weekend (round > 7) from the Jolpica/Ergast API via the helpers in
   ../table/ib-points.js, evolves the state with the per-race update rules,
   then runs the projection (a faithful JS port of f1_driver_standings.py).

   Per-race update rules (only when the MAIN race has classified results;
   if the main race is abandoned, a completed sprint is used as fallback):
     1 starts +1 (participants)        2 wins +1 (main P1)
     3 poles +1 (qualifying P1)        4 podium +1 (main P1-P3)
     5 H2H recomputed from race finish vs team-mate
     6 remaining pool = 2438 - sum(points)   7 weekend points captured
     8 momentum = last-5 round points  9 DNF +1 (main only; sprint DNF ignored)
    10 constructor points = sum of its two drivers' points
   Fixed all season: Race Factor (seed rf), DQI weight coefficients, momentum
   weights/beta, Car-Weight sigmoid, DNF coefficients, 2438 / 399 constants.
   On any network error the engine falls back to projecting the raw seed, so
   the page always renders.
   ======================================================================= */
(function (root, factory) {
  root.IBP = factory(root.IB_SEED);
}(typeof self !== 'undefined' ? self : this, function (SEED) {
  'use strict';

  var YEAR = 2026, TOTAL = SEED.STATE.seasonTotal, CAP = SEED.LOCKED.perDriverCap;
  var L = SEED.LOCKED;

  // --- Jolpica/Ergast fetch (self-contained; this folder needs no other JS) ---
  var ERG = 'https://api.jolpi.ca/ergast/f1/';
  var GAP = 300, _last = 0;
  function throttle() {
    var now = Date.now(), wait = Math.max(0, _last + GAP - now);
    _last = now + wait;
    return new Promise(function (r) { setTimeout(r, wait); });
  }
  function fetchJSON(url, tries) {
    tries = tries || 5;
    return throttle().then(function () { return fetch(url); }).then(function (r) {
      if (r.status === 429) {
        var ra = parseInt(r.headers && r.headers.get && r.headers.get('retry-after'), 10);
        var e = new Error('HTTP 429 ' + url); e.rate = true; e.retryAfter = (ra > 0 ? ra * 1000 : 0); throw e;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
      return r.json();
    }).catch(function (e) {
      if (tries > 1) {
        var back = e && e.rate ? (e.retryAfter || 2000 * (6 - tries)) : 500;
        return new Promise(function (res) { setTimeout(res, back); }).then(function () { return fetchJSON(url, tries - 1); });
      }
      throw e;
    });
  }
  function fetchSeasonRows(year, kind, innerKey) {
    var byRound = {}, offset = 0, limit = 100;
    function page() {
      return fetchJSON(ERG + year + '/' + kind + '/?limit=' + limit + '&offset=' + offset).then(function (j) {
        var mr = j.MRData, total = +mr.total, races = mr.RaceTable.Races || [];
        races.forEach(function (r) {
          var rd = +r.round;
          if (!byRound[rd]) byRound[rd] = { round: rd, raceName: r.raceName, rows: [] };
          (r[innerKey] || []).forEach(function (x) { byRound[rd].rows.push(x); });
        });
        offset += limit;
        if (offset < total && races.length) return page();
        return byRound;
      });
    }
    return page();
  }

  // ---- helpers --------------------------------------------------------
  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '');
  }
  function vals(o) { return Object.keys(o).map(function (k) { return o[k]; }); }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function maxv(o) { return Math.max.apply(null, vals(o)); }
  // Python-style round-half-to-even (matches f1_driver_standings.py output)
  function pyround(x) {
    var f = Math.floor(x), d = x - f;
    if (Math.abs(d - 0.5) < 1e-9) return (f % 2 === 0) ? f : f + 1;
    return Math.round(x);
  }
  function isCls(row) { return row && /^\d+$/.test(String(row.positionText)); }
  function indexByFamily(rows) {
    var m = {};
    (rows || []).forEach(function (r) { if (r.Driver) m[fold(r.Driver.familyName)] = r; });
    return m;
  }

  // Fresh working copy of the seed (deep-cloned round-point arrays).
  function freshState() {
    var D = {}, keys = [];
    SEED.DRIVERS.forEach(function (s) {
      var k = fold(s.name.split(' ').slice(-1)[0]);
      D[k] = {
        key: k, id: s.id, name: s.name, team: s.team, rf: s.rf,
        starts: s.starts, w: s.w, p: s.p, pod: s.pod, h2h: s.h2h,
        dnf: s.dnf, pts: s.pts, rp: s.rp.slice()
      };
      keys.push(k);
    });
    return { D: D, keys: keys, racesDone: SEED.STATE.racesDone, sprintsDone: SEED.STATE.sprintsDone,
             lastRound: SEED.STATE.racesDone, lastRaceName: null };
  }

  // team -> [keys]
  function teamPairs(st) {
    var t = {};
    st.keys.forEach(function (k) { (t[st.D[k].team] = t[st.D[k].team] || []).push(k); });
    return t;
  }

  // ---- apply one finished weekend ------------------------------------
  // sprintOnly = true when the main race was abandoned and we fall back to sprint.
  function applyRound(st, mainIdx, qualiIdx, sprintIdx, sprintOnly) {
    var pairs = teamPairs(st);

    // 5. H2H — computed from finishing order BEFORE the start increment.
    Object.keys(pairs).forEach(function (team) {
      var pr = pairs[team]; if (pr.length < 2) return;
      var a = pr[0], b = pr[1];
      var ra = (sprintOnly ? sprintIdx : mainIdx)[a], rb = (sprintOnly ? sprintIdx : mainIdx)[b];
      if (!ra || !rb) return;                       // need both classified-or-listed to compare
      var pa = +ra.position, pb = +rb.position;
      if (!(pa > 0) || !(pb > 0) || pa === pb) return;
      var ahead = pa < pb ? a : b, behind = pa < pb ? b : a;
      [ahead, behind].forEach(function (k) {
        var d = st.D[k];
        var wins = Math.round(d.h2h / 100 * d.starts);   // extrapolate to current starts
        if (k === ahead) wins += 1;                       // +1 for the one who finished ahead
        d.h2h = 100 * wins / (d.starts + 1);              // recompute over starts+1
      });
    });

    // 1,2,3,4,7,8,9. Per-driver increments.
    st.keys.forEach(function (k) {
      var d = st.D[k];
      var mr = mainIdx[k], qr = qualiIdx[k], sr = sprintIdx[k];
      var participated = sprintOnly ? !!sr : !!mr;
      var wk = (mr ? (+mr.points || 0) : 0) + (sr ? (+sr.points || 0) : 0);

      d.rp.push(wk);                       // 8. extend momentum history
      d.pts += wk;                         // 7. capture weekend points
      if (participated) d.starts += 1;     // 1. starts

      if (!sprintOnly && mr) {
        if (isCls(mr)) {
          if (mr.position === '1') d.w += 1;          // 2. win
          if (+mr.position <= 3) d.pod += 1;          // 4. podium
        } else {
          d.dnf += 1;                                  // 9. DNF (main only)
        }
      }
      if (qr && qr.position === '1') d.p += 1;         // 3. pole
    });

    st.racesDone += 1;                                  // weekend complete
    if (Object.keys(sprintIdx).length) st.sprintsDone += 1;
  }

  // Replay all rounds newer than the seed.
  function applyRounds(results, qualis, sprints) {
    var st = freshState();
    var rounds = Object.keys(results).map(Number).sort(function (a, b) { return a - b; });
    rounds.forEach(function (rd) {
      if (rd <= SEED.STATE.racesDone) return;           // already in the seed
      var R = results[rd] || { rows: [] };
      var mainRows = R.rows || [];
      if (!mainRows.length) return;                     // main race not run yet -> wait
      var classified = mainRows.filter(isCls);
      var mainIdx = indexByFamily(mainRows);
      var qualiIdx = indexByFamily((qualis[rd] || {}).rows);
      var sprintIdx = indexByFamily((sprints[rd] || {}).rows);

      if (classified.length) {
        applyRound(st, mainIdx, qualiIdx, sprintIdx, false);
        st.lastRound = rd; st.lastRaceName = R.raceName || null;
      } else if (Object.keys(sprintIdx).length) {       // main abandoned -> sprint fallback
        applyRound(st, mainIdx, qualiIdx, sprintIdx, true);
        st.lastRound = rd; st.lastRaceName = (R.raceName || '') + ' (sprint)';
      }
      // else: nothing scored this weekend -> skip
    });
    return st;
  }

  // ---- projection (port of f1_driver_standings.py run()) -------------
  function project(st) {
    var D = st.D, keys = st.keys;

    // constructor points = sum of its two drivers' points (rule 10)
    var TP = {};
    keys.forEach(function (k) { TP[D[k].team] = (TP[D[k].team] || 0) + D[k].pts; });

    var curTotal = sum(keys.map(function (k) { return D[k].pts; }));
    var POOL = TOTAL - curTotal;
    var remRaces = SEED.STATE.totalWeekends - st.racesDone;
    var remSpr = SEED.STATE.totalSprints - st.sprintsDone;
    var MAXREM = remRaces * 25 + remSpr * 8;

    // per-start rates
    var win = {}, pole = {}, pod = {};
    keys.forEach(function (k) {
      var d = D[k];
      win[k] = d.w / d.starts; pole[k] = d.p / d.starts; pod[k] = (d.pod - d.w) / d.starts;
    });
    var mWin = maxv(win), mPol = maxv(pole), mPod = maxv(pod);

    // DQI (weights fixed; rates + H2H + RaceFactor recomputed each round)
    var w = L.dqi, DQI = {};
    keys.forEach(function (k) {
      var d = D[k];
      DQI[k] = w.h2h * (d.h2h / 100) + w.win * (win[k] / mWin) + w.pole * (pole[k] / mPol)
             + w.pod * (pod[k] / mPod) + w.racef * d.rf;
    });
    var mate = {};
    keys.forEach(function (k) {
      mate[k] = keys.filter(function (o) { return o !== k && D[o].team === D[k].team; })[0];
    });

    // Team Strength + Car Weight (floored sigmoid)
    var tot = sum(vals(TP)); var TS = {}; Object.keys(TP).forEach(function (t) { TS[t] = TP[t] / tot; });
    var top = maxv(TP); var RTS = {}; Object.keys(TP).forEach(function (t) { RTS[t] = TP[t] / top; });
    var a = L.cw.a, c = L.cw.c, raw = function (x) { return 1 / (1 + Math.exp(-a * (x - c))); };
    var r0 = raw(0), r1 = raw(1), CW = {};
    Object.keys(TP).forEach(function (t) { CW[t] = (raw(RTS[t]) - r0) / (r1 - r0); });

    // Momentum (last-5 window)
    var last5 = {};
    keys.forEach(function (k) { last5[k] = sum(D[k].rp.slice(-SEED.STATE.momWindow)); });
    var tl5 = {};
    keys.forEach(function (k) { tl5[D[k].team] = (tl5[D[k].team] || 0) + last5[k]; });
    var m = L.mom, M = {};
    keys.forEach(function (k) {
      var d = D[k], t = d.team;
      var R = tl5[t] > 0 ? last5[k] / tl5[t] : 0.5;
      var DRF = TP[t] > 0 ? d.pts / TP[t] : 0;
      M[k] = CW[t] * (m.wRec * R + m.wSea * DRF);
    });
    var Mmean = sum(vals(M)) / keys.length;
    var MM = {};
    keys.forEach(function (k) { MM[k] = Math.max(1 + m.beta * (M[k] / Mmean - 1), 0); });

    // weight -> base -> DNF deduction -> renormalise -> cap
    var weight = {};
    keys.forEach(function (k) {
      weight[k] = TS[D[k].team] * (DQI[k] / (DQI[k] + DQI[mate[k]])) * MM[k];
    });
    var sw = sum(vals(weight));
    var base = {}; keys.forEach(function (k) { base[k] = POOL * weight[k] / sw; });
    var ded = {};
    keys.forEach(function (k) { ded[k] = L.dnf.df * Math.min(D[k].dnf, L.dnf.cap) * (D[k].pts / st.racesDone); });
    var net = {}; keys.forEach(function (k) { net[k] = Math.max(base[k] - ded[k], 0); });
    var sn = sum(vals(net));
    var proj = {}; keys.forEach(function (k) { proj[k] = net[k] * POOL / sn; });

    for (var it = 0; it < 50; it++) {
      var over = sum(keys.map(function (k) { return Math.max(proj[k] - MAXREM, 0); }));
      if (over < 1e-9) break;
      var capped = {};
      keys.forEach(function (k) { if (proj[k] >= MAXREM - 1e-9) { capped[k] = 1; proj[k] = MAXREM; } });
      var nc = Object.keys(capped).length;
      var need = POOL - MAXREM * nc;
      var unc = sum(keys.map(function (k) { return capped[k] ? 0 : proj[k]; }));
      if (unc <= 0) break;
      keys.forEach(function (k) { if (!capped[k]) proj[k] *= need / unc; });
    }

    var fin = {}; keys.forEach(function (k) { fin[k] = pyround(D[k].pts + proj[k]); });
    var diff = TOTAL - sum(vals(fin));
    if (diff) { var lead = keys.reduce(function (a2, k) { return fin[k] > fin[a2] ? k : a2; }, keys[0]); fin[lead] += diff; }

    var dArr = keys.map(function (k) {
      return { name: D[k].name, team: D[k].team, current: D[k].pts, proj: proj[k], final: fin[k] };
    }).sort(function (a2, b2) { return b2.final - a2.final; })
      .map(function (d, i) { d.pos = i + 1; return d; });

    var ct = {}, order = [];
    dArr.forEach(function (d) {
      if (!(d.team in ct)) { ct[d.team] = { cur: 0, fin: 0 }; order.push(d.team); }
      ct[d.team].cur += d.current; ct[d.team].fin += d.final;
    });
    var cArr = order.map(function (t) { return { team: t, current: ct[t].cur, final: ct[t].fin }; })
      .sort(function (a2, b2) { return b2.final - a2.final; })
      .map(function (c2, i) { c2.pos = i + 1; return c2; });

    return { drivers: dArr, constructors: cArr };
  }

  // ---- public: build live (fetch -> evolve -> project) ----------------
  function build() {
    if (typeof fetch === 'undefined') {
      var s = project(freshState()); s.lastRound = SEED.STATE.racesDone; s.lastRaceName = null; s.live = false;
      return Promise.resolve(s);
    }
    return Promise.all([
      fetchSeasonRows(YEAR, 'results', 'Results'),
      fetchSeasonRows(YEAR, 'qualifying', 'QualifyingResults'),
      fetchSeasonRows(YEAR, 'sprint', 'SprintResults')
    ]).then(function (sets) {
      var st = applyRounds(sets[0], sets[1], sets[2]);
      var out = project(st);
      out.lastRound = st.lastRound; out.lastRaceName = st.lastRaceName; out.live = true;
      return out;
    }).catch(function () {
      // Network/API hiccup — silently project the stored snapshot (no page-visible error).
      var st2 = freshState(); var out2 = project(st2);
      out2.lastRound = SEED.STATE.racesDone; out2.lastRaceName = null; out2.live = false;
      return out2;
    });
  }

  // projectSeed() — synchronous seed-only projection (used by tests / anchor).
  function projectSeed() { return project(freshState()); }

  return { build: build, project: project, projectSeed: projectSeed, freshState: freshState, applyRounds: applyRounds };
}));
