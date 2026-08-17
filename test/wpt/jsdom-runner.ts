import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  JSDOM, requestInterceptor, VirtualConsole, type DOMWindow,
} from 'jsdom';
import { Stylelet } from '../../src/stylelet/stylelet';
import {
  reporterSource, resolveWptPath, withWptTimeout, wptOrigin,
  type WptReport,
} from './harness';

export async function runTest(testPath: string): Promise<WptReport> {
  const source = await readFile(resolveWptPath(testPath), 'utf8');
  const errors: string[] = [];
  const virtualConsole = new VirtualConsole().forwardTo(console, {
    jsdomErrors: 'none',
  });

  virtualConsole.on('jsdomError', (error) => {
    errors.push(error.stack ?? error.message);
  });

  const { promise: completion, resolve: complete } =
    Promise.withResolvers<WptReport>();

  const dom = new JSDOM(source, {
    url: new URL(testPath, wptOrigin).href,
    includeNodeLocations: true,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
    resources: {
      interceptors: [createResourceInterceptor()],
    },
    beforeParse(window) {
      const wptWindow = window as WptWindow;

      wptWindow.__wptComplete = complete;
      installStylelet(wptWindow);
    },
  });

  try {
    const report = await withWptTimeout(completion, testPath);

    if (errors.length !== 0) {
      throw new Error(formatErrors(testPath, errors));
    }

    return report;
  } finally {
    dom.window.close();
  }
}

function installStylelet(window: WptWindow): void {
  const stylelet = new Stylelet(window.document);

  window.getComputedStyle = () => {
    throw new Error(
      `Stylelet getComputedStyle is not implemented (${stylelet.version})`,
    );
  };
}

function createResourceInterceptor() {
  return requestInterceptor(async (request) => {
    const url = new URL(request.url);

    if (url.pathname === '/resources/testharnessreport.js') {
      return javascriptResponse(reporterSource);
    }

    if (url.origin !== wptOrigin.origin) {
      return new Response('External WPT resources are not supported', {
        status: 501,
      });
    }

    const path = resolveWptPath(url.pathname);
    if (!existsSync(path)) {
      return new Response(`Missing WPT resource: ${url.pathname}`, {
        status: 404,
      });
    }

    return new Response(await readFile(path), {
      headers: {
        'Content-Type': contentType(path),
      },
    });
  });
}

function javascriptResponse(source: string): Response {
  return new Response(source, {
    headers: {
      'Content-Type': 'text/javascript',
    },
  });
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.css': return 'text/css';
    case '.html': return 'text/html';
    case '.js': return 'text/javascript';
    case '.json': return 'application/json';
    case '.svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

function formatErrors(testPath: string, errors: string[]): string {
  return `${testPath} failed with ${errors.length} error(s):\n\n${errors.join('\n\n')}`;
}

type WptWindow = DOMWindow & {
  __wptComplete(report: WptReport): void;
};
