import { readFileSync } from 'node:fs';
import { Browlet, type BrowletRoute } from '../../src/browlet/browlet';
import {
  reporterSource, resolveWptPath, withWptTimeout, wptOrigin,
  type WptReport,
} from './harness';

export async function runTest(testPath: string): Promise<WptReport> {
  const browlet = new Browlet({ route: createWptRoute() });
  const testUrl = new URL(testPath, wptOrigin); // http://web-platform.test/css/css-cascade/example.html

  const { promise: report, resolve: complete } =
    Promise.withResolvers<WptReport>();

  browlet.expose('__wptComplete', complete);

  await browlet.navigate(testUrl);

  return await withWptTimeout(report, testPath);
}

function createWptRoute(): BrowletRoute {
  return (resource: string) => {
    const url = new URL(resource);

    if (url.origin !== wptOrigin.origin) {
      throw new Error(`WPT resource is not local: ${url.href}`);
    }

    if (url.pathname === '/resources/testharnessreport.js') {
      return reporterSource;
    }

    return readFileSync(resolveWptPath(url.pathname), 'utf8');
  };
}
