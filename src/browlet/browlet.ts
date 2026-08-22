import { Domlet } from '../domlet/domlet';
import {
  DocumentImpl, type DocumentInitialization, type DomletDocument,
} from '../domlet/nodes/document';
import type { ElementImpl } from '../domlet/nodes/element';
import { fireEvent } from '../domlet/events/event-target';
import { isText } from '../domlet/nodes/node';
import { getSourceCodeLocation } from '../domlet/parser/parser';
import { createOpaqueOrigin } from '../url/origin';
import { obtainURLOrigin, parseURL } from '../url/url';
import { obtainSimilarOriginWindowAgent } from './agents';
import { BrowletBindings } from './bindings/browlet';
import { BrowsingContext } from './browsing-context';
import { setupWindowEnvironmentSettingsObject } from './environment';
import { BrowletParser, type DocumentWrite } from './parser';
import { createRealm, type Realm } from './realm';
import {
  setWindowProxyWindow, type WindowProxy,
} from './window-proxy';
import { updateWindowNamedProperties, WindowImpl } from './window';
import { UserAgent } from './user-agent';

export class Browlet {
  // Transitional ownership: phases two through four move active lifecycle
  // objects under the user agent, traversable, browsing context, and realm.
  readonly #bindings: BrowletBindings;
  readonly #browsingContext: BrowsingContext;
  readonly #domlet: Domlet;
  #document: DomletDocument;
  readonly #realm: Realm;
  #route: BrowletRoute;
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
    const userAgent = new UserAgent();
    const group = userAgent.createBrowsingContextGroup();
    this.#browsingContext = new BrowsingContext();
    group.append(this.#browsingContext);

    const initialURL = requireURLRecord('about:blank');
    const initialOrigin = createOpaqueOrigin();
    const agent = obtainSimilarOriginWindowAgent(
      initialOrigin,
      group,
      false,
    );
    this.#window = new WindowImpl(new URL('about:blank'));
    const executionContext = createRealm(agent, {
      createGlobalObject: () => this.#window,
      createGlobalThisValue: () => this.#browsingContext.windowProxy,
    });
    this.#realm = executionContext.realm;
    setupWindowEnvironmentSettingsObject(
      initialURL,
      executionContext,
      null,
      initialURL,
      initialOrigin,
    );
    this.#bindings = new BrowletBindings(this.#realm);
    this.#domlet = new Domlet(this.#bindings.dom);
    this.#document = this.#domlet.parse();
    WindowImpl.setAssociatedDocument(this.#window, this.#document);
    this.#bindings.dom.associateEventTarget(this.#window);
    setWindowProxyWindow(this.#browsingContext.windowProxy, this.#window);

    this.#bindings.install(this.#window);
  }

  get document(): DomletDocument {
    return this.#document;
  }

  get window(): BrowletWindow {
    return this.#browsingContext.windowProxy;
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
    const parser = new BrowletParser(
      this.#domlet,
      (element, write) => {
        this.executeScript(element, documentURL, write);
      },
      documentInitialization(documentURL),
    );
    const document = parser.document;

    this.#document = document;
    WindowImpl.setAssociatedDocument(this.#window, document);

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

// Transitional parser input removed by phase two's Document-first lifecycle.
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

function requireURLRecord(input: string) {
  const record = parseURL(input).url;
  if (record === null) throw new Error(`Could not parse ${input}`);
  return record;
}
