import { internalType, type InternalPromise } from '../infra/promises';
import { InternalError } from '../infra/internal-error';
import type { StampedPlatformObject } from '../web-idl/index';
import type { SystemColorPalette } from '../stylelet/index';
import { isHeaderValue } from '../fetch/index';

import type { Document, WindowProxy } from './platform';
import { type BrowletRealm, installHostHooks } from './scripting/index';
import type { DocumentImpl, ElementImpl } from './dom/nodes/index';
import { getSourceCodeLocation, HTMLDocumentParser, type DocumentWrite } from './html/parser/index';
import { PageEvaluation } from './automation/index';
import type { AuthenticationPrompt } from './loader/index';
import { TopLevelTraversable } from './browsing/navigation/index';
import { browletBindingWorld } from './bindings';
import { UserAgent } from './user-agent';

/** Hosts one top-level browsing session with navigation and page evaluation. */
export class Browlet {
  #exposures: Map<string, (args: unknown[]) => unknown> = new Map();
  #evaluation: PageEvaluation;
  #route: BrowletRoute;
  #traversable: TopLevelTraversable;
  #userAgent: UserAgent;

  constructor(config: BrowletConfig) {
    installHostHooks();
    this.#route = config.route;
    this.#userAgent = new UserAgent();
    if (config.systemColors !== undefined) this.#userAgent.systemColors = config.systemColors;
    if (config.userAgent !== undefined) {
      if (!isHeaderValue(config.userAgent)) {
        // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
        throw new TypeError('userAgent must be a valid HTTP header value');
      }
      this.#userAgent.defaultUserAgentValue = config.userAgent;
    }
    this.#userAgent.reportDeliveryEnabled = config.reporting ?? true;
    if (config.authentication) this.#userAgent.httpAuthentication.onPrompt = config.authentication;
    this.#traversable = TopLevelTraversable.create(
      this.#userAgent,
      null,
      '',
    );
    if (
      this.#traversable.activeDocument === null ||
      this.#traversable.activeWindow === null
    ) {
      throw new InternalError('Initial top-level traversable is incomplete');
    }
    this.#evaluation = new PageEvaluation(this.#traversable.activeWindow.env.realm);
  }

  /** Platform Document currently active in this session. */
  get document(): Document {
    const document = this.#traversable.activeDocument;
    if (document === null) {
      throw new InternalError('Top-level traversable has no active Document');
    }
    const platform = browletBindingWorld.project(document);
    if (!platform) throw new InternalError('Active Document has no binding');
    return platform as StampedPlatformObject<Document>;
  }

  /** Stable WindowProxy for the active browsing context. */
  get window(): WindowProxy {
    const browsingContext = this.#traversable.activeBrowsingContext;
    if (browsingContext === null) {
      throw new InternalError('Top-level traversable has no active browsing context');
    }
    return browsingContext.windowProxy.platform;
  }

  /** Replace the host callback supplying document sources for navigation. */
  route(route: BrowletRoute): void {
    this.#route = route;
  }

  /** Clear this browser's cached HTTP credentials. */
  clearHTTPCredentials(): void {
    this.#userAgent.httpAuthentication.clear();
  }

  /** Clear cached HTTP responses and identifying validators, including pending writes. */
  clearHTTPCache(): void {
    this.#userAgent.httpCache.clear();
  }

  /** Evaluate page code, await its result, and return a copy to the host. */
  evaluate<Result = unknown, Argument = unknown>(
    expression: string | ((argument: Argument) => Result), argument?: Argument,
  ): Promise<Awaited<Result>> {
    return this.#evaluation.evaluate(String(expression), typeof expression === 'function', argument) as Promise<Awaited<Result>>;
  }

  /** Install an asynchronous page-to-host callback, including after navigation. */
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/require-await -- Node-facing async API; installation is currently synchronous.
  async exposeFunction<Arguments extends unknown[], Result>(
    name: string, callback: (...args: Arguments) => Result,
  ): Promise<void> {
    // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
    if (this.#exposures.has(name)) throw new Error(`Host function ${name} is already exposed`);
    const invoke = (args: unknown[]) => callback(...args as Arguments);
    this.#evaluation.exposeFunction(name, invoke);
    this.#exposures.set(name, invoke);
  }

  /** Load a document and resolve with its browsing context's WindowProxy. */
  navigate(url: string | URL): Promise<WindowProxy> {
    // eslint-disable-next-line no-restricted-globals -- Node-facing API: internal HTML work finishes through InternalPromise before this Node Promise settles.
    return new Promise((resolve, reject) => {
      this.#navigateDocument(url).observe(resolve, reject);
    });
  }

  #navigateDocument(url: string | URL): InternalPromise<WindowProxy> {
    const documentURL = new URL(url);
    const source = this.#getRouteSource(documentURL);
    const documentURLRecord = this.#traversable.activeWindow!.env.parseURL(documentURL.href).url;
    if (documentURLRecord === null) {
      throw new InternalError(`Could not parse validated navigation URL ${documentURL.href}`);
    }
    const navigationParams = this.#traversable.createNavigationParamsFromSource(documentURLRecord);
    const historyHandling = this.#traversable.resolveHistoryBehavior(
      documentURLRecord,
      navigationParams.origin,
    );
    const document = this.#traversable.createAndInitializeDocument(
      'html',
      'text/html',
      navigationParams,
    );
    // Document initialization has attached the Window selected for this navigation.
    const realm = document.getRelevantGlobalObject()!.env.realm;
    const historyEntry = this.#traversable.createHistoryEntry(document, navigationParams, source);
    this.#traversable.finalizeCrossDocumentNavigation(
      historyHandling,
      navigationParams.userInvolvement,
      historyEntry,
    );
    this.#evaluation.dispose();
    this.#evaluation = new PageEvaluation(realm);
    for (const [name, callback] of this.#exposures) {
      this.#evaluation.exposeFunction(name, callback);
    }

    const parser = new HTMLDocumentParser(
      document,
      (element, write) => {
        this.#executeScript(
          element,
          documentURL,
          write,
          document,
          realm,
        );
      },
    );

    return parser.parse(source).then(() => {
      document.finishLoading();
      return this.window;
    }, undefined, internalType<WindowProxy>());
  }

  #executeScript(
    element: ElementImpl,
    documentURL: URL,
    write: DocumentWrite,
    document: DocumentImpl,
    realm: BrowletRealm,
  ): void {
    const sourceURL = element.getAttribute('src');
    const scriptURL = sourceURL === null
      ? documentURL
      : new URL(sourceURL, documentURL);
    const source = sourceURL === null
      ? element.getChildTextContent()
      : this.#getRouteSource(scriptURL);
    const lineOffset = sourceURL === null
      ? (getSourceCodeLocation(element)?.startTag?.endLine ?? 1) - 1
      : 0;

    document.withWriter(write, () => {
      realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }

  #getRouteSource(url: string | URL): string {
    return this.#route(String(url));
  }
}

export type BrowletRoute = (url: string) => string;

export type BrowletConfig = {
  route: BrowletRoute;
  /** Complete CSS system-color palette; defaults to Stylelet's fixed light palette. */
  systemColors?: SystemColorPalette;
  /** Default User-Agent header value; defaults to Mozilla/5.0 (compatible; Browlet). */
  userAgent?: string;
  /** Allow outbound reports; false retains local ReportingObservers. Defaults to true. */
  reporting?: boolean;
  /** Answer HTTP authentication challenges; omitted prompts are declined. */
  authentication?: AuthenticationPrompt;
};
