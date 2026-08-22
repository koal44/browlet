import { Domlet } from '../domlet/domlet';
import {
  DocumentImpl, type DocumentInitialization, type DomletDocument,
} from '../domlet/nodes/document';
import type { ElementImpl } from '../domlet/nodes/element';
import { fireEvent } from '../domlet/events/event-target';
import { isText } from '../domlet/nodes/node';
import { getSourceCodeLocation } from '../domlet/parser/parser';
import { obtainURLOrigin, parseURL } from '../url/url';
import { BrowletBindings } from './bindings/browlet';
import { BrowletParser, type DocumentWrite } from './parser';
import { Realm } from './realm';
import { WindowImpl } from './window';
import {
  WindowProxyController, type WindowProxyValue,
} from './window-proxy';

export class Browlet {
  readonly #bindings: BrowletBindings;
  readonly #domlet: Domlet;
  #document: DomletDocument;
  readonly #realm: Realm;
  #route: BrowletRoute;
  #window: WindowImpl;
  readonly #windowProxy: WindowProxyController;

  /*
   * TODO(HTML browsing-context creation): navigation currently preserves both
   * this realm and its VM global. HTML instead preserves the WindowProxy while
   * replacing the realm for a cross-origin Document. Node's vm API cannot use
   * an existing external WindowProxy as a new context's actual global-this
   * object, so that host bridge remains an explicit lifecycle limitation.
   */

  constructor(config: BrowletConfig) {
    this.#route = config.route;
    this.#realm = new Realm();
    this.#bindings = new BrowletBindings(this.#realm);
    this.#domlet = new Domlet(this.#bindings.dom);
    this.#document = this.#domlet.parse();
    this.#windowProxy = new WindowProxyController(this.#realm);
    this.#window = new WindowImpl(
      this.#document,
      new URL('about:blank'),
    );
    this.#bindings.dom.associateEventTarget(this.#window);
    this.#realm.setWindow(this.#window);
    this.#windowProxy.setWindow(this.#window);

    this.#bindings.install(this.#windowProxy.value);
  }

  get document(): DomletDocument {
    return this.#document;
  }

  get window(): BrowletWindow {
    return this.#windowProxy.value;
  }

  route(route: BrowletRoute): void {
    this.#route = route;
  }

  fetch(url: string | URL): string {
    return this.#route(String(url));
  }

  expose(name: string, value: unknown): void {
    this.#windowProxy.expose(name, value);
  }

  async navigate(url: string | URL): Promise<BrowletWindow> {
    const documentURL = new URL(url);
    const source = this.fetch(documentURL);
    const parser = new BrowletParser(
      this.#domlet,
      (element, write) => {
        this.executeScript(element, documentURL, write);
      },
      documentInitialization(documentURL),
    );
    const document = parser.document;
    const window = new WindowImpl(document, documentURL);

    this.#document = document;
    this.#window = window;
    this.#bindings.dom.associateEventTarget(window);
    this.#realm.setWindow(window);
    this.#windowProxy.setWindow(window);

    await parser.parse(source);
    fireEvent('load', window);
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

    this.#windowProxy.updateNamedProperties(this.#document);
    DocumentImpl.withWriter(this.#document, write, () => {
      this.#realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }
}

export type BrowletWindow = WindowProxyValue;

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

function documentInitialization(url: URL): DocumentInitialization {
  const record = parseURL(url.href).url;
  if (record === null) {
    throw new Error(`Could not parse navigation URL ${url.href}`);
  }

  return {
    origin: obtainURLOrigin(record),
    url: record,
  };
}
