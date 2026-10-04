import { standardDOM, type DOMOperations } from '../infra/index';
import { createAsyncExecution, nativeTimerHost, type AsyncExecution } from '../infra/execution';
import type { DOMExceptionConstructor, WebIDLExecution } from '../web-idl/core/index';
import { decodeNative, type EncodingCapability } from '../encoding/core/index';

/** Existing owner supplying Stylelet's execution, DOM access, URLs, and text decoding. */
export interface StyleletEnvironment {
  /** Promise allocation, background work, task delivery, and exception creation. */
  exec: StyleletExecution;
  /** Host facilities shared across this owner's documents and engines. */
  userAgent: StyleletUserAgent;
}

/** DOM, URL, and text decoding shared by this host's documents and engines. */
export interface StyleletUserAgent extends EncodingCapability {
  /** Read and update host nodes through their supplied DOM operations. */
  dom: DOMOperations;
  /** Parse and serialize URLs using this host's selected implementation. */
  URL: StyleletURLConstructor;
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

/** Shared scheduling and host exception construction for stylesheet updates. */
// PROVISIONAL: Browlet's direct CSSOM APIs use the owning environment's
// platform exceptions. Revisit method-realm allocation when CSSOM gains
// member bindings (browlet/style/ROADMAP.md).
export interface StyleletExecution extends AsyncExecution, WebIDLExecution {}

/** Host configuration for an existing environment or standalone execution. */
export type StyleletOptions = {
  /** Existing owner; takes precedence over the standalone host options. */
  env?: StyleletEnvironment;
  /** Access to existing host nodes; defaults to the standard DOM API. */
  dom?: DOMOperations;
  /** Standalone URL implementation; defaults to the captured native constructor. */
  URL?: StyleletURLConstructor;
  /** Complete-input byte decoding; defaults to the native decoder adapter. */
  decodeText?: EncodingCapability['decodeText'];
  /** Standalone execution facilities; defaults to native promises, timers, and exceptions. */
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
    },
    exec: options.exec ?? defaultStyleletExecution,
  };
}

// Capture standalone host facilities using only the surfaces Stylelet needs.
const nativeHost = globalThis as typeof globalThis & NativeStyleletHost;
const nativeURL = nativeHost.URL;

/** Shared native scheduling and host exceptions for standalone Stylelet. */
export const defaultStyleletExecution: StyleletExecution = {
  ...createAsyncExecution(nativeTimerHost),
  DOMException: nativeHost.DOMException,
};

export const defaultStyleletEnvironment = createStyleletEnvironment();

type NativeStyleletHost = {
  URL: StyleletURLConstructor;
  DOMException: DOMExceptionConstructor;
};
