import type * as BrowletScenarios from './runner';

let browletScenarios: typeof BrowletScenarios | undefined;

export function registerBrowletScenarios(mod: typeof BrowletScenarios): void {
  browletScenarios = mod;
}

export function getBrowletScenarios(): typeof BrowletScenarios {
  if (!browletScenarios) {
    throw new Error(
      'Browlet scenarios were not registered. Configure the Vitest Browlet project setupFiles to preload them.',
    );
  }

  return browletScenarios;
}
