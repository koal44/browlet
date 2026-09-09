import { streamAbortController } from '../../streams/integration';
import { streamStructuredData } from '../../streams/structured-data';
import type { CapabilityRegistration } from '../../web-idl/capability';
import { WindowImpl, windowIDL } from '../browsing/window/window';
import { AbortControllerImpl } from '../dom/abort/abort-controller';

/* DOM- and HTML-owned capabilities consumed by Streams algorithms. */
export const streamsCapabilities = [
  streamAbortController.for(windowIDL, {
    create(context) {
      return context.construct(AbortControllerImpl);
    },
  }),
  streamStructuredData.for(windowIDL, {
    clone(global, value) {
      if (!WindowImpl.is(global)) {
        throw new TypeError('Streams structured data requires a Window global');
      }
      return WindowImpl.getWindowOrWorkerGlobalScopeMixin(global)
        .structuredClone(value);
    },
  }),
] satisfies CapabilityRegistration[];
