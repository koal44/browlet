import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../infra/index';
import {
  annotated, arg, defineInterface, idlType, impl, nullable, op, reference, xattr,
  DOMExceptionImpl, DOMExceptionNames,
} from '../../../web-idl/index';

import { isValidDoctypeName } from '../infra/index';
import type { DOMEnvironment } from '../environment';

import type { DocumentImpl } from './document';
import type { DocumentTypeImpl } from './document-type';

/** Legacy document factories associated with one Document and its realm. */
// https://dom.spec.whatwg.org/#interface-domimplementation
export class DOMImplementationImpl {
  /** Environment owning this factory's platform object. */
  env: DOMEnvironment;
  /** Document supplying the allocator and origin for newly created documents. */
  #document: DocumentImpl;

  constructor(document: DocumentImpl, env: DOMEnvironment) {
    this.#document = document;
    this.env = env;
  }

  /** Create a detached doctype associated with the factory's document. */
  // https://dom.spec.whatwg.org/#dom-domimplementation-createdocumenttype
  createDocumentType(name: string, publicId: string, systemId: string): DocumentTypeImpl {
    if (!isValidDoctypeName(name)) throw new DOMExceptionImpl('', DOMExceptionNames.invalidCharacter);
    return this.#document.createDocumentType(name, publicId, systemId);
  }

  /** Create an XML document and adopt the optional doctype into it. */
  // https://dom.spec.whatwg.org/#dom-domimplementation-createdocument
  createDocument(namespace: string | null, qualifiedName: string, doctype: DocumentTypeImpl | null): DocumentImpl {
    const document = this.#document.createDocumentNode(true);
    const element = qualifiedName === '' ? null : document.createElementNS(namespace, qualifiedName, {});
    if (doctype !== null) document.appendChild(doctype);
    if (element !== null) document.appendChild(element);
    document.origin = this.#document.origin;
    document.contentType = namespace === HTML_NAMESPACE ? 'application/xhtml+xml'
      : namespace === SVG_NAMESPACE ? 'image/svg+xml' : 'application/xml';
    return document;
  }

  /** Create the standard doctype, html/head/body tree and optional title without parsing markup. */
  // https://dom.spec.whatwg.org/#dom-domimplementation-createhtmldocument
  createHTMLDocument(title?: string): DocumentImpl {
    const document = this.#document.createDocumentNode();
    document.type = 'html';
    document.contentType = 'text/html';
    document.appendChild(document.createDocumentType('html', '', ''));
    const html = document.appendChild(document.createElementNode('html', HTML_NAMESPACE));
    const head = html.appendChild(document.createElementNode('head', HTML_NAMESPACE));
    if (title !== undefined) {
      head.appendChild(document.createElementNode('title', HTML_NAMESPACE)).appendChild(document.createTextNode(title));
    }
    html.appendChild(document.createElementNode('body', HTML_NAMESPACE));
    document.origin = this.#document.origin;
    return document;
  }

  /** Historical feature detection no longer distinguishes supported features. */
  // https://dom.spec.whatwg.org/#dom-domimplementation-hasfeature
  hasFeature(): boolean { return true; }
}

/*
 * [Exposed=Window]
 * interface DOMImplementation {
 *   [NewObject] DocumentType createDocumentType(DOMString name, DOMString publicId, DOMString systemId);
 *   [NewObject] XMLDocument createDocument(DOMString? namespace, [LegacyNullToEmptyString] DOMString qualifiedName,
 *                                        optional DocumentType? doctype = null);
 *   [NewObject] Document createHTMLDocument(optional DOMString title);
 *   boolean hasFeature();
 * };
 */
export const domImplementationIDL = defineInterface({
  name: 'DOMImplementation', exposed: 'Window', implementation: impl(DOMImplementationImpl),
  members: [
    op('createDocumentType', reference('DocumentType'),
      [arg('name', idlType.DOMString), arg('publicId', idlType.DOMString), arg('systemId', idlType.DOMString)],
      xattr('NewObject'),
    ),
    op('createDocument', reference('XMLDocument'),
      [
        arg('namespace', nullable(idlType.DOMString)),
        arg('qualifiedName', annotated(idlType.DOMString, xattr('LegacyNullToEmptyString'))),
        arg('doctype', nullable(reference('DocumentType')), { default: null, optional: true }),
      ],
      xattr('NewObject'),
    ),
    op('createHTMLDocument', reference('Document'),
      [arg('title', idlType.DOMString, { optional: true })], xattr('NewObject'),
    ),
    op('hasFeature', idlType.boolean),
  ],
});
