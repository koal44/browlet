import type { DocumentImpl } from './dom/nodes/document';
import type { ElementImpl } from './dom/nodes/element';
import { isText } from './dom/nodes/node';
import { getSourceCodeLocation } from './html/parser/tree-adapter';
import { isHeaderValue } from '../fetch/index';
import { createMicrotaskQueue } from '../js-engine/index';
import type { InternalPromise } from '../infra/promises';
import type { StampedPlatformObject } from '../web-idl/index';
import { project, getRelevantRealm } from './bindings';
import type { Environment } from './scripting/environment';
import { createAndInitializeDocument } from './browsing/document-lifecycle';
import {
  createNewTopLevelTraversable, type TopLevelTraversable,
} from './browsing/navigable';
import {
  NavigationParams,
  finalizeCrossDocumentNavigation, resolveNavigationHistoryBehavior,
} from './browsing/navigation/navigation';
import {
  BrowletParser, type DocumentWrite,
} from './html/parser/document-parser';
import type { Realm } from './scripting/realm';
import { installHostHooks } from './scripting/host-hooks';
import { UserAgent } from './user-agent';
import type { AuthenticationPrompt } from './loader/authentication';
import { requestNodeEventLoopTurn } from './integration/scripting';
import { PageEvaluation } from './automation/evaluation';
import { unsafeSharedCurrentTime } from
  './performance/high-resolution-time';
import { InternalError } from '../infra/internal-error';

export class Browlet {
  #exposures: Map<string, (args: unknown[]) => unknown> = new Map();
  #evaluation: PageEvaluation;
  #route: BrowletRoute;
  #traversable: TopLevelTraversable;
  #userAgent: UserAgent;

  constructor(config: BrowletConfig) {
    installHostHooks();
    this.#route = config.route;
    this.#userAgent = new UserAgent(
      {
        createMicrotaskQueue,
        requestEventLoopTurn: requestNodeEventLoopTurn,
        unsafeSharedCurrentTime,
      },
    );
    if (config.userAgent !== undefined) {
      if (!isHeaderValue(config.userAgent)) {
        // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
        throw new TypeError('userAgent must be a valid HTTP header value');
      }
      this.#userAgent.defaultUserAgentValue = config.userAgent;
    }
    this.#userAgent.reportDeliveryEnabled = config.reporting ?? true;
    if (config.authentication) this.#userAgent.httpAuthentication.onPrompt = config.authentication;
    this.#traversable = createNewTopLevelTraversable(
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
    this.#evaluation = new PageEvaluation(getRelevantRealm(this.window));
  }

  get document(): Document {
    const document = this.#traversable.activeDocument;
    if (document === null) {
      throw new InternalError('Top-level traversable has no active Document');
    }
    return project(document) as StampedPlatformObject<Document>;
  }

  get window(): WindowProxy {
    const browsingContext = this.#traversable.activeBrowsingContext;
    if (browsingContext === null) {
      throw new InternalError('Top-level traversable has no active browsing context');
    }
    return browsingContext.windowProxy;
  }

  route(route: BrowletRoute): void {
    this.#route = route;
  }

  /** Clear this browser's cached HTTP credentials. */
  clearHTTPCredentials(): void {
    this.#userAgent.httpAuthentication.clear();
  }

  /** Clear cached HTTP responses and identifying validators, including pending writes. */
  clearHTTPCache(): void {
    this.#userAgent.httpCachePartitions.clear();
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

  navigate(url: string | URL): Promise<WindowProxy> {
    // eslint-disable-next-line no-restricted-globals -- Node-facing API: internal HTML work finishes through InternalPromise before this host promise settles.
    return new Promise((resolve, reject) => {
      this.navigateDocument(url).observe(resolve, reject);
    });
  }

  // -- Private ----------------------------------------------------------

  private navigateDocument(url: string | URL): InternalPromise<WindowProxy> {
    const documentURL = new URL(url);
    const source = this.getRouteSource(documentURL);
    const documentURLRecord = requireURLRecord(documentURL.href, getRelevantRealm(this.window).env);
    const navigationParams = NavigationParams.fromSource(
      this.#traversable,
      documentURLRecord,
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
    const env = document.env;
    const historyEntry = navigationParams.createHistoryEntry(document, source);
    finalizeCrossDocumentNavigation(
      this.#traversable,
      historyHandling,
      navigationParams.userInvolvement,
      historyEntry,
    );
    this.#evaluation.dispose();
    this.#evaluation = new PageEvaluation(realm);
    for (const [name, callback] of this.#exposures) {
      this.#evaluation.exposeFunction(name, callback);
    }

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
      realm.agent.eventLoop,
      env,
    );

    return parser.parse(source).then(() => {
      document.finishLoading();
      return this.window;
    });
  }

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

    document.withWriter(write, () => {
      realm.evaluate(source, scriptURL.href, lineOffset);
    });
  }

  private getRouteSource(url: string | URL): string {
    return this.#route(String(url));
  }
}

export type BrowletRoute = (url: string) => string;

export type BrowletConfig = {
  route: BrowletRoute;
  /** Default User-Agent header value; defaults to Mozilla/5.0 (compatible; Browlet). */
  userAgent?: string;
  /** Allow outbound reports; false retains local ReportingObservers. Defaults to true. */
  reporting?: boolean;
  /** Answer HTTP authentication challenges; omitted prompts are declined. */
  authentication?: AuthenticationPrompt;
};

function getTextContent(element: ElementImpl): string {
  let content = '';

  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (isText(child)) content += child.data;
  }

  return content;
}

function requireURLRecord(input: string, env: Environment) {
  const record = env.parseURL(input).url;
  if (record === null) throw new InternalError(`Could not parse validated navigation URL ${input}`);
  return record;
}
