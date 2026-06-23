/* =======================================================================
   predict-seed.js — Baseline state for the Icebraking 2026 prediction model
   ----------------------------------------------------------------------
   This is the LOCKED snapshot taken AFTER Round 7 (Barcelona-Catalunya GP).
   It is fed ONCE. From Round 8 onward, ib-predict.js pulls every new race
   weekend from the Jolpica/Ergast API and evolves this state automatically —
   RACEBYRACE.xlsx and the Python script are never needed again this season.

   Per-driver fields:
     id    Ergast driverId (reference only; matching is by family name)
     name  display name              team  constructor
     rf    Race Factor (FIXED all season — DOB/Experience baked in here)
     starts current race starts (post-R7)
     w/p/pod career wins / poles / podiums (post-R7)
     h2h   head-to-head % (post-R7)   dnf   season DNF count (post-R7, main only)
     pts   current championship points (post-R7)
     rp    points scored in rounds 1..7 (for the 5-race momentum window)
   Sources: Notion 'Fone > Probability Analysis > Drivers' §3/§5/§10 and
            FONE/STATS/RACEBYRACE.xlsx (rounds 1-7 per-driver points).
   Round calendar (rp index): 1 Australia, 2 China(S), 3 Japan, 4 Miami(S),
            5 Canada(S), 6 Monaco, 7 Barcelona.  (S)=sprint weekend.
   ======================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IB_SEED = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DRIVERS = [
    // Mercedes
    { id: 'antonelli',     name: 'Kimi Antonelli',   team: 'Mercedes',     rf: 0.735, starts: 31,  w: 5,   p: 4,   pod: 9,   h2h: 28.00, dnf: 1, pts: 156, rp: [18, 29, 25, 28, 31, 25, 0] },
    { id: 'russell',       name: 'George Russell',   team: 'Mercedes',     rf: 0.936, starts: 159, w: 6,   p: 10,  pod: 27,  h2h: 67.21, dnf: 1, pts: 106, rp: [25, 26, 12, 17, 8, 0, 18] },
    // Ferrari
    { id: 'hamilton',      name: 'Lewis Hamilton',   team: 'Ferrari',      rf: 0.863, starts: 387, w: 106, p: 104, pod: 206, h2h: 58.44, dnf: 0, pts: 115, rp: [12, 21, 8, 10, 21, 18, 25] },
    { id: 'leclerc',       name: 'Charles Leclerc',  team: 'Ferrari',      rf: 0.940, starts: 178, w: 8,   p: 27,  pod: 52,  h2h: 65.44, dnf: 2, pts: 75,  rp: [15, 19, 15, 10, 16, 0, 0] },
    // McLaren
    { id: 'norris',        name: 'Lando Norris',     team: 'McLaren',      rf: 0.936, starts: 158, w: 11,  p: 16,  pod: 46,  h2h: 64.57, dnf: 3, pts: 73,  rp: [10, 5, 10, 26, 7, 0, 15] },
    { id: 'piastri',       name: 'Oscar Piastri',    team: 'McLaren',      rf: 0.916, starts: 75,  w: 9,   p: 6,   pod: 28,  h2h: 31.25, dnf: 2, pts: 68,  rp: [0, 3, 18, 22, 5, 10, 10] },
    // Red Bull
    { id: 'max_verstappen', name: 'Max Verstappen',  team: 'Red Bull',     rf: 0.955, starts: 240, w: 71,  p: 48,  pod: 128, h2h: 84.52, dnf: 2, pts: 55,  rp: [8, 0, 4, 14, 17, 0, 12] },
    { id: 'hadjar',        name: 'Isack Hadjar',     team: 'Red Bull',     rf: 0.833, starts: 30,  w: 0,   p: 0,   pod: 1,   h2h: 57.14, dnf: 2, pts: 34,  rp: [0, 4, 0, 0, 10, 12, 8] },
    // Alpine
    { id: 'gasly',         name: 'Pierre Gasly',     team: 'Alpine',       rf: 0.942, starts: 184, w: 1,   p: 0,   pod: 5,   h2h: 56.00, dnf: 1, pts: 41,  rp: [1, 8, 6, 1, 4, 15, 6] },
    { id: 'colapinto',     name: 'Franco Colapinto', team: 'Alpine',       rf: 0.880, starts: 33,  w: 0,   p: 0,   pod: 0,   h2h: 32.00, dnf: 0, pts: 16,  rp: [0, 1, 0, 6, 8, 0, 1] },
    // Racing Bulls
    { id: 'lawson',        name: 'Liam Lawson',      team: 'Racing Bulls', rf: 0.905, starts: 42,  w: 0,   p: 0,   pod: 0,   h2h: 43.33, dnf: 1, pts: 28,  rp: [0, 8, 2, 0, 6, 8, 4] },
    { id: 'lindblad',      name: 'Arvid Lindblad',   team: 'Racing Bulls', rf: 0.671, starts: 6,   w: 0,   p: 0,   pod: 0,   h2h: 20.00, dnf: 1, pts: 13,  rp: [4, 0, 0, 0, 1, 6, 2] },
    // Haas
    { id: 'bearman',       name: 'Oliver Bearman',   team: 'Haas',         rf: 0.806, starts: 34,  w: 0,   p: 0,   pod: 0,   h2h: 61.54, dnf: 3, pts: 18,  rp: [6, 11, 0, 0, 1, 0, 0] },
    { id: 'ocon',          name: 'Esteban Ocon',     team: 'Haas',         rf: 0.942, starts: 187, w: 1,   p: 0,   pod: 4,   h2h: 47.10, dnf: 0, pts: 3,   rp: [0, 0, 1, 0, 0, 2, 0] },
    // Williams
    { id: 'sainz',         name: 'Carlos Sainz',     team: 'Williams',     rf: 0.954, starts: 236, w: 4,   p: 6,   pod: 29,  h2h: 47.40, dnf: 1, pts: 6,   rp: [0, 2, 0, 2, 2, 0, 0] },
    { id: 'albon',         name: 'Alexander Albon',  team: 'Williams',     rf: 0.930, starts: 134, w: 0,   p: 0,   pod: 2,   h2h: 61.63, dnf: 3, pts: 5,   rp: [0, 0, 0, 1, 0, 4, 0] },
    // Audi
    { id: 'bortoleto',     name: 'Gabriel Bortoleto', team: 'Audi',        rf: 0.831, starts: 30,  w: 0,   p: 0,   pod: 0,   h2h: 44.44, dnf: 1, pts: 2,   rp: [2, 0, 0, 0, 0, 0, 0] },
    { id: 'hulkenberg',    name: 'Nico Hulkenberg',  team: 'Audi',         rf: 0.937, starts: 256, w: 0,   p: 1,   pod: 1,   h2h: 56.50, dnf: 3, pts: 0,   rp: [0, 0, 0, 0, 0, 0, 0] },
    // Aston Martin
    { id: 'alonso',        name: 'Fernando Alonso',  team: 'Aston Martin', rf: 0.650, starts: 432, w: 32,  p: 22,  pod: 106, h2h: 77.74, dnf: 4, pts: 1,   rp: [0, 0, 0, 0, 0, 1, 0] },
    { id: 'stroll',        name: 'Lance Stroll',     team: 'Aston Martin', rf: 0.944, starts: 196, w: 0,   p: 1,   pod: 3,   h2h: 34.31, dnf: 5, pts: 0,   rp: [0, 0, 0, 0, 0, 0, 0] },
    // Cadillac
    { id: 'bottas',        name: 'Valtteri Bottas',  team: 'Cadillac',     rf: 0.958, starts: 253, w: 10,  p: 20,  pod: 67,  h2h: 41.92, dnf: 3, pts: 0,   rp: [0, 0, 0, 0, 0, 0, 0] },
    { id: 'perez',         name: 'Sergio Perez',     team: 'Cadillac',     rf: 0.966, starts: 288, w: 6,   p: 3,   pod: 39,  h2h: 36.49, dnf: 1, pts: 0,   rp: [0, 0, 0, 0, 0, 0, 0] }
  ];

  // Sprint weekends already completed at the seed (rp indices 2,4,5 -> rounds 2,4,5).
  var STATE = { racesDone: 7, sprintsDone: 3, totalWeekends: 22, totalSprints: 6, seasonTotal: 2438, momWindow: 5 };

  // Locked constants — constant for the whole season (see logic.html).
  var LOCKED = {
    dqi: { h2h: 75, win: 8, pole: 4, pod: 6, racef: 7 },  // weight coefficients (fixed)
    mom: { wRec: 0.8, wSea: 0.2, beta: 1.0 },
    dnf: { df: 0.30, cap: 4 },
    cw:  { a: 6, c: 0.35 },
    perDriverCap: 399
  };

  return { DRIVERS: DRIVERS, STATE: STATE, LOCKED: LOCKED };
}));
