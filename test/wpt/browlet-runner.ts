import { readFileSync } from 'node:fs';
import { Browlet, type BrowletRoute } from '../../src/browlet/browlet';
import {
  reporterSource, resolveWptPath, withWptTimeout, wptOrigin,
  type WptReport,
} from './harness';

export async function runTest(testPath: string): Promise<WptReport> {
  const anyTest = testPath.endsWith('.any.js')
    ? createWindowAnyTest(testPath)
    : undefined;
  const browlet = new Browlet({ route: createWptRoute(anyTest) });
  const testUrl = new URL(
    anyTest?.documentPath ?? testPath,
    wptOrigin,
  );

  const { promise: report, resolve: complete } =
    Promise.withResolvers<WptReport>();

  browlet.expose('__wptComplete', complete);

  await browlet.navigate(testUrl);

  return await withWptTimeout(report, testPath);
}

function createWptRoute(anyTest?: WindowAnyTest): BrowletRoute {
  return (resource: string) => {
    const url = new URL(resource);

    if (url.origin !== wptOrigin.origin) {
      throw new Error(`WPT resource is not local: ${url.href}`);
    }

    if (url.pathname === '/resources/testharnessreport.js') {
      return reporterSource;
    }

    if (url.pathname === anyTest?.documentPath) return anyTest.document;

    return readFileSync(resolveWptPath(url.pathname), 'utf8');
  };
}

export function createWindowAnyTest(testPath: string): WindowAnyTest {
  const source = readFileSync(resolveWptPath(testPath), 'utf8');
  const metadata = parseAnyTestMetadata(source);
  const globals = metadata.get('global')
    ?.flatMap((value) => value.split(','))
    .map((value) => value.trim());
  if (globals && !globals.includes('window')) {
    throw new Error(`${testPath} does not define a Window test variant`);
  }
  if (metadata.has('variant')) {
    throw new Error(`${testPath} requires unsupported WPT variants`);
  }

  const sourcePath = normalizeWptUrlPath(testPath);
  const documentPath = sourcePath.replace(/\.any\.js$/u, '.any.html');
  const title = metadata.get('title')?.at(-1) ?? testPath;
  const scripts = [
    '/resources/testharness.js',
    '/resources/testharnessreport.js',
    ...(metadata.get('script') ?? []),
    sourcePath,
  ];
  const document = [
    '<!doctype html>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    '<body>',
    ...scripts.map((script) =>
      `<script src="${escapeHtml(script)}"></script>`),
  ].join('\n');

  return { document, documentPath };
}

function parseAnyTestMetadata(source: string): Map<string, string[]> {
  const metadata = new Map<string, string[]>();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^\/\/ META: ([^=]+)=(.*)$/u.exec(line);
    if (!match) continue;
    const [, rawName, rawValue] = match;
    const name = rawName?.trim();
    if (!name || rawValue === undefined) continue;
    const values = metadata.get(name) ?? [];
    values.push(rawValue.trim());
    metadata.set(name, values);
  }
  return metadata;
}

function normalizeWptUrlPath(path: string): string {
  return `/${path.replaceAll('\\', '/').replace(/^\/+|^\.\//u, '')}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export type WindowAnyTest = {
  readonly document: string;
  readonly documentPath: string;
};
