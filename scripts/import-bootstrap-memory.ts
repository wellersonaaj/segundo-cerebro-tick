/**
 * Importação do panorama inicial via POST /inbox-items.
 * Uso manual — nunca chamar em npm test.
 *
 *   ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/memoria-inicial.md
 *   ALLOW_BOOTSTRAP_IMPORT=true npm run import:bootstrap -- data/bootstrap/memoria-inicial.md --dry-run
 */

import { pathToFileURL } from 'node:url';
import { loadDotEnv } from '../src/config/load-dotenv.js';
import {
  BOOTSTRAP_USAGE,
  parseBootstrapArgs,
  runBootstrapImport,
} from './lib/bootstrap-import.js';

loadDotEnv();

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseBootstrapArgs(process.argv.slice(2));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  await runBootstrapImport({
    filePath: parsed.filePath,
    dryRun: parsed.dryRun,
    failFn: fail,
  });
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMain) {
  main().catch((err) => {
    fail(err instanceof Error ? err.message : String(err));
  });
}

export { BOOTSTRAP_USAGE, parseBootstrapArgs, runBootstrapImport };
