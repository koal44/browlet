import {
  standardDOM, type DOMOperations, type DOMNode, type DOMElement, type DOMDocument, type DOMDocumentFragment,
} from '../infra/index';
import type { SelectletOptions } from './selectlet';

/** Existing owner supplying the host DOM used by selector queries. */
export interface SelectletEnvironment<
  N extends object = DOMNode, E extends N = N & DOMElement, A extends object = object,
  D extends N = N & DOMDocument, F extends N = N & DOMDocumentFragment,
> {
  /** Host owner sharing DOM access across documents and engines. */
  userAgent: SelectletUserAgent<N, E, A, D, F>;
}

/** DOM integration shared by this host's selector engines. */
export interface SelectletUserAgent<
  N extends object = DOMNode, E extends N = N & DOMElement, A extends object = object,
  D extends N = N & DOMDocument, F extends N = N & DOMDocumentFragment,
> {
  /** Read host nodes and their live state through the supplied operations. */
  dom: DOMOperations<N, E, A, D, F>;
}

/** Return the supplied environment or compose a standalone DOM owner. */
export function createSelectletEnvironment(options: SelectletOptions = {}): SelectletEnvironment {
  return options.env ?? { userAgent: { dom: options.dom ?? standardDOM } };
}
