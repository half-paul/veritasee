import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');

const defaultEnvFiles = [
  resolve(repoRoot, '.env'),
  resolve(repoRoot, '.env.local'),
  resolve(repoRoot, 'apps/web/.env'),
  resolve(repoRoot, 'apps/web/.env.local'),
];

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadEnv(files = defaultEnvFiles): void {
  const originalEnvKeys = new Set(Object.keys(process.env));

  for (const file of files) {
    if (!existsSync(file)) continue;

    const content = readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
      if (!match) continue;

      const [, key, rawValue = ''] = match;
      if (!key || originalEnvKeys.has(key)) continue;

      process.env[key] = unquote(rawValue);
    }
  }
}
