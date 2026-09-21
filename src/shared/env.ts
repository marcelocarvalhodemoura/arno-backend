import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function envCandidates(): string[] {
  const cwd = process.cwd();
  return [
    resolve(cwd, '.env'),
    resolve(cwd, '../.env'),
    resolve(cwd, '../application/.env'),
    resolve(cwd, '../../application/.env'),
  ];
}

export function loadEnvFiles() {
  for (const file of envCandidates()) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadEnvFiles();
