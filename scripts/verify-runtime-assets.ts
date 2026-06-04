import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_FILES = [
  'public/audit/index.html',
  'public/audit/styles.css',
  'public/audit/app.js',
];

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const root = process.cwd();
const missing = REQUIRED_FILES.filter((relative) => !existsSync(join(root, relative)));

if (missing.length) {
  fail(`Runtime audit assets missing:\n${missing.map((f) => `  - ${f}`).join('\n')}`);
}

for (const relative of REQUIRED_FILES) {
  ok(`${relative} present`);
}

console.log('Runtime audit assets OK.');
