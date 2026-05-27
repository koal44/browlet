import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { JsdomMod } from './scenarios';

export type JsdomEngineName = 'nwsapi' | 'dom-selector' | 'selectlet';

const ENGINES_DIR = 'test/jsdom/engines';

function getJsdomEngineName(): JsdomEngineName {
  const raw = process.env.ENGINE;
  if (!raw) throw new Error(`No jsdom engine specified. Set the ENGINE environment variable to one of: 'nwsapi', 'dom-selector', 'selectlet'`);

  if (raw === 'nwsapi' || raw === 'dom-selector' || raw === 'selectlet') {
    return raw;
  }

  throw new Error(`Unknown jsdom engine '${raw}'`);
}

function requireForJsdomEngine(name = getJsdomEngineName()) {
  const pkg = `${process.cwd()}/${ENGINES_DIR}/${name}/package.json`;
  const modules = `${ENGINES_DIR}/${name}/node_modules`;

  if (!existsSync(pkg) || !existsSync(modules)) {
    throw new Error(
      `jsdom engine '${name}' is not installed. Run: npm run install:jsdom`,
    );
  }

  return createRequire(pkg);
}

export function getJsdomVariant() {
  const engine = getJsdomEngineName();
  const requireFromEngine = requireForJsdomEngine(engine);
  const { JSDOM } = requireFromEngine('jsdom') as typeof JsdomMod;

  return { engine, JSDOM };
}
