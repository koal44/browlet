import type * as DomletScenarios from './scenarios';

let domletScenarios: typeof DomletScenarios | undefined;

export function registerDomletScenarios(mod: typeof DomletScenarios): void {
  domletScenarios = mod;
}

export function getDomletScenarios(): typeof DomletScenarios {
  if (!domletScenarios) {
    throw new Error(
      'Domlet scenarios were not registered. Configure the Vitest Domlet project setupFiles to preload them.',
    );
  }

  return domletScenarios;
}
