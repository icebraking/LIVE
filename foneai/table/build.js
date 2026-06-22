/* build.js — generate a static Icebraking points table.
   Usage:  node build.js 2025
   Writes: ./<year>/data.json
   Node 18+ (global fetch). Run only on explicit instruction. */
const fs = require('fs');
const path = require('path');
const IB = require('./ib-points.js');

(async () => {
  const year = parseInt(process.argv[2] || '2025', 10);
  console.log('Building Icebraking points table for', year, '…');
  const t0 = Date.now();
  const data = await IB.buildSeason(year, { cache: null });
  const outDir = path.join(__dirname, String(year));
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'data.json');
  fs.writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log('Wrote', outFile);
  console.log('  rounds:', data.lastRound, '| last race:', data.lastRaceName);
  console.log('  drivers:', data.drivers.length, '| constructors:', data.constructors.length);
  console.log('  top 3 drivers:', data.drivers.slice(0, 3).map(d => d.name + ' ' + d.points).join(' | '));
  console.log('  top 3 ctors:', data.constructors.slice(0, 3).map(c => c.team + ' ' + c.points).join(' | '));
  console.log('Done in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
})().catch(e => { console.error('BUILD FAILED:', e); process.exit(1); });
