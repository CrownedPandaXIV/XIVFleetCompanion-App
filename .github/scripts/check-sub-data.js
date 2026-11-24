// Whether a freshly made Sub Calculator data file (refresh-sub-data.js) is fit to publish for the app and plugin to
// download, and whether it differs from the copy published now (when and where it was made aside).
//
//   node .github/scripts/check-sub-data.js new.json [published.json]
//
// Fit: it passes the file's own checks (subs/calculator-data.js problems), it still has every sector the shipped copy
// has, and the Sub Calculator's sums come out as numbers on every sector at low, middling and high stats. Writes
// "publish=true" or "publish=false" to $GITHUB_OUTPUT (and says why); exits 1 when it isn't fit.
const fs = require('fs');
const { FILE, problems } = require('../../subs/calculator-data');
const calc = require('../../subs/calculator');

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// What can't be used, as plain sentences.
function unfit(data, shipped) {
  const out = problems(data);
  if (out.length) return out;
  const ids = new Set(data.sectors.map((s) => s.id));
  const lost = shipped.sectors.filter((s) => !ids.has(s.id));
  if (lost.length) out.push(`It has lost sectors the shipped data has: ${lost.map((s) => s.name).join(', ')}.`);
  for (const s of data.sectors) {
    for (const level of [0, 60, 120, 200, 400]) {
      const stats = { surveillance: level, retrieval: level, favor: level, speed: level, range: level };
      const result = calc.sectorResult(s, stats);
      const loot = calc.sectorLoot(s, result);
      const bonus = calc.bonusExp(result);
      const numbers = [...loot.flatMap((l) => [l.perVoyage, l.chance, l.low, l.high]), bonus.sure, bonus.best];
      if (!numbers.every(Number.isFinite)) { out.push(`${s.name}: the loot sums aren't numbers at stats of ${level}.`); break; }
    }
  }
  return out;
}

// The data without when it was made and when Pepper's sheet was read, which change on every run.
function content(data) {
  const about = { ...data.about, made: null, pepper: data.about.pepper ? { ...data.about.pepper, fetched: null } : null };
  return JSON.stringify({ ...data, about });
}

function main([newFile, publishedFile]) {
  const output = (publish) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${publish}\n`); };
  const data = read(newFile);
  const wrong = unfit(data, read(FILE));
  if (wrong.length) {
    console.log(`::error title=Sub Calculator data::The new data isn't fit to publish: ${wrong.slice(0, 5).join(' ')}`);
    output(false);
    return 1;
  }
  let published = null;
  try { published = publishedFile ? read(publishedFile) : null; } catch { /* none published yet */ }
  const changed = !published || content(published) !== content(data);
  console.log(changed
    ? `Sub Calculator data: ${published ? 'newer than the published copy' : 'none published yet'}; publishing (${data.sectors.length} sectors, XIVStats updated ${data.about.xivstats.updated}).`
    : 'Sub Calculator data: the same as the published copy; nothing to publish.');
  output(changed);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { unfit, content };
