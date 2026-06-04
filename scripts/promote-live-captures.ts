#!/usr/bin/env tsx
/**
 * Promove capturas live revisadas para o dataset versionado.
 *
 *   npm run promote:live-captures -- cap-alias-shell-style-r1-abc123.json
 *   npm run promote:live-captures -- --all-reviewed
 *
 * Copia de artifacts/calibration/live-captures/ → data/calibration/compiler-v1/captured/
 * Requer revisão manual explícita (arquivo listado ou flag --all-reviewed).
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'artifacts/calibration/live-captures');
const targetDir = join(root, 'data/calibration/compiler-v1/captured');

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Uso: npm run promote:live-captures -- <arquivo.json> [arquivo2.json ...]');
    console.error('  ou: npm run promote:live-captures -- --all-reviewed');
    process.exit(1);
  }

  if (!existsSync(sourceDir)) {
    console.error(`Diretório de capturas não encontrado: ${sourceDir}`);
    process.exit(1);
  }

  mkdirSync(targetDir, { recursive: true });

  let files: string[];
  if (args[0] === '--all-reviewed') {
    files = readdirSync(sourceDir).filter((f) => f.endsWith('.json'));
    console.warn('⚠️  Promovendo TODAS as capturas — confirme revisão manual prévia.');
  } else {
    files = args.filter((f) => f.endsWith('.json'));
  }

  if (files.length === 0) {
    console.error('Nenhum arquivo .json especificado.');
    process.exit(1);
  }

  for (const file of files) {
    const src = join(sourceDir, file);
    if (!existsSync(src)) {
      console.error(`Não encontrado: ${src}`);
      process.exit(1);
    }
    const dest = join(targetDir, file);
    copyFileSync(src, dest);
    console.log(`✓ ${file} → data/calibration/compiler-v1/captured/`);
  }

  console.log(`\nPromovidos ${files.length} arquivo(s). Commit manual após revisão.`);
}

main();
