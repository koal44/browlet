import { standardDOM, type DOMOperations } from '../infra/index';
import type { SelectletOptions } from './selectlet';

/** Existing owner supplying the host DOM used by selector queries. */
export interface SelectletEnvironment<N extends object = object, E extends N = N, A extends object = object> {
  /** Host owner sharing DOM access across documents and engines. */
  userAgent: SelectletUserAgent<N, E, A>;
}

/** DOM integration shared by this host's selector engines. */
export interface SelectletUserAgent<N extends object = object, E extends N = N, A extends object = object> {
  /** Read host nodes and their live state through the supplied operations. */
  dom: DOMOperations<N, E, A>;
}

/** Return the supplied environment or compose a standalone DOM owner. */
export function createSelectletEnvironment(options: SelectletOptions = {}): SelectletEnvironment {
  return options.env ?? { userAgent: { dom: options.dom ?? standardDOM } };
}
