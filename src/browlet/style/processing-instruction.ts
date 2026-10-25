import { getEncoding } from '../../encoding/index';
import { getMIMETypeEssence, parseMIMEType } from '../../mime/index';
import type { FetchController } from '../../fetch/index';
import type { CSSStyleSheetImpl, TreeScope } from '../../stylelet/index';

import type { ProcessingInstructionImpl } from '../dom/nodes/index';

/** LinkStyle association and cancellable CSS loading for an XML stylesheet instruction. */
// https://drafts.csswg.org/cssom/#requirements-on-user-agents-implementing-the-xml-stylesheet-processing-instruction
export class ProcessingInstructionLinkStyleMixin {
  /** Associated CSS implementation, or null before an accepted resource finishes loading. */
  sheet: CSSStyleSheetImpl | null = null;
  /** Instruction that supplies the resource's pseudo-attributes. */
  #owner: ProcessingInstructionImpl;
  /** Whether the instruction currently precedes its document's element child. */
  #inProlog = false;
  /** Fetch belonging to the current data and document, if it has not completed. */
  #fetch: FetchController | null = null;
  /** Scope holding the associated sheet, retained across removal and adoption. */
  #scope: TreeScope | null = null;

  constructor(owner: ProcessingInstructionImpl) {
    this.#owner = owner;
  }

  /** Refresh membership after a document child is inserted, removed, or moved. */
  setInProlog(inProlog: boolean): void {
    if (this.#inProlog === inProlog) return;
    this.#inProlog = inProlog;
    this.update();
  }

  /** Refresh participation and sheet order after a state-preserving DOM move. */
  move(): void {
    // The old Document cannot classify an instruction moved out of its child list.
    if (!this.#owner.parentNode!.isDocument()) this.setInProlog(false);
    if (this.sheet !== null) this.#scope!.moveTreeStyleSheet(this.sheet);
  }

  /** Replace the association and stop the previous fetch when source data or membership changes. */
  update(): void {
    this.#fetch?.terminate();
    this.#fetch = null;
    if (this.sheet !== null) this.#scope!.removeStyleSheet(this.sheet);
    this.sheet = null;
    this.#scope = null;
    const owner = this.#owner;
    // SPEC_CLASH(xml-stylesheet-prolog): Follow CSSOM/Firefox; Chromium/WebKit also process instructions after the root.
    if (!this.#inProlog || owner.target !== 'xml-stylesheet' || !owner.pseudoAttributesAreWellFormed) return;
    const href = owner.getAttribute('href');
    if (href === null) return;
    const title = owner.getAttribute('title') ?? '';
    const alternate = owner.getAttribute('alternate') === 'yes';
    if (alternate && title === '') return;
    const type = owner.getAttribute('type');
    if (type !== null && type !== '') {
      const mimeType = parseMIMEType(type);
      if (mimeType === null || getMIMETypeEssence(mimeType) !== 'text/css') return;
    }
    const document = owner.nodeDocument;
    const url = document.env.parseURL(href, document.getBaseURL());
    if (url === null) return;
    const options = {
      ownerNode: owner, title, alternate, media: owner.getAttribute('media') ?? '',
      encoding: getEncoding(owner.getAttribute('charset') ?? '') ?? getEncoding(document.encoding) ?? 'UTF-8',
    };
    // SPEC_CLASH(xml-stylesheet-fragment): CSSOM fetches fragment hrefs normally; Chromium/WebKit skip fragment-only CSS references.
    // This does not implement XSLT's separate embedded-stylesheet mechanism.
    // SPEC_GAP(xml-stylesheet-events): CSSOM does not specify load/error events; follow Chromium/WebKit by dispatching neither.
    const controller = document.fetchCSSStyleSheet(url, document.url, { initiatorType: 'other' }, (response, bytes) => {
      if (this.#fetch !== controller) return;
      this.#fetch = null;
      // SPEC_CLASH(xml-stylesheet-rejected-association): Follow CSSOM's null association; browsers retain empty sheets after HTTP/MIME rejection.
      if (bytes === null) return;
      const sheet = document.createFetchedStyleSheet(url, response, bytes, options);
      const scope = document.getStyleScope();
      scope.addTreeStyleSheet(sheet);
      this.sheet = sheet;
      this.#scope = scope;
    });
    this.#fetch = controller;
  }
}
