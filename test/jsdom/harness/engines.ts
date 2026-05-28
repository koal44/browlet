import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { JsdomMod } from './scenarios';

export type JsdomEngineName = 'nwsapi' | 'dom-selector' | 'selectlet' | 'sx-vendor';

const ENGINES_DIR = 'test/jsdom/engines';

export function getJsdomVariant() {
  const engine = getJsdomEngineName();
  const requireFromEngine = requireForJsdomEngine(engine);

  const { JSDOM } = (
    engine === 'sx-vendor'
      ? requireFromEngine('./lib/api.js')
      : requireFromEngine('jsdom')
  ) as typeof JsdomMod;

  return { engine, JSDOM };
}

function getJsdomEngineName(): JsdomEngineName {
  const raw = process.env.ENGINE;
  if (!raw) {
    throw new Error(
      `No jsdom engine specified. Set ENGINE to one of: 'nwsapi', 'dom-selector', 'selectlet', 'jsdom-selectlet'`,
    );
  }

  if (
    raw === 'nwsapi' ||
    raw === 'dom-selector' ||
    raw === 'selectlet' ||
    raw === 'sx-vendor'
  ) {
    return raw;
  }

  throw new Error(`Unknown jsdom engine '${raw}'`);
}

function requireForJsdomEngine(name: string) {
  if (name === 'sx-vendor') {
    const pkg = `${process.cwd()}/vendor/jsdom/package.json`;
    const modules = `vendor/jsdom/node_modules`;

    if (!existsSync(pkg) || !existsSync(modules)) {
      throw new Error(
        `jsdom engine '${name}' is not installed. Run: npm run vendor`,
      );
    }

    return createRequire(pkg);
  }

  const pkg = `${process.cwd()}/${ENGINES_DIR}/${name}/package.json`;
  const modules = `${ENGINES_DIR}/${name}/node_modules`;

  if (!existsSync(pkg) || !existsSync(modules)) {
    throw new Error(
      `jsdom engine '${name}' is not installed. Run: npm run install:jsdom`,
    );
  }

  return createRequire(pkg);
}
