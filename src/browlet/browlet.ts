import { createDomlet } from '../domlet/domlet';
import {
  withDocumentWriter, type DomletDocument,
} from '../domlet/nodes/document';
import type { ElementImpl } from '../domlet/nodes/element';
import { isText } from '../domlet/nodes/node';
import { getSourceCodeLocation } from '../domlet/parser/parser';
import { BrowletParser, type DocumentWrite } from './parser';
import { Realm } from './realm';
import { WindowImpl } from './window';
import {
  WindowProxyController, type WindowProxyValue,
} from './window-proxy';

export class Browlet {
  #document: DomletDocument;
  readonly #exposed = new Map<string, unknown>();
  readonly #realm: Realm;
  #route: BrowletRoute;
  #window: WindowImpl;
  readonly #windowProxy: WindowProxyController;

  constructor(config: BrowletConfig) {
    this.#route = config.route;
    this.#document = createDomlet();

    this.#realm = new Realm();
    this.#windowProxy = new WindowProxyController(this.#realm);
    this.#window = this.createWindow(
      this.#document,
      new URL('about:blank'),
    );
    this.#windowProxy.setWindow(this.#window);
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
    this.#exposed.set(name, value);
    this.#windowProxy.expose(name, value);
  }

  async navigate(url: string | URL): Promise<BrowletWindow> {
    const documentURL = new URL(url);
    const source = this.fetch(documentURL);
    const parser = new BrowletParser((element, write) => {
      this.executeScript(element, documentURL, write);
    });
    const document = parser.document;
    const window = this.createWindow(document, documentURL);

    this.#document = document;
    this.#window = window;
    this.#windowProxy.setWindow(window);

    await parser.parse(source);
    window.dispatchEvent(new Event('load'));
    return this.window;
  }

  close(): void {}

  private createWindow(document: DomletDocument, url: URL): WindowImpl {
    const window = new WindowImpl(document, url);

    for (const [name, value] of this.#exposed) {
      this.#windowProxy.expose(name, value);
    }

    return window;
  }

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
    withDocumentWriter(this.#document, write, () => {
      this.#realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }
}

export type BrowletWindow = WindowProxyValue;

export type BrowletRoute = (url: string) => string;

export type BrowletConfig = {
  route: BrowletRoute;
};

export function createBrowlet(config: BrowletConfig): Browlet {
  return new Browlet(config);
}

function getTextContent(element: ElementImpl): string {
  let content = '';

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (isText(child)) content += child.data;
  }

  return content;
}
