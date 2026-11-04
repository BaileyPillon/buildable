// Validate the Buildable knowledge base: schema, policy and pattern collisions.
//
// Usage: node scripts/validate-kb.mjs [--isolated] [file...]
//   no files   all src/kb/categories/*.json, else src/kb/merchants.json
//   file...    validate just those files; the other category files are still loaded so ids and
//              patterns are checked against them (pass --isolated to skip that)
// Exit code 1 when there are errors; warnings never fail the run.

import { resolveInputs, validateKb, printReport } from './kb-rules.mjs';

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log('Usage: node scripts/validate-kb.mjs [--isolated] [file...]');
  process.exit(0);
}
const isolated = argv.includes('--isolated');
const args = argv.filter((a) => !a.startsWith('--'));

const { targets, context } = resolveInputs({ args, isolated });
const result = validateKb({ targets, context });

if (result.merchantCount === 0 && result.errors.length === 0) {
  console.log('No merchants found: nothing to validate.');
  process.exit(0);
}

const errorCount = printReport(result);
const files = `${result.fileCount} file${result.fileCount === 1 ? '' : 's'}`;
const ctx = context.length ? ` (cross-checked against ${context.length} other category file${context.length === 1 ? '' : 's'})` : '';
console.log(
  `${result.merchantCount} merchants in ${files}${ctx}: ${errorCount} error${errorCount === 1 ? '' : 's'}, ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}`,
);
process.exit(errorCount > 0 ? 1 : 0);
