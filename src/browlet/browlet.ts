import { DocumentImpl } from './dom/nodes/document';
import type { ElementImpl } from './dom/nodes/element';
import { isText } from './dom/nodes/node';
import { getSourceCodeLocation } from './html/parser/tree-adapter';
import { parseURL } from '../url/url';
import { nodeRuntime } from '../js-engine/index';
import {
  browletBindings, getRelevantRealm,
} from './bindings';
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
import { installHostHooks } from './scripting/host-hooks';
import { UserAgent } from './user-agent';
import { requestNodeEventLoopTurn } from './integration/scripting';
import { unsafeSharedCurrentTime } from
  './performance/high-resolution-time';

export class Browlet {
  readonly #exposures = new Map<string, unknown>();
  #route: BrowletRoute;
  readonly #traversable: TopLevelTraversable;
  readonly #userAgent: UserAgent;

  constructor(config: BrowletConfig) {
    installHostHooks();
    this.#route = config.route;
    this.#userAgent = new UserAgent(
      {
        createMicrotaskQueue: nodeRuntime.createMicrotaskQueue,
        requestEventLoopTurn: requestNodeEventLoopTurn,
        unsafeSharedCurrentTime,
      },
    );
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

  get document(): Document {
    const document = this.#traversable.activeDocument;
    if (document === null) {
      throw new Error('Top-level traversable has no active Document');
    }
    return browletBindings.getPlatformObject(document) as Document;
  }

  get window(): WindowProxy {
    const browsingContext = this.#traversable.activeBrowsingContext;
    if (browsingContext === null) {
      throw new Error('Top-level traversable has no active browsing context');
    }
    return browsingContext.windowProxy;
  }

  route(route: BrowletRoute): void {
    this.#route = route;
  }

  expose(name: string, value: unknown): void {
    this.#exposures.set(name, value);
    Object.defineProperty(this.window, name, {
      configurable: true,
      writable: true,
      value,
    });
  }

  async navigate(url: string | URL): Promise<WindowProxy> {
    const documentURL = new URL(url);
    const source = this.getRouteSource(documentURL);
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
    this.installExposures(realm.globalObject);
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
          realm,
        );
      },
    );

    await parser.parse(source);
    completelyFinishLoading(document);
    return this.window;
  }

  // -- Private ----------------------------------------------------------

  private executeScript(
    element: ElementImpl,
    documentURL: URL,
    write: DocumentWrite,
    document: DocumentImpl,
    realm: Realm,
  ): void {
    const sourceURL = element.getAttribute('src');
    const scriptURL = sourceURL === null
      ? documentURL
      : new URL(sourceURL, documentURL);
    const source = sourceURL === null
      ? getTextContent(element)
      : this.getRouteSource(scriptURL);
    const lineOffset = sourceURL === null
      ? (getSourceCodeLocation(element)?.startTag?.endLine ?? 1) - 1
      : 0;

    DocumentImpl.withWriter(document, write, () => {
      realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }

  private installExposures(window: object): void {
    for (const [name, value] of this.#exposures) {
      Object.defineProperty(window, name, {
        configurable: true,
        writable: true,
        value,
      });
    }
  }

  private getRouteSource(url: string | URL): string {
    return this.#route(String(url));
  }
}

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
