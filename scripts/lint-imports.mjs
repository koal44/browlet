import { relative } from 'node:path';
import { ESLint } from 'eslint';

// Use the ordinary configuration, but report only the two hierarchy rules.
// --fix changes import layout; dependency findings never have automatic fixes.
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--fix')) throw new Error('Usage: node scripts/lint-imports.mjs [--fix]');
const eslint = new ESLint({
  fix: args.includes('--fix') ? (message) => message.ruleId === 'browlet/import-order' : false,
});
const results = await eslint.lintFiles(['src']);
if (args.includes('--fix')) await ESLint.outputFixes(results);

const groups = new Map();
let runtime = 0;
let layout = 0;
let other = 0;
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId === 'browlet/dependency-direction') {
      if (message.message.startsWith('Runtime')) runtime++;
      else other++;
    } else if (message.ruleId === 'browlet/import-order') {
      layout++;
    } else if (message.fatal) {
      other++;
    } else continue;
    const entries = groups.get(message.message) ?? [];
    entries.push(`${relative(process.cwd(), result.filePath)}:${message.line}:${message.column}`);
    groups.set(message.message, entries);
  }
}

// Group repeated findings so a pair of components is visible before its callers.
const priority = (message) => message.startsWith('Runtime') ? 0 : 1;
for (const [message, entries] of [...groups].sort(([a], [b]) => priority(a) - priority(b))) {
  console.log(`\n${message}`);
  for (const entry of entries) console.log(`  ${entry}`);
}
console.log(`\nImports: ${runtime} runtime, ${layout} ordering, ${other} unclassified findings.`);
process.exitCode = runtime + layout + other > 0 ? 1 : 0;
