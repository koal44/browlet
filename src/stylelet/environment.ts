import type { DOMDocument, DOMOperations } from '../infra/index';
import type { URLUserAgent } from '../url/index';
import type { FetchEnvironment, FetchExecution, FetchUserAgent } from '../fetch/index';

import type { SystemColorPalette } from './engine/index';

/** Existing owner supplying Stylelet's execution and host state. */
export interface StyleletEnvironment extends FetchEnvironment {
  /** Host facilities shared across this owner's documents and engines. */
  userAgent: StyleletUserAgent;
  /** The owning global's Document; unbound and non-Window environments have none. */
  getAssociatedDocument(): DOMDocument | null;
}

/** DOM, Blob URL registrations, and system colors shared by this host's documents and engines. */
export interface StyleletUserAgent extends FetchUserAgent, URLUserAgent {
  /** Read and update host nodes through their supplied DOM operations. */
  dom: DOMOperations;
  /** Complete host-selected palette; omitted uses the engine's independent light palette. */
  systemColors?: SystemColorPalette;
}

/** The owning host's execution facilities, shared with Fetch. */
export type StyleletExecution = FetchExecution;

/** The host supplying this document's execution, DOM access, and resource loading. */
export type StyleletOptions = {
  env: StyleletEnvironment;
};
