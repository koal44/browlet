import { internalType, type InternalPromise, InternalError } from '../infra/index';
import type { StampedPlatformObject } from '../web-idl/index';
import { isHeaderValue } from '../fetch/index';
import type { SystemColorPalette } from '../stylelet/index';

import { type BrowletRealm, installHostHooks } from './scripting/index';
import type { DocumentImpl, ElementImpl } from './dom/nodes/index';
import { getSourceCodeLocation, HTMLDocumentParser, type DocumentWrite } from './html/parser/index';
import { PageEvaluation } from './automation/index';
import type { AuthenticationPrompt } from './loader/index';
import { TopLevelTraversable } from './browsing/navigation/index';
import { browletBindingWorld } from './integration/web-idl/index';

import type { Document, WindowProxy } from './platform';
import { UserAgent, type PermissionPrompt, type PermissionChooser } from './user-agent';

/** Hosts one top-level browsing session with navigation and page evaluation. */
export class Browlet {
  #route: BrowletRoute;
  #traversable: TopLevelTraversable;
  #userAgent: UserAgent;
  #evaluation: PageEvaluation;

  constructor(config: BrowletConfig) {
    installHostHooks();
    this.#route = config.route;
    this.#userAgent = new UserAgent();
    if (config.systemColors !== undefined) this.#userAgent.systemColors = config.systemColors;
    if (config.storageQuotaBytes !== undefined) {
      if (!Number.isSafeInteger(config.storageQuotaBytes) || config.storageQuotaBytes < 0) {
        // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
        throw new RangeError('storageQuotaBytes must be a non-negative safe integer');
      }
      this.#userAgent.storageQuotaBytes = config.storageQuotaBytes;
    }
    if (config.userAgent !== undefined) {
      if (!isHeaderValue(config.userAgent)) {
        // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
        throw new TypeError('userAgent must be a valid HTTP header value');
      }
      this.#userAgent.defaultUserAgentValue = config.userAgent;
    }
    if (config.platform !== undefined) {
      if (typeof config.platform !== 'string') {
        // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
        throw new TypeError('platform must be a string');
      }
      this.#userAgent.navigatorPlatform = config.platform;
    }
    if (config.languages !== undefined) {
      validateLanguageConfig(config.languages);
      // No globals exist yet, so configuration needs no languagechange recipients.
      this.#userAgent.setPreferredLanguages(config.languages, []);
    }
    this.#userAgent.reportDeliveryEnabled = config.reporting ?? true;
    if (config.authentication) this.#userAgent.httpAuthentication.onPrompt = config.authentication;
    if (config.permissionPrompt) this.#userAgent.onPermissionPrompt = config.permissionPrompt;
    if (config.permissionChooser) this.#userAgent.onPermissionChoice = config.permissionChooser;
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
    this.#evaluation = new PageEvaluation(this.#traversable);
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
    return this.#evaluation.evaluate(expression, argument);
  }

  /** Install an asynchronous page-to-host callback, including after navigation. */
  // eslint-disable-next-line no-restricted-syntax, @typescript-eslint/require-await -- Node-facing async API; installation is currently synchronous.
  async exposeFunction<Arguments extends unknown[], Result>(
    name: string, callback: (...args: Arguments) => Result,
  ): Promise<void> {
    const invoke = (args: unknown[]) => callback(...args as Arguments);
    this.#evaluation.exposeFunction(name, invoke);
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
    const documentURLRecord = this.#traversable.activeWindow!.env.parseURL(documentURL.href);
    if (documentURLRecord === null) {
      throw new InternalError(`Could not parse validated navigation URL ${documentURL.href}`);
    }
    const navigationParams = this.#traversable.createNavigationParamsFromSource(documentURLRecord);
    const historyHandling = this.#traversable.resolveHistoryBehavior(
      documentURLRecord,
      navigationParams.origin,
      'auto', navigationParams.userInvolvement,
    );
    const document = this.#traversable.createAndInitializeDocument(
      'html',
      'text/html',
      navigationParams,
    );
    // Document initialization has attached the Window selected for this navigation.
    const realm = document.getRelevantGlobalObject()!.env.realm;
    const historyEntry = this.#traversable.createHistoryEntry(document, navigationParams, source);
    // TODO(HTML §7.4 / §7.5): Connect outgoing unload/cache/destruction coordination.
    // This convenience path commits directly and retains replaced Documents.
    this.#traversable.finalizeCrossDocumentNavigation(
      historyHandling,
      navigationParams.userInvolvement,
      historyEntry,
    );

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
  /** Per-shelf storage budget in bytes, independent for each origin and local/session shelf. Defaults to 64 MiB. */
  storageQuotaBytes?: number;
  /** Complete CSS system-color palette; defaults to Stylelet's fixed light palette. */
  systemColors?: SystemColorPalette;
  /** Default User-Agent header value; defaults to Mozilla/5.0 (compatible; Browlet). */
  userAgent?: string;
  /** Navigator compatibility platform, independent of the host OS. Defaults to Win32. */
  platform?: string;
  /**
   * Ordered, nonempty list of valid BCP 47 tags for Navigator and Accept-Language.
   * Defaults to ["en-US"]. Copied without canonicalization; only basic tag shape is validated.
   */
  languages?: readonly string[];
  /** Allow outbound reports; false retains local ReportingObservers. Defaults to true. */
  reporting?: boolean;
  /** Answer HTTP authentication challenges; omitted prompts are declined. */
  authentication?: AuthenticationPrompt;
  /** Answer new permission requests; omitted prompts are denied. */
  permissionPrompt?: PermissionPrompt;
  /** Select from feature-provided options; omitted choosers deny selection. */
  permissionChooser?: PermissionChooser;
};

/** Check host-input shape; callers remain responsible for full BCP 47 validity. */
function validateLanguageConfig(languages: readonly string[]): asserts languages is readonly [string, ...string[]] {
  if (!Array.isArray(languages) || languages.length === 0) {
    // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
    throw new TypeError('languages must be a nonempty array of language tags');
  }
  for (const language of languages) {
    if (typeof language !== 'string' || !languageTagShapePattern.test(language) || !isHeaderValue(language)) {
      // eslint-disable-next-line no-restricted-globals -- This is validation of the Node-facing host API.
      throw new TypeError('languages must contain nonempty hyphen-separated ASCII language tags');
    }
  }
}

// RFC 4647 §2.1's basic language-range shape, excluding wildcard selection.
// This admits BCP 47 private-use/grandfathered tags without treating Intl's locale
// parser as a complete validator. Registry checks and canonicalization are not performed.
// https://www.rfc-editor.org/rfc/rfc4647.html#section-2.1
const languageTagShapePattern = /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i;
