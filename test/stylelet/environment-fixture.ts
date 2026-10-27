import { standardDOM, type DOMOperations } from '../../src/infra/index';
import { nativeTimerHost, type TimerHost } from '../../src/infra/tasks';
import type { StyleletEnvironment, SystemColorPalette } from '../../src/stylelet/index';
import { createClientEnvironment } from '../fetch/client-fixture';
import { createTestScheduling } from '../support/scheduling';

/** A test host with a real realm and controlled Fetch/DOM capabilities. */
export function createStyleletTestEnvironment(options: {
  dom?: DOMOperations;
  timerHost?: TimerHost;
  systemColors?: SystemColorPalette;
} = {}): StyleletEnvironment {
  const env = createClientEnvironment();
  return {
    ...env,
    userAgent: {
      ...env.userAgent,
      blobURLStore: { resolve: () => null },
      dom: {
        ...standardDOM,
        ...options.dom,
      },
      systemColors: options.systemColors,
    },
    // Direct implementation tests retain internal results; Browlet tests cover CSSOM projection.
    ...createTestScheduling(options.timerHost ?? nativeTimerHost),
    getAssociatedDocument: () => null,
  };
}

/** Shared host for tests that only parse or resolve values. */
export const styleletEnv = createStyleletTestEnvironment();
