import { Domlet } from '../domlet/domlet';
import { DocumentImpl, type DomletDocument } from '../domlet/nodes/document';
import type { ElementImpl } from '../domlet/nodes/element';
import { fireEvent } from '../domlet/events/event-target';
import { isText } from '../domlet/nodes/node';
import { getSourceCodeLocation } from '../domlet/parser/parser';
import { obtainURLOrigin, parseURL } from '../url/url';
import { BrowletBindings } from './bindings/browlet';
import {
  createNewTopLevelTraversable, type TopLevelTraversable,
} from './navigable';
import { BrowletParser, type DocumentWrite } from './parser';
import { getRelevantRealm, type Realm } from './realm';
import type { WindowProxy } from './window-proxy';
import { updateWindowNamedProperties, WindowImpl } from './window';
import { UserAgent } from './user-agent';

export class Browlet {
  // Transitional direct services: the parser/navigation phase will obtain
  // these from the active Document's environment rather than Browlet fields.
  readonly #bindings: BrowletBindings;
  readonly #domlet: Domlet;
  #document: DomletDocument;
  readonly #realm: Realm;
  #route: BrowletRoute;
  readonly #traversable: TopLevelTraversable;
  readonly #userAgent: UserAgent;
  #window: WindowImpl;

  /*
   * TODO(HTML navigation): Browlet temporarily preserves this Realm and Window
   * across navigation. HTML instead preserves only the WindowProxy when a new
   * Window is required. Node's VM cannot use that existing WindowProxy as a
   * replacement context's actual global-this, so the host bridge remains an
   * explicit lifecycle limitation.
   */

  constructor(config: BrowletConfig) {
    this.#route = config.route;
    this.#userAgent = new UserAgent();
    this.#traversable = createNewTopLevelTraversable(
      this.#userAgent,
      null,
      '',
    );
    const document = this.#traversable.activeDocument;
    const window = this.#traversable.activeWindow;
    if (document === null || window === null) {
      throw new Error('Initial top-level traversable is incomplete');
    }

    this.#document = document;
    this.#window = window;
    this.#realm = getRelevantRealm(document);
    this.#bindings = BrowletBindings.forRealm(this.#realm);
    this.#domlet = new Domlet(this.#bindings.dom);
  }

  get document(): DomletDocument {
    return this.#document;
  }

  get window(): BrowletWindow {
    const browsingContext = this.#traversable.activeBrowsingContext;
    if (browsingContext === null) {
      throw new Error('Top-level traversable has no active browsing context');
    }
    return browsingContext.windowProxy;
  }

  route(route: BrowletRoute): void {
    this.#route = route;
  }

  fetch(url: string | URL): string {
    return this.#route(String(url));
  }

  expose(name: string, value: unknown): void {
    Object.defineProperty(this.#window, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  async navigate(url: string | URL): Promise<BrowletWindow> {
    const documentURL = new URL(url);
    const source = this.fetch(documentURL);
    const document = this.#domlet.createDocument();
    const documentURLRecord = requireURLRecord(documentURL.href);
    DocumentImpl.setType(document, 'html');
    DocumentImpl.setContentType(document, 'text/html');
    DocumentImpl.setOrigin(document, obtainURLOrigin(documentURLRecord));
    DocumentImpl.setURL(document, documentURLRecord);
    DocumentImpl.setAllowsDeclarativeShadowRoots(document, true);

    this.#document = document;
    WindowImpl.setAssociatedDocument(this.#window, document);

    const parser = new BrowletParser(
      this.#domlet,
      document,
      (element, write) => {
        this.executeScript(element, documentURL, write);
      },
    );

    await parser.parse(source);
    fireEvent('load', this.#window);
    return this.window;
  }

  close(): void {}

  private executeScript(
    element: ElementImpl,
    documentURL: URL,
    write: DocumentWrite,
  ): void {
    const sourceURL = element.getAttribute('src');
    const scriptURL = sourceURL === null
      ? documentURL
      : new URL(sourceURL, documentURL);
    const source = sourceURL === null
      ? getTextContent(element)
      : this.fetch(scriptURL);
    const lineOffset = sourceURL === null
      ? (getSourceCodeLocation(element)?.startTag?.endLine ?? 1) - 1
      : 0;

    updateWindowNamedProperties(this.#window, this.#document);
    DocumentImpl.withWriter(this.#document, write, () => {
      this.#realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }
}

export type BrowletWindow = WindowProxy;

export type BrowletRoute = (url: string) => string;

export type BrowletConfig = {
  route: BrowletRoute;
};

function getTextContent(element: ElementImpl): string {
  let content = '';

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (isText(child)) content += child.data;
  }

  return content;
}

function requireURLRecord(input: string) {
  const record = parseURL(input).url;
  if (record === null) throw new Error(`Could not parse ${input}`);
  return record;
}
