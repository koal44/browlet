import { standardDOM, type DOMDocument, type DOMOperations } from '../infra/index';
import { createAsyncExecution, nativeTimerHost, type AsyncExecution } from '../infra/execution';
import { decodeNative, type DecodeText } from '../encoding/core/index';

import type { SystemColorPalette } from './engine/index';

/** Existing owner supplying Stylelet's execution, DOM access, URLs, and text decoding. */
export interface StyleletEnvironment {
  /** Promise allocation, background work, and task delivery. */
  exec: StyleletExecution;
  /** Host facilities shared across this owner's documents and engines. */
  userAgent: StyleletUserAgent;
  /** The owning global's Document; unbound and non-Window environments have none. */
  getAssociatedDocument(): DOMDocument | null;
}

/** DOM, URL, and text decoding shared by this host's documents and engines. */
export interface StyleletUserAgent {
  /** Read and update host nodes through their supplied DOM operations. */
  dom: DOMOperations;
  /** Parse and serialize URLs using this host's selected implementation. */
  URL: StyleletURLConstructor;
  /** Decode complete input through the host's selected Encoding implementation. */
  decodeText: DecodeText;
  /** Complete host-selected palette; omitted uses the engine's independent light palette. */
  systemColors?: SystemColorPalette;
}

/** Serialized view of a parsed URL retained by Stylelet. */
export interface StyleletURL {
  href: string;
}

/** URL construction required by stylesheets and computed CSS resource values. */
export interface StyleletURLConstructor {
  /** Resolve input against the optional base; throw when parsing fails. */
  new (input: string, base?: string): StyleletURL;
}

/** Shared scheduling for stylesheet updates; Binding projects implementation exceptions. */
export type StyleletExecution = AsyncExecution;

/** Host configuration for an existing environment or standalone execution. */
export type StyleletOptions = {
  /** Existing owner; takes precedence over the standalone host options. */
  env?: StyleletEnvironment;
  /** Access to existing host nodes; defaults to the standard DOM API. */
  dom?: DOMOperations;
  /** Standalone URL implementation; defaults to the captured native constructor. */
  URL?: StyleletURLConstructor;
  /** Complete-input byte decoding; defaults to the native decoder adapter. */
  decodeText?: DecodeText;
  /** System colors shared with this host; use createSystemColorPalette() for editable defaults. */
  systemColors?: SystemColorPalette;
  /** Standalone execution facilities; defaults to native promises and timers. */
  exec?: StyleletExecution;
};

/** Return the supplied environment or compose standalone host facilities. */
export function createStyleletEnvironment(options: StyleletOptions = {}): StyleletEnvironment {
  if (options.env) return options.env;

  return {
    userAgent: {
      dom: options.dom ?? standardDOM,
      URL: options.URL ?? nativeURL,
      decodeText: options.decodeText ?? decodeNative,
      systemColors: options.systemColors,
    },
    exec: options.exec ?? defaultStyleletExecution,
    getAssociatedDocument: () => null,
  };
}

// Capture standalone host facilities using only the surfaces Stylelet needs.
const nativeHost = globalThis as typeof globalThis & { URL: StyleletURLConstructor; };
const nativeURL = nativeHost.URL;

/** Shared native scheduling for standalone Stylelet. */
export const defaultStyleletExecution: StyleletExecution = createAsyncExecution(nativeTimerHost);

export const defaultStyleletEnvironment = createStyleletEnvironment();
