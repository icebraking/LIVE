/* =======================================================================
   ib-points.js — Icebraking F1 Points engine (isomorphic: Node + browser)
   Data source: Jolpica / Ergast API (https://api.jolpi.ca/ergast/f1/)
   A whole season is fetched in a handful of paginated requests.

   Metric (per classified finisher, re-ranked contiguously 1..k):
     P(n) = M * ((N+1-n)^3 - 1) / (N^3 - 1)
       2025: N=20, denom 7999, main M=56, sprint M=12
       2026: N=22, denom 10647, main M=76, sprint M=12
   Bonuses (both years):
     qualifying pole +2.00, main-race fastest lap +1.00 (even if DNF),
     sprint pole +0.50 (sprint grid P1 proxy), no sprint fastest-lap bonus.
   Classification: only finishers with a numeric positionText score race
   points; DNF/DNS/DSQ (R/D/E/W/F/N) excluded and re-ranked out.
   Constructor points = sum of both drivers' points across all sessions;
   per-race Constructor entrant data handles 2025 mid-season driver swaps
   (Alpine's 3rd driver, Red Bull <-> Racing Bulls) automatically.
   ======================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IB = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ERG = 'https://api.jolpi.ca/ergast/f1/';

  var PARAMS = {
    2025: { N: 20, Mmain: 56, Msprint: 12 },
    2026: { N: 22, Mmain: 76, Msprint: 12 }
  };

  // ---- Points formula -------------------------------------------------
  function rawPoints(n, N, M) {
    if (n == null || n < 1 || n > N) return 0;
    return M * (Math.pow(N + 1 - n, 3) - 1) / (Math.pow(N, 3) - 1);
  }
  function mainPoints(n, year) { var p = PARAMS[year]; return rawPoints(n, p.N, p.Mmain); }
  function sprintPoints(n, year) { var p = PARAMS[year]; return rawPoints(n, p.N, p.Msprint); }

  // ---- Team name normalisation (by stable Ergast constructorId) -------
  var ID2NAME = {
    mclaren: 'McLaren', ferrari: 'Ferrari', red_bull: 'Red Bull Racing',
    mercedes: 'Mercedes', aston_martin: 'Aston Martin', alpine: 'Alpine',
    williams: 'Williams', rb: 'Racing Bulls', haas: 'Haas', sauber: 'Kick Sauber',
    cadillac: 'Cadillac'
  };
  function canonTeam(ctor) {
    if (!ctor) return 'Unknown';
    if (ctor.constructorId && ID2NAME[ctor.constructorId]) return ID2NAME[ctor.constructorId];
    return ctor.name || 'Unknown';
  }

  // ---- Fetch helpers --------------------------------------------------
  // Jolpica: ~4 req/sec burst, 500/hour. 300ms spacing keeps us safe.
  var GAP = 300, _last = 0;
  function throttle() {
    var now = Date.now();
    var wait = Math.max(0, _last + GAP - now);
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

  // Fetch a whole season for one table kind, merging rows split across pages.
  // kind: 'results' | 'qualifying' | 'sprint'; innerKey: the per-race array key.
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

  // Official F1 championship positions (for the OFF POS column).
  function fetchStandings(year) {
    return Promise.all([
      fetchJSON(ERG + year + '/driverStandings/?limit=100'),
      fetchJSON(ERG + year + '/constructorStandings/?limit=100')
    ]).then(function (v) {
      var dl = v[0].MRData.StandingsTable.StandingsLists;
      var cl = v[1].MRData.StandingsTable.StandingsLists;
      var dOff = {}, cOff = {};
      if (dl && dl[0]) dl[0].DriverStandings.forEach(function (r) { dOff[r.Driver.driverId] = +r.position; });
      if (cl && cl[0]) cl[0].ConstructorStandings.forEach(function (r) { cOff[canonTeam(r.Constructor)] = +r.position; });
      return { dOff: dOff, cOff: cOff };
    }).catch(function () { return { dOff: {}, cOff: {} }; });
  }

  function isClassified(row) { return /^\d+$/.test(String(row.positionText)); }
  function byPos(a, b) { return (+a.position) - (+b.position); }

  // ---- Build a full season -------------------------------------------
  function buildSeason(year, opts) {
    year = +year;
    return Promise.all([
      fetchSeasonRows(year, 'results', 'Results'),
      fetchSeasonRows(year, 'qualifying', 'QualifyingResults'),
      fetchSeasonRows(year, 'sprint', 'SprintResults'),
      fetchStandings(year)
    ]).then(function (sets) {
      var races = sets[0], qualis = sets[1], sprints = sets[2], standings = sets[3];

      var drivers = {};      // driverId -> {name, code, points, lastRound, lastTeam}
      var constructors = {}; // canonical name -> points
      var lastRound = 0, lastRaceName = null;

      function ensureDriver(row, round) {
        var id = row.Driver.driverId;
        if (!drivers[id]) {
          drivers[id] = {
            id: id, name: (row.Driver.givenName + ' ' + row.Driver.familyName).trim(),
            code: row.Driver.code || '', points: 0, lastRound: 0, lastTeam: ''
          };
        }
        var d = drivers[id];
        if (round >= d.lastRound) { d.lastRound = round; d.lastTeam = canonTeam(row.Constructor); }
        return d;
      }
      function add(row, round, pts) {
        var d = ensureDriver(row, round);
        d.points += pts;
        var ctor = canonTeam(row.Constructor);
        constructors[ctor] = (constructors[ctor] || 0) + pts;
      }

      Object.keys(races).map(Number).sort(function (a, b) { return a - b; }).forEach(function (rd) {
        var R = races[rd];
        if (!R.rows.length) return;
        lastRound = rd; lastRaceName = R.raceName;

        // make sure every participant is listed (DNFs included, 0 pts)
        R.rows.forEach(function (row) { ensureDriver(row, rd); });

        // main-race finishing points (classified, re-ranked 1..k)
        R.rows.filter(isClassified).sort(byPos).forEach(function (row, i) {
          add(row, rd, mainPoints(i + 1, year));
        });
        // main-race fastest lap +1 (rank 1, even if DNF)
        var fl = R.rows.filter(function (x) { return x.FastestLap && x.FastestLap.rank === '1'; })[0];
        if (fl) add(fl, rd, 1);
        // qualifying pole +2
        var Q = qualis[rd];
        if (Q) { var pole = Q.rows.filter(function (q) { return q.position === '1'; })[0]; if (pole) add(pole, rd, 2); }
        // sprint race finishing points + sprint pole (grid P1 proxy) +0.5
        var S = sprints[rd];
        if (S && S.rows.length) {
          S.rows.filter(isClassified).sort(byPos).forEach(function (row, i) {
            add(row, rd, sprintPoints(i + 1, year));
          });
          var sp = S.rows.filter(function (x) { return x.grid === '1'; })[0];
          if (sp) add(sp, rd, 0.5);
        }
      });

      var dArr = Object.keys(drivers).map(function (k) { return drivers[k]; })
        .sort(function (a, b) { return b.points - a.points; })
        .map(function (d, i) { return { pos: i + 1, name: d.name, team: d.lastTeam || 'Unknown', points: +d.points.toFixed(2), offPos: standings.dOff[d.id] || null }; });
      var cArr = Object.keys(constructors).map(function (k) { return { team: k, points: constructors[k] }; })
        .filter(function (c) { return c.team && c.team !== 'Unknown'; })
        .sort(function (a, b) { return b.points - a.points; })
        .map(function (c, i) { return { pos: i + 1, team: c.team, points: +c.points.toFixed(2), offPos: standings.cOff[c.team] || null }; });

      return {
        year: year, generatedAt: new Date().toISOString(),
        lastRound: lastRound, lastRaceName: lastRaceName,
        drivers: dArr, constructors: cArr
      };
    });
  }

  // ---- Rendering (shared by both pages) ------------------------------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function driversTableHTML(data) {
    var rows = data.drivers.map(function (d) {
      return '<tr><td>' + d.pos + '</td>' +
        '<td class="ib-left">' + esc(d.name) + '</td>' +
        '<td class="ib-left">' + esc(d.team) + '</td>' +
        '<td class="ib-pts">' + d.points.toFixed(2) + '</td>' +
        '<td class="ib-off">' + (d.offPos || '—') + '</td></tr>';
    }).join('');
    return '<table class="standings-table ib-table"><thead><tr><th>POS</th><th class="ib-left">DRIVER</th><th class="ib-left">TEAM</th><th class="ib-pts">POINTS</th><th class="ib-off">OFF POS</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function constructorsTableHTML(data) {
    var rows = data.constructors.map(function (c) {
      return '<tr><td>' + c.pos + '</td>' +
        '<td class="ib-left">' + esc(c.team) + '</td>' +
        '<td class="ib-pts">' + c.points.toFixed(2) + '</td>' +
        '<td class="ib-off">' + (c.offPos || '—') + '</td></tr>';
    }).join('');
    return '<table class="standings-table ib-table"><thead><tr><th>POS</th><th class="ib-left">CONSTRUCTOR</th><th class="ib-pts">POINTS</th><th class="ib-off">OFF POS</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function noteHTML(data) {
    if (!data.lastRound) return '';
    var name = data.lastRaceName ? (' — ' + esc(data.lastRaceName)) : '';
    return 'Updated after Round ' + data.lastRound + name;
  }

  function renderInto(data, els) {
    if (els.driversEl) els.driversEl.innerHTML = driversTableHTML(data);
    if (els.constructorsEl) els.constructorsEl.innerHTML = constructorsTableHTML(data);
    if (els.noteEl) els.noteEl.textContent = noteHTML(data);
  }

  // Position -> points reference table (used by the Logic pages)
  function pointsTableHTML(year, type) {
    var N = PARAMS[year].N, fn = (type === 'sprint') ? sprintPoints : mainPoints, rows = '';
    for (var n = 1; n <= N; n++) {
      rows += '<tr><td>' + n + '</td><td class="ib-pts">' + fn(n, year).toFixed(2) + '</td></tr>';
    }
    return '<table class="standings-table ib-table"><thead><tr><th>POSITION</th><th class="ib-pts">POINTS</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  return {
    PARAMS: PARAMS,
    mainPoints: mainPoints,
    sprintPoints: sprintPoints,
    canonTeam: canonTeam,
    buildSeason: buildSeason,
    renderInto: renderInto,
    driversTableHTML: driversTableHTML,
    constructorsTableHTML: constructorsTableHTML,
    pointsTableHTML: pointsTableHTML,
    noteHTML: noteHTML
  };
}));
