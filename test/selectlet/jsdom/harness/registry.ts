import type * as JsdomScenarios from './scenarios';

let jsdomScenarios: typeof JsdomScenarios | undefined;

export function registerJsdomScenarios(mod: typeof JsdomScenarios): void {
  jsdomScenarios = mod;
}

export function getJsdomScenarios(): typeof JsdomScenarios {
  if (!jsdomScenarios) {
    throw new Error('jsdom scenarios were not registered. Configure the Vitest jsdom project setupFiles to preload them.');
  }

  return jsdomScenarios;
}
