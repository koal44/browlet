import { standardDOM, type DOMOperations } from '../infra/index';
import { InternalPromise } from '../infra/promises';
import type { AsyncExecution, TaskScheduling } from '../infra/scheduling';
import type { DOMExceptionName } from '../web-idl/core/index';

/** Existing owner supplying Stylelet's execution and host DOM operations. */
export interface StyleletEnvironment {
  /** Promise allocation, background work, task delivery, and exception creation. */
  exec: StyleletExecution;
  /** Host owner sharing DOM access across its documents and engines. */
  userAgent: StyleletUserAgent;
}

/** DOM integration shared by this host's documents and engines. */
export interface StyleletUserAgent {
  /** Read and update host nodes through their supplied DOM operations. */
  dom: DOMOperations;
}

/** Shared Promise facilities plus delivery of stylesheet updates. */
export interface StyleletExecution extends AsyncExecution {
  /** Task destination for stylesheet replacement results. */
  style: TaskScheduling;
  /** Create an exception for delivery through the host's CSSOM binding. */
  // PROVISIONAL: Browlet supplies an exception request, not an owner-realm
  // allocation. Keep synchronous failures available for method-realm realization
  // until CSSOM projection is complete (browlet/style/ROADMAP.md).
  createDOMException(name: DOMExceptionName, message?: string): DOMException;
}

/** Host configuration for an existing environment or standalone execution. */
export type StyleletOptions = {
  /** Existing owner; takes precedence over the standalone dom and exec options. */
  env?: StyleletEnvironment;
  /** Access to existing host nodes; defaults to the standard DOM API. */
  dom?: DOMOperations;
  /** Standalone execution facilities; defaults to native promises, timers, and exceptions. */
  exec?: StyleletExecution;
};

/** Return the supplied environment or compose standalone DOM and execution facilities. */
export function createStyleletEnvironment(options: StyleletOptions = {}): StyleletEnvironment {
  if (options.env) return options.env;

  return {
    userAgent: { dom: options.dom ?? standardDOM },
    exec: options.exec ?? defaultStyleletExecution,
  };
}

/** Native scheduling for hosts without an existing execution integration. */
export const defaultStyleletExecution: StyleletExecution = {
  Promise: class StyleletPromise<T> extends InternalPromise<T> {
    protected override observeNative(fulfilled: (value: unknown) => void, rejected: (reason: unknown) => void): void {
      void this.backing.then(fulfilled, rejected).catch((error: unknown) => {
        setTimeout(() => { throw error; }, 0);
      });
    }
  },
  runInParallel: (steps) => { setTimeout(steps, 0); },
  style: {
    queueTask(steps) {
      const timer = setTimeout(steps, 0);
      return { remove: () => { clearTimeout(timer); } };
    },
  },
  createDOMException: (name, message = '') => new DOMException(message, name),
};

export const defaultStyleletEnvironment = createStyleletEnvironment();
