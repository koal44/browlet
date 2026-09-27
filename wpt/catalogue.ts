import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Read the pinned catalogue without contacting the network. */
export function readCatalogue(revision: string): WptCatalogue {
  const file = manifestPath(revision);
  if (!existsSync(file)) {
    throw new Error('WPT manifest is missing; run npm run install:wpt.');
  }
  return parseCatalogue(JSON.parse(readFileSync(file, 'utf8')) as WptManifest);
}

/** Download once per revision, verifying the revision supplied by wpt.fyi. */
export async function installCatalogue(revision: string): Promise<WptCatalogue> {
  const file = manifestPath(revision);
  if (existsSync(file)) return readCatalogue(revision);

  const response = await fetch(`https://wpt.fyi/api/manifest?sha=${revision}`);
  if (!response.ok || response.headers.get('X-WPT-SHA') !== revision) {
    throw new Error(`Could not obtain the WPT manifest for ${revision}: HTTP ${response.status}`);
  }
  const source = await response.text();
  const catalogue = parseCatalogue(JSON.parse(source) as WptManifest);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
  return catalogue;
}

/** Enumerate upstream test URLs; support files never become runnable tests. */
export function parseCatalogue(manifest: WptManifest): WptCatalogue {
  if (manifest.version !== 9 || manifest.url_base !== '/') {
    throw new Error(`Unsupported WPT manifest: version ${manifest.version}, base ${manifest.url_base}`);
  }

  const catalogue: WptCatalogue = { tests: [], sources: [], counts: {} };
  for (const [type, directory] of Object.entries(manifest.items)) {
    catalogue.counts[type] = 0;
    visit(directory, '', (source, variants) => {
      catalogue.sources.push(source);
      catalogue.counts[type]! += variants.length;
      if (type !== 'testharness') return;
      for (const [url, metadata] of variants) {
        catalogue.tests.push({
          source,
          url: `/${url ?? source}`,
          timeout: metadata.timeout === 'long' ? 185_000 : 65_000,
          scripts: (metadata.script_metadata ?? [])
            .filter(([key]) => key === 'script')
            .map(([, value]) => value),
        });
      }
    });
  }
  return catalogue;
}

export type WptCatalogue = {
  tests: WptTest[];
  sources: string[];
  counts: Record<string, number>;
};

export type WptTest = {
  source: string;
  url: string;
  timeout: number;
  scripts: string[];
};

// WPT's manifest, rather than filename guessing, owns generated test variants.
// https://web-platform-tests.org/running-tests/custom-runner.html
export type WptManifest = {
  version: number;
  url_base: string;
  items: Record<string, ManifestDirectory>;
};

type ManifestDirectory = {
  [name: string]: ManifestDirectory | [string, ...ManifestTest[]];
};

type ManifestTest = [string | null, {
  timeout?: string;
  script_metadata?: [string, string][];
}];

function visit(
  directory: ManifestDirectory,
  prefix: string,
  leaf: (source: string, variants: ManifestTest[]) => void,
): void {
  for (const [name, item] of Object.entries(directory)) {
    const source = prefix + name;
    if (Array.isArray(item)) {
      const [, ...variants] = item;
      leaf(source, variants);
    } else {
      visit(item, `${source}/`, leaf);
    }
  }
}

function manifestPath(revision: string): string {
  if (!/^[a-f0-9]{40}$/u.test(revision)) {
    throw new Error(`WPT revision must be a full commit hash: ${revision}`);
  }
  return resolve('wpt/.cache', `${revision}.json`);
}
