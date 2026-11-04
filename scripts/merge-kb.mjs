// Merge src/kb/categories/*.json into src/kb/merchants.json (sorted by category, then name).
// Runs the same validation as validate-kb first; nothing is written when there are errors.
//
// Usage: node scripts/merge-kb.mjs

import fs from 'node:fs';
import { categoryFiles, loadKbFile, validateKb, printReport, relLabel, MERGED_FILE } from './kb-rules.mjs';

const targets = categoryFiles().map(loadKbFile);
const result = validateKb({ targets });
const errorCount = printReport(result);

if (errorCount > 0) {
  console.error(`merge-kb: ${errorCount} error${errorCount === 1 ? '' : 's'}; ${relLabel(MERGED_FILE)} not written.`);
  process.exit(1);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const merged = targets
  .flatMap((t) => t.merchants)
  .sort(
    (a, b) =>
      cmp(a.category, b.category) ||
      cmp(a.name.toLowerCase(), b.name.toLowerCase()) ||
      cmp(a.id, b.id),
  );

fs.writeFileSync(MERGED_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf8');

const perCategory = {};
for (const m of merged) perCategory[m.category] = (perCategory[m.category] ?? 0) + 1;
console.log(`Wrote ${relLabel(MERGED_FILE)}: ${merged.length} merchants from ${targets.length} category file${targets.length === 1 ? '' : 's'}, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`);
for (const [cat, n] of Object.entries(perCategory)) console.log(`  ${cat}: ${n}`);
