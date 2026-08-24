import { DocumentImpl } from './dom/nodes/document';
import type { ElementImpl } from './dom/nodes/element';
import { isText } from './dom/nodes/node';
import { getSourceCodeLocation } from './html/parser/tree-adapter';
import { parseURL } from '../url/url';
import { getRelevantRealm } from './bindings';
import {
  completelyFinishLoading, createAndInitializeDocument,
} from './browsing/document-lifecycle';
import {
  createNewTopLevelTraversable, type TopLevelTraversable,
} from './browsing/navigable';
import {
  createNavigationHistoryEntry, createNavigationParams,
  finalizeCrossDocumentNavigation, resolveNavigationHistoryBehavior,
} from './browsing/navigation/navigation';
import {
  BrowletParser, type DocumentWrite,
} from './html/parser/document-parser';
import type { Realm } from './scripting/realm';
import type { WindowProxy } from './browsing/window/window-proxy';
import { WindowImpl } from './browsing/window/window';
import { UserAgent } from './user-agent';

export class Browlet {
  readonly #exposures = new Map<string, unknown>();
  #route: BrowletRoute;
  readonly #traversable: TopLevelTraversable;
  readonly #userAgent: UserAgent;

  constructor(config: BrowletConfig) {
    this.#route = config.route;
    this.#userAgent = new UserAgent();
    this.#traversable = createNewTopLevelTraversable(
      this.#userAgent,
      null,
      '',
    );
    if (
      this.#traversable.activeDocument === null ||
      this.#traversable.activeWindow === null
    ) {
      throw new Error('Initial top-level traversable is incomplete');
    }
  }

  get document(): DocumentImpl {
    const document = this.#traversable.activeDocument;
    if (document === null) {
      throw new Error('Top-level traversable has no active Document');
    }
    return document;
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
    this.#exposures.set(name, value);
    Object.defineProperty(this.requireActiveWindow(), name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  async navigate(url: string | URL): Promise<BrowletWindow> {
    const documentURL = new URL(url);
    const source = this.fetch(documentURL);
    const documentURLRecord = requireURLRecord(documentURL.href);
    const navigationParams = createNavigationParams(
      this.#traversable,
      documentURLRecord,
      source,
    );
    const historyHandling = resolveNavigationHistoryBehavior(
      this.#traversable,
      documentURLRecord,
      navigationParams.origin,
    );
    const document = createAndInitializeDocument(
      'html',
      'text/html',
      navigationParams,
    );
    const realm = getRelevantRealm(document);
    const window = realm.globalObject;
    if (!WindowImpl.is(window)) {
      throw new Error('Navigation Document global object is not a Window');
    }
    this.installExposures(window);
    const historyEntry = createNavigationHistoryEntry(
      document,
      navigationParams,
    );
    finalizeCrossDocumentNavigation(
      this.#traversable,
      historyHandling,
      navigationParams.userInvolvement,
      historyEntry,
    );

    const parser = new BrowletParser(
      document,
      (element, write) => {
        this.executeScript(
          element,
          documentURL,
          write,
          document,
          window,
          realm,
        );
      },
    );

    await parser.parse(source);
    completelyFinishLoading(document);
    return this.window;
  }

  close(): void {}

  // -- Friends ----------------------------------------------------------

  static getTopLevelTraversable(browlet: Browlet): TopLevelTraversable {
    return browlet.#traversable;
  }

  // -- Private ----------------------------------------------------------

  private executeScript(
    element: ElementImpl,
    documentURL: URL,
    write: DocumentWrite,
    document: DocumentImpl,
    window: WindowImpl,
    realm: Realm,
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

    DocumentImpl.withWriter(document, write, () => {
      realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }

  private installExposures(window: WindowImpl): void {
    for (const [name, value] of this.#exposures) {
      Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value,
      });
    }
  }

  private requireActiveWindow(): WindowImpl {
    const window = this.#traversable.activeWindow;
    if (window === null) {
      throw new Error('Top-level traversable has no active Window');
    }
    return window;
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
