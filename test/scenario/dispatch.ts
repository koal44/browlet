import { getBrowletScenarios } from './browlet/registry';
import type { RunScenarios } from './harness';
import { runScenarios as runPlaywrightScenarios } from './playwright/runner';

type Harness = 'playwright' | 'browlet';

function getHarness(): Harness {
  const raw = process.env.HARNESS ?? 'playwright';

  if (raw === 'playwright' || raw === 'browlet') return raw;

  throw new Error(
    `Unknown HARNESS '${raw}'. Expected 'playwright' or 'browlet'.`,
  );
}

export const runScenarios: RunScenarios = (...args) => {
  const harness = getHarness();

  if (harness === 'browlet') {
    return getBrowletScenarios().runScenarios(...args);
  }

  return runPlaywrightScenarios(...args);
};
