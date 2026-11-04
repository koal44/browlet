import { asciiLower, assertNever, InternalError } from '../../../infra/index';
import { randomUUID } from '../../../js-engine/index';
import { DOMExceptionImpl } from '../../../web-idl/core/index';
import {
  aboutBlankURL, areSameOrigin, areSameOriginDomain, copyURL, createOpaqueOrigin, obtainURLOrigin,
  serializeURL, urlsEqual, type Origin, type URLRecord,
} from '../../../url/index';
import { StorageShed } from '../../../storage/index';
import type { FormDataEntry } from '../../../xhr/index';
import {
  FetchRequest, FetchResponse, isFetchScheme, type FetchPromptTarget, type fetchPromptTargetBrand, type ReferrerPolicy,
} from '../../../fetch/index';

import { coarsenedSharedCurrentTime } from '../../timing/index';
import type { EventLoop } from '../../scripting/index';
import type { PointerId } from '../../interaction/events/index';
import {
  EmbedderPolicy, OpenerPolicy, PermissionsPolicy, PolicyContainer, queueCOEPInheritanceViolation, SandboxingFlagSet,
} from '../policy/index';
import type { DocumentImpl, DocumentVisibilityState, ElementImpl } from '../../dom/nodes/index';
import {
  HTMLIFrameElementImpl, type HTMLEmbedElementImpl, type HTMLObjectElementImpl,
} from '../../dom/nodes/html/embedded/index';
import type { HTMLFrameElementImpl } from '../../dom/nodes/html/legacy/index';
import { CustomElementRegistryImpl } from '../../dom/nodes/html/custom-elements/index';
import type { NavigationTimingType } from '../../performance/index';
import {
  DocumentState, SourceSnapshotParams, type SessionHistoryEntry,
  type DocumentBackedState, type PostResource,
} from './state/index';
import type { NavigationAPIMethodTracker } from './api/index';
import type { WindowImpl, WindowProxyHandle } from '../window/index';
import { BrowletEnvironmentBase, type BrowletEnvironment } from '../../environment/index';
import { HTMLDocumentParser, type ScriptHandler } from '../../html/parser/index';
import type { SerializedRecord } from '../../scripting/structured-data/index';
import type { ResourceReader } from '../../loader/index';
import type { PointerEventStream } from '../../interaction/index';
import type { UserAgent } from '../../user-agent';

import { BrowsingContext } from './browsing-context';
import { NavigationParams, type TargetSnapshotParams } from './params';
import { SessionHistoryTraversalQueue, type SessionHistoryTraversalSteps } from './session-history-traversal-queue';

/** Owns a navigation destination and its current and active history entries. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#navigable
export class Navigable {
  /** Stable identity across this navigable's documents and browsing contexts. */
  id = Symbol('Navigable');
  /** Containing navigable, or null at the top level. */
  parent: Navigable | null;
  /** History entry selected by the latest navigation or traversal. */
  // TODO(HTML §7.4.1): Restrict mutation to the traversable's session history traversal queue.
  currentSessionHistoryEntry: SessionHistoryEntry;
  /** Whether closing this navigable has begun. */
  isClosing = false;
  /** Whether its navigation is delaying the container document's load event. */
  // TODO(HTML §7.4.2.3.1): Connect startup to queued finalizeCrossDocumentNavigation(), which releases this delay.
  isDelayingLoadEvents = false;
  /** Navigation UUID, "traversal" while applying history, or null when no navigation is ongoing. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#concept-navigate-mature
  // TODO(HTML §7.4.6): Connect history's direct assignments, distinct from setOngoingNavigation's abortion notification.
  ongoingNavigation: string | null = null;

  /** History entry supplying the active Document, independently of the current traversal entry. */
  // HTML permits mutation only on that Document's event loop; history application must preserve this ownership.
  #activeSessionHistoryEntry: SessionHistoryEntry;
  /** Element whose content navigable is this destination, or null while unassociated. */
  #container: NavigableContainer | null = null;

  /** Create the initial history entry and associate its Document with this navigable. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#initialize-the-navigable
  constructor(
    documentState: DocumentBackedState,
    parent: Navigable | null = null,
  ) {
    const document = documentState.document;
    const browsingContext = document.browsingContext;
    if (browsingContext === null) throw new InternalError('An active Document needs a browsing context');

    this.parent = parent;
    this.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, documentState);
    this.#activeSessionHistoryEntry = this.currentSessionHistoryEntry;
    browsingContext.setNavigable(this);
    // Traversables finish this after their own system visibility state is initialized.
    if (!(this instanceof Traversable)) {
      document.setInitialVisibilityState(this.traversable.systemVisibilityState);
      document.notifyFullyActiveStateChanged();
    }
  }

  /** Initialize a container's child and queue its insertion into the parent's retained history. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-nested-browsing-context
  static createChild(element: ElementImpl): void {
    // TODO(HTML §7.3.2.1): BrowsingContext.create() still models only iframe embedders.
    // Object/embed/legacy-frame loading must supply their context and policy inheritance too.
    if (!(element instanceof HTMLIFrameElementImpl)) {
      throw new InternalError('Object, embed, and frame child-context creation is not implemented');
    }
    const parentNavigable = element.getNodeNavigable();
    const creator = element.nodeDocument;
    const group = creator.browsingContext?.topLevelBrowsingContext?.group;
    if (parentNavigable === null || group === undefined || group === null) {
      throw new InternalError('Child creation needs an active parent browsing-context group');
    }
    const [, document] = BrowsingContext.create(creator, element, group);
    const documentState = DocumentState.create(document);
    documentState.initiatorOrigin = document.origin;
    documentState.origin = document.origin;
    // SPEC_CLASH(child-navigable-absent-name): HTML's creation steps use null; retain the string state's empty default, as browsers do.
    documentState.navigableTargetName = element.getAttributeNS(null, 'name') ?? '';
    documentState.aboutBaseURL = document.aboutBaseURL;
    const navigable = new Navigable(documentState, parentNavigable);
    element.contentNavigable = navigable;
    const historyEntry = navigable.activeSessionHistoryEntry;
    const traversable = parentNavigable.traversable;
    traversable.appendSessionHistoryTraversalSteps(() => {
      const parentDocState = parentNavigable.activeSessionHistoryEntry.documentState;
      const targetStepEntry = parentNavigable.getSessionHistoryEntries().find((entry) => entry.documentState === parentDocState);
      if (targetStepEntry === undefined || targetStepEntry.step === 'pending') {
        throw new InternalError('Child history creation needs the parent Document\'s first committed history step');
      }
      historyEntry.step = targetStepEntry.step;
      parentDocState.nestedHistories.push({ id: navigable.id, entries: [historyEntry] });
      traversable.updateForNavigableCreationOrDestruction();
    });
    // SPEC_CLASH(bidi-child-created-target): HTML names traversable; notify for the new child, as BiDi's event and iframe tests require.
    creator.env.userAgent.webDriverBiDiNavigableCreated(navigable);
  }

  /** Detach a container's child, start its teardown, and remove its nested history. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-child-navigable
  static destroyChild(container: NavigableContainer): void {
    const navigable = container.contentNavigable;
    if (navigable === null) return;
    const env = container.nodeDocument.env;
    container.contentNavigable = null;
    // TODO(HTML §7.5.10): Off-loop abortion is queued against this now-inactive Document; resolve delivery with teardown.
    navigable.informNavigationAPIAboutChildNavigableDestruction(env.responsibleEventLoop);
    const document = navigable.activeDocument;
    if (document === null) throw new InternalError('Child destruction requires an active Document');
    // TODO(HTML §7.5.10): Recursive teardown currently stops at its explicit dependency.
    document.destroyAndDescendants();
    const parentNavigable = container.getNodeNavigable();
    if (parentNavigable === null) throw new InternalError('Child destruction requires the container\'s node navigable');
    const histories = parentNavigable.activeSessionHistoryEntry.documentState.nestedHistories;
    const index = histories.findIndex((history) => history.id === navigable.id);
    if (index !== -1) histories.splice(index, 1);
    const traversable = parentNavigable.traversable;
    traversable.appendSessionHistoryTraversalSteps(() => { traversable.updateForNavigableCreationOrDestruction(); });
    env.userAgent.webDriverBiDiNavigableDestroyed(navigable);
  }

  /** Check beforeunload cancellation, optionally including the top-level traversal's navigate event. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#checking-if-unloading-is-canceled
  static checkIfUnloadingIsCanceled(
    _navigablesThatNeedBeforeUnload: Navigable[], _traversable?: Traversable,
    _targetStep?: number, _userInvolvementForNavigateEvent?: UserNavigationInvolvement,
  ): 'canceled-by-beforeunload' | 'canceled-by-navigate' | 'continue' {
    // TODO(HTML §7.4.2.4): Snapshot active Documents, queue beforeunload/navigate checks on their Windows,
    // coordinate the shared prompt state, and wait for all results. The optional traversal needs all three inputs.
    throw new InternalError('Unload cancellation checks are not implemented');
  }

  /** Check a target name's authoring syntax; this does not restrict runtime name assignment or lookup. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#valid-navigable-target-name
  static isValidTargetName(name: string): boolean {
    return name !== '' && !name.startsWith('_') && !(name.includes('<') && /[\t\n\r]/.test(name));
  }

  /** Accept a conforming target name or one of HTML's four case-insensitive target keywords. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#valid-navigable-target-name-or-keyword
  static isValidTargetNameOrKeyword(name: string): boolean {
    if (Navigable.isValidTargetName(name)) return true;
    switch (asciiLower(name)) {
      case '_blank': case '_self': case '_parent': case '_top': return true;
      default: return false;
    }
  }

  get isTopLevelTraversable(): boolean {
    return false;
  }

  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-target
  get targetName(): string {
    return this.activeSessionHistoryEntry.documentState.navigableTargetName;
  }

  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#script-closable
  get isScriptClosable(): boolean {
    return this instanceof TopLevelTraversable &&
      (this.isCreatedByWebContent || this.sessionHistoryEntries.length === 1);
  }

  /** Entry whose document is active; replacement updates document activity. */
  get activeSessionHistoryEntry(): SessionHistoryEntry {
    return this.#activeSessionHistoryEntry;
  }

  set activeSessionHistoryEntry(entry: SessionHistoryEntry) {
    const previousDocument = this.#activeSessionHistoryEntry.documentState.document;
    const document = entry.documentState.document;
    if (document !== null) {
      const browsingContext = document.browsingContext;
      if (browsingContext === null) throw new InternalError('An active Document needs a browsing context');
      browsingContext.setNavigable(this);
    }

    this.#activeSessionHistoryEntry = entry;
    if (previousDocument !== document) {
      for (const evaluation of previousDocument?.env.userAgent.pageEvaluations.get(this) ?? []) {
        evaluation.activeDocumentChanged();
      }
      previousDocument?.notifyFullyActiveStateChanged();
      document?.notifyFullyActiveStateChanged();
    }
  }

  get activeDocument(): DocumentImpl | null {
    return this.activeSessionHistoryEntry.documentState.document;
  }

  get activeBrowsingContext(): BrowsingContext | null {
    const document = this.activeDocument;
    if (document === null) return null;
    return document.browsingContext;
  }

  get activeWindow(): WindowImpl | null {
    return this.activeBrowsingContext?.activeWindow ?? null;
  }

  /** WindowProxy of this navigable's active document; requires an active browsing context. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-wp
  get activeWindowProxy(): WindowProxyHandle {
    const browsingContext = this.activeBrowsingContext;
    if (browsingContext === null) throw new InternalError('An active WindowProxy needs a browsing context');
    return browsingContext.windowProxy;
  }

  /** Nearest inclusive ancestor that owns session-history traversal. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-traversable
  get traversable(): Traversable {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Walk the inclusive ancestor chain.
    let navigable: Navigable = this;
    while (!(navigable instanceof Traversable)) {
      if (navigable.parent === null) throw new InternalError('A navigable needs a traversable ancestor');
      navigable = navigable.parent;
    }
    return navigable;
  }

  /** Outermost navigation destination, including across nested traversables. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-top
  get topLevelTraversable(): TopLevelTraversable {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Walk the inclusive ancestor chain.
    let navigable: Navigable = this;
    while (navigable.parent !== null) navigable = navigable.parent;
    if (!(navigable instanceof TopLevelTraversable)) throw new InternalError('A navigable needs a top-level traversable');
    return navigable;
  }

  /** The element embedding this navigable, or null when it has no container. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-container
  get container(): NavigableContainer | null {
    return this.#container;
  }

  /** Node document of the embedding element, or null without a container. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-container-document
  get containerDocument(): DocumentImpl | null {
    return this.container?.nodeDocument ?? null;
  }

  /** Update the reverse link and Document activity after a container sets its content navigable. */
  setContainer(container: NavigableContainer | null): void {
    if (this.#container === container) return;
    if (this.#container?.contentNavigable === this) this.#container.contentNavigable = null;
    this.#container = container;
    this.activeDocument?.notifyFullyActiveStateChanged();
  }

  /** Find this navigable's own history list, including a retained nested history. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-session-history-entries
  getSessionHistoryEntries(): SessionHistoryEntry[] {
    const traversable = this.traversable;
    // TODO(HTML §7.4.1.4): Enforce traversal-queue ownership after §7.4.2.3 replaces provisional synchronous commits.
    if (this instanceof Traversable) return this.sessionHistoryEntries;
    const documentStates = new Set<DocumentState>();
    for (const entry of traversable.sessionHistoryEntries) documentStates.add(entry.documentState);
    for (const state of documentStates) {
      for (const nested of state.nestedHistories) {
        if (nested.id === this.id) return nested.entries;
        for (const entry of nested.entries) documentStates.add(entry.documentState);
      }
    }
    throw new InternalError('The navigable has no retained session history');
  }

  /** Select the contiguous same-origin entries around the greatest step at or before the target. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-session-history-entries-for-the-navigation-api
  getSessionHistoryEntriesForNavigationAPI(targetStep: number): SessionHistoryEntry[] {
    const entries = this.getSessionHistoryEntries();
    let startingIndex = -1;
    let startingStep = -1;
    for (let i = 0; i < entries.length; i++) {
      const step = entries[i]!.step;
      if (step === 'pending') throw new InternalError('Navigation API entries require committed history steps');
      if (step <= targetStep && step > startingStep) {
        startingIndex = i;
        startingStep = step;
      }
    }
    if (startingIndex === -1) throw new InternalError('The target history step has no entry');
    const origin = entries[startingIndex]!.documentState.origin;
    if (origin === null) throw new InternalError('The target history entry has no origin');
    let first = startingIndex;
    let end = startingIndex + 1;
    // SPEC_CLASH(navigation-entry-zero): Include index 0 as all browsers and HTML's contiguous-entry prose require; its loop says i > 0.
    while (first > 0) {
      const previousOrigin = entries[first - 1]!.documentState.origin;
      if (previousOrigin === null || !areSameOrigin(previousOrigin, origin)) break;
      first--;
    }
    while (end < entries.length) {
      const nextOrigin = entries[end]!.documentState.origin;
      if (nextOrigin === null || !areSameOrigin(nextOrigin, origin)) break;
      end++;
    }
    return entries.slice(first, end);
  }

  /** Find an existing named target within this traversable, then among familiar contexts in its group. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#find-a-navigable-by-target-name
  findNavigableByTargetName(name: string): Navigable | null {
    const currentDocument = this.activeDocument;
    if (currentDocument === null) throw new InternalError('Named-target lookup requires an active Document');
    const sourceSnapshotParams = new SourceSnapshotParams(currentDocument);
    // SPEC_CLASH(named-target-subtree-order): Search self's subtree then the traversable, as Chromium/WebKit do; Firefox searches each ancestor.
    for (const subtree of [this, this.traversable]) {
      const document = subtree.activeDocument;
      if (document === null) throw new InternalError('Named-target lookup requires active subtree Documents');
      for (const navigable of document.getInclusiveDescendantNavigables()) {
        // SPEC_CLASH(named-target-sandbox-filter): Apply HTML's optional sandbox filter; browsers disagree on blocked-name handling.
        if (!this.isAllowedBySandboxingToNavigate(navigable, sourceSnapshotParams)) continue;
        if (navigable.targetName === name) return navigable;
      }
    }

    const currentBrowsingContext = this.activeBrowsingContext;
    const currentTopLevelBrowsingContext = currentBrowsingContext?.topLevelBrowsingContext ?? null;
    const group = currentTopLevelBrowsingContext?.group ?? null;
    if (currentBrowsingContext === null || group === null) {
      throw new InternalError('Named-target lookup requires an active browsing-context group');
    }
    // SPEC_CLASH(named-target-group-order): Use oldest registration first; Chromium prefers newer contexts, unlike tested Firefox/WebKit.
    for (const topLevelBrowsingContext of group.browsingContextSet) {
      if (topLevelBrowsingContext === currentTopLevelBrowsingContext) continue;
      const document = topLevelBrowsingContext.activeDocument;
      if (document === null) continue;
      for (const navigable of document.getInclusiveDescendantNavigables()) {
        const browsingContext = navigable.activeBrowsingContext;
        if (browsingContext === null) throw new InternalError('Named targets require an active browsing context');
        if (!currentBrowsingContext.isFamiliarForNamedLookup(browsingContext)) continue;
        if (!this.isAllowedBySandboxingToNavigate(navigable, sourceSnapshotParams)) continue;
        if (navigable.targetName === name) return navigable;
      }
    }
    return null;
  }

  /** Select an existing target or apply browser policy and create a new top-level destination. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#the-rules-for-choosing-a-navigable
  chooseNavigable(name: string, noopener: boolean): [navigable: Navigable | null, windowType: WindowType] {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Target selection requires an active Document');
    const sandboxingFlagSet = document.activeSandboxingFlagSet;
    const keyword = asciiLower(name);
    if (name === '' || keyword === '_self') return [this, 'existing-or-none'];
    if (keyword === '_parent') return [this.parent ?? this, 'existing-or-none'];
    if (keyword === '_top') return [this.traversable, 'existing-or-none'];
    if (keyword !== '_blank') {
      const chosen = this.findNavigableByTargetName(name);
      if (chosen !== null) return [chosen, 'existing-or-none'];
    }
    const userAgent = document.env.userAgent;
    const window = this.activeWindow;
    if (window === null) throw new InternalError('New-target selection requires an active Window');
    // Optional blocked-popup UI and console reporting are not enabled.
    if (userAgent.popupBlockerEnabled && !window.hasTransientActivation()) return [null, 'existing-or-none'];
    // SPEC_CLASH(new-target-sandbox-rejection): Return null as HTML/Chromium/WebKit do; Firefox throws InvalidAccessError.
    if (sandboxingFlagSet.has('sandboxed-auxiliary-navigation')) return [null, 'existing-or-none'];
    switch (userAgent.newNavigablePolicy) {
      case 'current': return [this, 'existing-or-none'];
      case 'none': return [null, 'existing-or-none'];
      case 'new': break;
      default: assertNever(userAgent.newNavigablePolicy);
    }

    window.consumeUserActivation();
    let windowType: WindowType = 'new-and-unrestricted';
    // SPEC_CLASH(noopener-new-target-name): Preserve non-blank names as HTML/Chromium/Firefox do; WebKit clears them for noopener.
    let targetName = keyword === '_blank' ? '' : name;
    if (document.openerPolicy.value === 'same-origin' || document.openerPolicy.value === 'same-origin-plus-COEP') {
      const topLevelOrigin = document.env.topLevelOrigin;
      if (topLevelOrigin === null) throw new InternalError('Window target selection requires a top-level origin');
      if (!areSameOrigin(document.origin, topLevelOrigin)) {
        noopener = true;
        targetName = '';
        windowType = 'new-with-no-opener';
      }
    }

    const opener = noopener ? null : this.activeBrowsingContext;
    if (!noopener && opener === null) throw new InternalError('A new auxiliary target requires an opener context');
    const chosen = TopLevelTraversable.create(userAgent, opener, targetName, this);
    const browsingContext = chosen.activeBrowsingContext;
    if (browsingContext === null) throw new InternalError('A new target requires an active browsing context');
    if (!noopener && sandboxingFlagSet.has('sandboxed-navigation')) {
      browsingContext.onePermittedSandboxedNavigator = opener;
    }
    if (sandboxingFlagSet.has('sandbox-propagates-to-auxiliary-browsing-contexts')) {
      for (const flag of sandboxingFlagSet) browsingContext.popupSandboxingFlagSet.add(flag);
    }
    chosen.isCreatedByWebContent = true;
    return [chosen, windowType];
  }

  /** Check navigation permission against the initiating Document's captured sandbox state. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#allowed-to-navigate
  isAllowedBySandboxingToNavigate(_target: Navigable, _sourceSnapshotParams: SourceSnapshotParams): boolean {
    // TODO(HTML §7.4.2.4): Apply self/ancestor relationships, activation-dependent top navigation,
    // and the target browsing context's one permitted sandboxed navigator.
    throw new InternalError('Sandbox navigation permission is not implemented');
  }

  /** Navigate from source admission through Document population and queued history finalization. */
  // env supplies the executing Agent; null denotes host/parallel work without a surrounding HTML Agent.
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate
  navigate(
    url: URLRecord, sourceDocument: DocumentImpl | null = null,
    options: NavigateOptions = {}, env: BrowletEnvironment | null = null,
  ): void {
    // Capture the source state and check its permission to navigate this destination.
    const cspNavigationType = (options.formDataEntryList ?? null) === null ? 'other' : 'form-submission';
    const sourceSnapshotParams = new SourceSnapshotParams(sourceDocument);
    let initiatorOriginSnapshot: Origin = createOpaqueOrigin();
    let initiatorBaseURLSnapshot = copyURL(aboutBlankURL);
    if (sourceDocument === null) {
      if (options.userInvolvement !== 'browser UI') throw new InternalError('Sourceless navigation requires browser UI involvement');
      if (url.scheme === 'javascript') {
        const document = this.activeDocument;
        if (document === null) throw new InternalError('Navigation requires an active Document');
        initiatorOriginSnapshot = document.origin;
      }
    } else {
      if (options.userInvolvement === 'browser UI') throw new InternalError('Document-initiated navigation cannot have browser UI involvement');
      const sourceNavigable = sourceDocument.getNodeNavigable();
      if (sourceNavigable === null) throw new InternalError('Navigation requires the source Document\'s node navigable');
      if (!sourceNavigable.isAllowedBySandboxingToNavigate(this, sourceSnapshotParams)) {
        if (options.exceptionsEnabled === true) throw new DOMExceptionImpl('Sandboxing prevents navigation', 'SecurityError');
        return;
      }
      initiatorOriginSnapshot = sourceDocument.origin;
      initiatorBaseURLSnapshot = sourceDocument.getBaseURL();
    }
    options = { ...options };
    const navigationId = randomUUID();
    const targetEnv = this.activeDocument?.env;
    if (targetEnv === undefined) throw new InternalError('Navigation requires an active Document');

    // These steps read live target state, on its Agent after the source snapshots above.
    const steps = () => {
      let document = this.activeDocument;
      if (document === null) throw new InternalError('Navigation requires an active Document');
      const userAgent = document.env.userAgent;
      if (document.unloadCounter > 0) {
        userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
        return;
      }
      const container = this.container;
      if (container instanceof HTMLIFrameElementImpl && container.willLazyLoad()) {
        container.nodeDocument.stopObservingLazyLoadingElement(container);
        container.lazyLoadResumptionSteps = null;
      }
      if (this.isNavigationOrHistoryUpdateBlocked()) {
        userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
        return;
      }
      // Select history handling and take the same-document fragment path when applicable.
      const userInvolvement = options.userInvolvement ?? 'none';
      const historyHandling = this.resolveHistoryBehavior(url, initiatorOriginSnapshot, options.historyHandling, userInvolvement);
      const { documentResource = null, response = null } = options;
      if (
        documentResource === null && response === null &&
        urlsEqual(url, this.activeSessionHistoryEntry.url, true) && url.fragment !== null
      ) {
        this.navigateToFragment(
          url, historyHandling, userInvolvement, options.sourceElement ?? null,
          options.navigationAPIState ?? null, navigationId,
        );
        return;
      }
      // Capture target policy before replacing the ongoing navigation and notifying author code.
      if (this.parent !== null) this.isDelayingLoadEvents = true;
      const targetSnapshotParams = this.snapshotTargetParams();
      userAgent.webDriverBiDiNavigationStarted(this, { id: navigationId, status: 'pending', url });
      if (this.ongoingNavigation === 'traversal') {
        userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
        return;
      }
      this.setOngoingNavigation(navigationId, document.env);

      if (url.scheme === 'javascript') {
        const activeEnv = this.activeWindow?.env;
        if (activeEnv === undefined) throw new InternalError('JavaScript URL navigation requires an active Window');
        // CSP consumes a synthetic request; this path never sends it to Fetch.
        const request: NavigationRequest = Object.assign(new FetchRequest(url, activeEnv), {
          client: sourceSnapshotParams.fetchClient, policyContainer: sourceSnapshotParams.sourcePolicyContainer,
        });
        activeEnv.queueTask('navigation-and-traversal', () => this.navigateToJavaScriptURL(
          request, historyHandling, initiatorOriginSnapshot, userInvolvement,
          cspNavigationType, options.initialInsertion ?? false, navigationId, targetSnapshotParams,
        ));
        return;
      }

      // Aborting the previous navigation can change the active Document.
      document = this.activeDocument;
      if (document === null) throw new InternalError('Navigation requires an active Document');
      // SPEC_CLASH(navigate-event-top-level-data): Follow HTML/Firefox/WebKit's fetch-scheme gate;
      // Chromium separately blocks page-initiated top-level data: loads before navigate-event dispatch.
      if (
        userInvolvement !== 'browser UI' && areSameOriginDomain(document.origin, sourceDocument!.origin) &&
        !document.isInitialAboutBlank && isFetchScheme(url.scheme)
      ) {
        const navigation = this.activeWindow!.navigation;
        const entryListForFiring = documentResource !== null && typeof documentResource !== 'string'
          ? options.formDataEntryList ?? null : null;
        const shouldContinue = navigation.firePushReplaceReloadNavigateEvent(historyHandling, url, false, {
          userInvolvement, sourceElement: options.sourceElement ?? null, formDataEntryList: entryListForFiring,
          navigationAPIState: options.navigationAPIState ?? navigation.env.serializeForStorage(undefined),
          apiMethodTracker: options.apiMethodTracker ?? null,
        });
        if (!shouldContinue) return;
      }
      const currentContainer = this.container;
      // SPEC_GAP(deferred-fetch-null-container): Browser-UI top-level navigation has neither
      // a source Document nor a container Document; their equality cannot reserve on a null container.
      if (currentContainer !== null && sourceDocument === currentContainer.nodeDocument) {
        currentContainer.reserveDeferredFetchQuota(obtainURLOrigin(url));
      }

      // In parallel, check unloading and populate an entry before queued history finalization.
      document.env.userAgent.runInParallel(() => {
        const activeDocument = this.activeDocument;
        if (activeDocument === null) throw new InternalError('Navigation requires an active Document');
        // TODO(HTML §7.4.2.4): This owner still throws; its eventual cross-loop wait must resume these parallel steps.
        const unloadPromptCanceled = Navigable.checkIfUnloadingIsCanceled(activeDocument.getInclusiveDescendantNavigables());
        if (unloadPromptCanceled !== 'continue' || this.ongoingNavigation !== navigationId) {
          activeDocument.env.userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
          return;
        }
        const activeEnv = this.activeWindow?.env;
        if (activeEnv === undefined) throw new InternalError('Navigation requires an active Window');
        activeEnv.queueTask('navigation-and-traversal', () => {
          const documentToAbort = this.activeDocument;
          if (documentToAbort === null) throw new InternalError('Navigation abortion requires an active Document');
          documentToAbort.abortAndDescendants();
        });
        const documentState = DocumentState.createForNavigation(
          url, initiatorOriginSnapshot, initiatorBaseURLSnapshot,
          options.referrerPolicy ?? '', documentResource, this.targetName,
        );
        const historyEntry = activeEnv.createSessionHistoryEntry(url, documentState);
        const navigationParams = response === null ? null : NavigationParams.fromSuppliedResponse(
          response, this, sourceDocument, targetSnapshotParams, documentState,
          navigationId, userInvolvement, activeEnv,
        );
        this.populateHistoryEntryDocument(historyEntry, 'navigate', sourceSnapshotParams, targetSnapshotParams, userInvolvement, {
          navigationId, navigationParams, cspNavigationType, allowPOST: true,
          completionSteps: () => {
            this.traversable.appendSessionHistoryTraversalSteps(() => {
              // TODO(HTML §7.4.2.3.1/§7.4.6): The finalizer still needs nested history and complete history application.
              this.finalizeCrossDocumentNavigation(historyHandling, userInvolvement, historyEntry);
            });
          },
        });
      });
    };

    if (env?.realm.agent === targetEnv.realm.agent) steps();
    else targetEnv.queueTask('navigation-and-traversal', steps);
  }

  /** Populate a pending entry in parallel, then run its completion steps without committing it here. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#attempt-to-populate-the-history-entry's-document
  // SPEC_MISMATCH: attempt to populate the history entry's document(entry, navigable, navTimingType, sourceSnapshotParams, targetSnapshotParams, userInvolvement, navigationId = null, navigationParams = null, cspNavigationType = "other", allowPOST = false, completionSteps = empty)
  populateHistoryEntryDocument(
    _entry: SessionHistoryEntry, _navigationTimingType: NavigationTimingType,
    _sourceSnapshotParams: SourceSnapshotParams, _targetSnapshotParams: TargetSnapshotParams,
    _userInvolvement: UserNavigationInvolvement, _options: PopulateHistoryEntryOptions = {},
  ): void {
    // TODO(HTML §7.4.5): Select srcdoc, Fetch, external-protocol, or error processing; preserve POST bytes across retries.
    // Recheck the navigation ID, enforce response/frame policies, and leave the Document null for downloads/204/205.
    // Document creation and completion must return through the specified task and history-queue boundaries.
    throw new InternalError('Session-history entry Document population is not implemented');
  }

  /** Evaluate a queued javascript: request after checking the source policy and live destination. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-to-a-javascript:-url
  navigateToJavaScriptURL(
    _request: NavigationRequest, _historyHandling: HistoryHandlingBehavior, _initiatorOrigin: Origin,
    _userInvolvement: UserNavigationInvolvement, _cspNavigationType: 'form-submission' | 'other',
    _initialInsertion: boolean, _navigationId: string, _targetSnapshotParams: TargetSnapshotParams,
  ): void {
    // TODO(HTML §7.4.2.3.2): Evaluate javascript: URLs with CSP and Trusted Types, then replace history.
    throw new InternalError('JavaScript URL navigation is not implemented');
  }

  /** Run a URL as a classic script; only a normal string completion produces a replacement Document. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#evaluate-a-javascript:-url
  evaluateJavaScriptURL(
    _url: URLRecord, _newDocumentOrigin: Origin, _userInvolvement: UserNavigationInvolvement, _navigationId: string,
    _targetSnapshotParams: TargetSnapshotParams,
  ): DocumentImpl | null {
    // TODO(HTML §7.4.2.3.2): Evaluate javascript: URLs with CSP and Trusted Types, then replace history.
    throw new InternalError('JavaScript URL navigation is not implemented');
  }

  /** Update same-document history, navigate-event state, and scrolling for a fragment destination. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-fragid
  navigateToFragment(
    _url: URLRecord, _historyHandling: HistoryHandlingBehavior, _userInvolvement: UserNavigationInvolvement,
    _sourceElement: ElementImpl | null, _navigationAPIState: SerializedRecord | null, _navigationId: string,
  ): void {
    // TODO(HTML §7.4.2.3.3): Fire the navigate event, handle interception/cancellation, update the entry,
    // and coordinate synchronous history application and fragment scrolling. This must not enter the document loader.
    throw new InternalError('Fragment navigation is not implemented');
  }

  /** Reload this destination after its cancelable navigate event and through the traversal queue. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#reload
  // SPEC_MISMATCH: reload(navigable, navigationAPIState = null, userInvolvement = "none", apiMethodTracker = null)
  reload(_options: ReloadOptions = {}): void {
    // TODO(HTML 7.2.6, 7.4): Supply Navigation API state/event cancellation, then
    // set reloadPending and queue the reload history step and tracker settlement.
    throw new InternalError('Navigable reload coordination is not implemented');
  }

  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#nav-stop
  stopLoading(): void {
    // TODO: Respect the active Document's unload counter, cancel ongoing navigation
    // without stopping traversal, then abort the Document and its descendants.
    throw new InternalError('Navigation stopping and descendant abortion are not implemented');
  }

  /** Notify Navigation before changing the ongoing request; null env denotes host/parallel work. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#set-the-ongoing-navigation
  setOngoingNavigation(newValue: string | null, env: BrowletEnvironment | null = null): void {
    if (this.ongoingNavigation === newValue) return;
    this.informNavigationAPIAboutAbortingNavigation(env?.responsibleEventLoop ?? null);
    this.ongoingNavigation = newValue;
  }

  /** Notify on the active Window's loop; null means the caller is running in parallel. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#inform-the-navigation-api-about-aborting-navigation
  // SPEC_MISMATCH: inform the navigation API about aborting navigation(navigable)
  // TODO(navigation-abort-caller-loop): Revisit the parameter when real callers establish their Document/environment handoff.
  informNavigationAPIAboutAbortingNavigation(callerEventLoop: EventLoop | null): void {
    const window = this.activeWindow;
    if (window === null) throw new InternalError('Navigation abortion requires an active Window');
    const abort = () => {
      // Select Navigation when the steps run, then keep that owner through reentrant callbacks.
      const navigation = this.activeWindow?.navigation;
      if (navigation === undefined) throw new InternalError('Navigation abortion requires an active Window');
      while (navigation.ongoingNavigateEvent !== null) navigation.abortOngoingNavigation();
    };
    if (callerEventLoop === window.env.responsibleEventLoop) abort();
    else window.env.queueTask('navigation-and-traversal', abort);
  }

  /** Notify abortion, then reject the pending traversal requests for the selected child Window. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#inform-the-navigation-api-about-child-navigable-destruction
  // SPEC_MISMATCH: inform the navigation API about child navigable destruction(navigable)
  // TODO(navigation-abort-caller-loop): destroyChild supplies the container's Document loop; revisit when removal and teardown run end to end.
  informNavigationAPIAboutChildNavigableDestruction(callerEventLoop: EventLoop | null): void {
    this.informNavigationAPIAboutAbortingNavigation(callerEventLoop);
    const navigation = this.activeWindow?.navigation;
    if (navigation === undefined) throw new InternalError('Child destruction notification requires an active Window');
    // HTML queues only the abortion notification when called from another loop.
    const trackers = [...navigation.upcomingTraverseAPIMethodTrackers.values()];
    for (const tracker of trackers) tracker.rejectFinished(new navigation.env.DOMException('', 'AbortError'));
  }

  /** Implementation-defined navigation throttling; Browlet currently permits every request. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#allowed-to-perform-a-navigation-or-history-update
  isNavigationOrHistoryUpdateBlocked(): boolean {
    // Sandbox navigation permission is a separate check in navigation/history application.
    return false;
  }

  /** Check child-response isolation against the embedding document's enforced and report-only policies. */
  // https://html.spec.whatwg.org/multipage/browsers.html#check-a-navigation-response's-adherence-to-its-embedder-policy
  checkResponseEmbedderPolicy(response: FetchResponse, responsePolicy: EmbedderPolicy): boolean {
    if (this.parent === null) return true;
    const document = this.containerDocument;
    if (document === null) throw new InternalError('Child navigation requires a container document');
    const parentPolicy = document.policyContainer.embedderPolicy;
    const compatible = EmbedderPolicy.isCompatibleWithCrossOriginIsolation(responsePolicy.value);
    if (EmbedderPolicy.isCompatibleWithCrossOriginIsolation(parentPolicy.reportOnlyValue) && !compatible) {
      queueCOEPInheritanceViolation(response, 'navigation', parentPolicy.reportOnlyReportingEndpoint, 'reporting', document.env);
    }
    if (!EmbedderPolicy.isCompatibleWithCrossOriginIsolation(parentPolicy.value) || compatible) return true;
    queueCOEPInheritanceViolation(response, 'navigation', parentPolicy.reportingEndpoint, 'enforce', document.env);
    return false;
  }

  /** Capture the target's sandbox restrictions and iframe referrer policy before navigation proceeds. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#snapshotting-target-snapshot-params
  snapshotTargetParams(): TargetSnapshotParams {
    const context = this.activeBrowsingContext;
    if (context === null) throw new InternalError('Target snapshot requires an active browsing context');
    const container = this.container;
    // TODO(HTML child navigation): Resolve sandbox inheritance for object/embed/frame; §7.1.5 refers to their nonexistent iframe flag set.
    if (container !== null && !(container instanceof HTMLIFrameElementImpl)) {
      throw new InternalError('Object, embed, and frame navigation sandboxing is not implemented');
    }
    return {
      sandboxingFlags: context.determineCreationSandboxingFlags(container),
      iframeReferrerPolicy: HTMLIFrameElementImpl.determineReferrerPolicy(container),
    };
  }

  /** Prepare response policies using target restrictions captured before loading, or at local-route entry. */
  createNavigationParams(response: FetchResponse, targetSnapshotParams = this.snapshotTargetParams()): NavigationParams {
    const context = this.activeBrowsingContext;
    if (context === null) throw new InternalError('Navigation requires an active browsing context');
    const env = context.activeWindow.env;
    const params = new NavigationParams(
      response,
      new SandboxingFlagSet(targetSnapshotParams.sandboxingFlags),
      coarsenedSharedCurrentTime(env.crossOriginIsolatedCapability).milliseconds,
    );
    // COEP needs the reserved environment's security decision after origin selection.
    params.policyContainer = env.userAgent.createPolicyContainerFromResponse(response, null);
    for (const flag of params.policyContainer.cspList?.getSandboxingFlags() ?? []) params.finalSandboxingFlagSet.add(flag);
    if (params.finalSandboxingFlagSet.has('sandboxed-origin')) params.origin = createOpaqueOrigin();
    params.iframeReferrerPolicy = targetSnapshotParams.iframeReferrerPolicy;
    return params;
  }

  /** Prepare the response metadata for Browlet's synchronous source route. */
  createNavigationParamsFromSource(url: URLRecord): NavigationParams {
    const response = new FetchResponse();
    response.urlList.push(url);
    // The local route supplies text directly to the parser and session history;
    // it does not create a Fetch body stream in the departing document's realm.
    return this.createNavigationParams(response);
  }

  /**
   * Create an HTML document after handler selection and start consuming its response.
   * The current byte-loading path requires the reader whose MIME type selected this handler
   * and a script callback; production setup for the one-argument call remains unfinished.
   */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html
  loadHTMLDocument(
    params: NavigationParams, handleScript?: ScriptHandler, resource?: ResourceReader,
  ): DocumentImpl {
    if (handleScript === undefined || resource === undefined) {
      // TODO(HTML §7.5.2/§4.12.1): Select/reuse the response reader, supply parser script preparation,
      // and honor scripts-may-run while history activation is pending. Synthetic params also need
      // the null reserved-environment path audited before creating a Window/Document.
      throw new InternalError('HTML document loading requires response-reader setup and parser script preparation');
    }
    const document = this.createAndInitializeDocument('html', 'text/html', params);
    // SPEC_CLASH(javascript-about-blank-body): All three browsers parse string-result bodies at
    // about:blank; HTML's blanket branch discards them. Resolve before enabling the synthetic-response caller.
    if (document.URL === 'about:blank') {
      document.populateWithHTMLHeadBody();
      return document;
    }

    const { env } = document;
    const parser = new HTMLDocumentParser(
      document,
      (element, write) => document.waitForScriptsMayRun().then(() => handleScript(element, write)),
    );
    // PROVISIONAL(HTML bytes): BOM/transport decoding works; full encoding
    // selection and replay for restart remain with the parser integration.
    const parsing = parser.parseBytes(
      resource,
      () => document.processLinkHeaders(params.response, 'media'),
    );
    parsing.observe(
      () => env.queueTask('network', () => {
        document.finishLoading();
      }),
      () => env.queueTask('network', () => {
        document.abort();
      }),
    );
    return document;
  }

  /** Select the Window and realm, then create the document for a navigation response. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object
  createAndInitializeDocument(
    type: 'html' | 'xml', contentType: string, params: NavigationParams,
  ): DocumentImpl {
    const { response } = params;
    this.#prepareResponsePolicy(params);
    if (!this.checkResponseEmbedderPolicy(response, params.policyContainer.embedderPolicy)) {
      // TODO: Fetch navigation must replace the blocked response with a network error.
      throw new InternalError('COEP-blocked navigation requires network-error processing');
    }
    const browsingContext = BrowsingContext.obtainForNavigation(this, params);
    const permissionsPolicy = PermissionsPolicy.fromResponse(this.container, params.origin, response);
    // https://w3c.github.io/webappsec-permissions-policy/#changes-to-html
    const reportOnlyPermissionsPolicy = PermissionsPolicy.fromResponse(this.container, params.origin, response, true);
    const creationURL = params.request?.currentURL ?? params.url;
    const activeDocument = browsingContext.activeDocument;
    if (activeDocument === null) throw new InternalError('Document creation requires an active browsing context');

    let window: WindowImpl;
    if (activeDocument.isInitialAboutBlank && areSameOriginDomain(activeDocument.origin, params.origin)) {
      window = browsingContext.activeWindow;
    } else {
      const group = this.parent === null ? browsingContext.group : this.topLevelTraversable.activeBrowsingContext?.group;
      if (group === undefined || group === null) throw new InternalError('Navigation browsing context has no group');
      const parent = this.parent?.activeWindow ?? null;
      const isSecureContext = params.reservedEnv!.isSecureContext;
      const agent = group.obtainSimilarOriginWindowAgent(
        params.origin, params.requestsOriginAgentCluster() && isSecureContext,
      );
      window = group.userAgent.createWindowEnvironment({
        agent, userAgent: group.userAgent,
        creationURL,
        origin: params.origin,
        parent,
        topLevelCreationURL: creationURL,
        topLevelOrigin: params.origin,
        reservedEnv: params.reservedEnv,
        previousRealm: browsingContext.activeWindow.env.realm,
      }).window;
    }

    const document = window.env.createDocument();
    document.type = type;
    document.contentType = contentType;
    document.origin = params.origin;
    document.browsingContext = browsingContext;
    document.policyContainer = params.policyContainer;
    document.permissionsPolicyState = permissionsPolicy;
    document.reportOnlyPermissionsPolicyState = reportOnlyPermissionsPolicy;
    document.setActiveSandboxingFlagSet(params.finalSandboxingFlagSet);
    document.openerPolicy = params.openerPolicy;
    document.initializeLoadTimingInfo(params.startTime);
    document.wasCreatedViaCrossOriginRedirects = response.redirectTaint !== 'same-origin';
    document.duringLoadingNavigationID = params.id;
    document.url = creationURL;
    document.currentDocumentReadiness = 'loading';
    document.aboutBaseURL = params.aboutBaseURL;
    document.cookieURL = copyURL(params.cookieURL);
    document.allowDeclarativeShadowRoots = true;
    document.customElementRegistry = new CustomElementRegistryImpl();

    window.setAssociatedDocument(document);
    document.initializeAncestry(params.iframeReferrerPolicy, this.containerDocument);
    document.initializeInsecureRequestsPolicy();
    document.initializeCSP();
    document.initializeReferrer(params.request);
    document.createNavigationTimingEntry(params);
    document.initializeResponseMetadata(response);
    document.processDefaultStyleHeaders(response);
    window.env.getWindowOrWorkerGlobalScopeMixin().initializeReportingEndpoints(response);

    // https://html.spec.whatwg.org/multipage/semantics.html#shared-declarative-refresh-steps
    if (response.headerList.get('Refresh') !== null) {
      throw new InternalError('Refresh response processing is not implemented');
    }
    params.commitEarlyHints?.(document);
    // CSSOM stylesheet relations are processed once, independently of HTML's two Link phases.
    document.processStyleSheetLinkHeaders(response);
    document.processLinkHeaders(response, 'pre-media');
    // https://html.spec.whatwg.org/multipage/speculative-loading.html#process-the-speculation-rules-header
    if (this.isTopLevelTraversable && response.headerList.get('Speculation-Rules') !== null) {
      throw new InternalError('Speculation-Rules response processing is not implemented');
    }
    document.potentiallyFreeDeferredFetchQuota();
    return document;
  }

  /** Retain the new document and the navigation data needed to restore it. */
  createHistoryEntry(
    document: DocumentImpl, params: NavigationParams, source: string | null = null,
  ): SessionHistoryEntry {
    const activeState = this.activeSessionHistoryEntry.documentState;
    const documentState = DocumentState.create(document);
    documentState.initiatorOrigin = null;
    documentState.origin = params.origin;
    // TODO(HTML 7.4): Retain the source snapshot's request referrer/policy through Fetch navigation.
    // NavigationHistoryEntry.url consumes that request policy, not the destination's response policy.
    documentState.aboutBaseURL = params.aboutBaseURL;
    documentState.resource = source;
    if (PolicyContainer.requiresStorageInHistory(params.url)) {
      documentState.historyPolicyContainer = params.policyContainer;
    }
    documentState.everPopulated = true;
    documentState.navigableTargetName = activeState.navigableTargetName;
    return document.env.createSessionHistoryEntry(document.url, documentState);
  }

  /** Choose whether navigation appends a history entry or replaces the active one. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-convert-to-replace
  // Extracts navigate's automatic-history resolution and mandatory replacement steps.
  resolveHistoryBehavior(
    url: URLRecord, initiatorOrigin: Origin,
    historyHandling: NavigationHistoryBehavior = 'auto', userInvolvement: UserNavigationInvolvement = 'none',
  ): HistoryHandlingBehavior {
    const activeDocument = this.activeDocument;
    if (activeDocument === null) {
      throw new InternalError('Navigation requires an active Document');
    }

    if (historyHandling === 'auto') {
      historyHandling = urlsEqual(url, activeDocument.url) &&
        (userInvolvement === 'browser UI' || areSameOrigin(initiatorOrigin, activeDocument.origin))
        ? 'replace'
        : 'push';
    }

    if (activeDocument.navigationMustBeReplace(url)) historyHandling = 'replace';
    return historyHandling;
  }

  /** Commit a new document by pushing or replacing this navigable's history entry. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation
  // PROVISIONAL: commits run synchronously until §7.4.2.3 connects them to the traversal queue and full history application.
  finalizeCrossDocumentNavigation(
    historyHandling: HistoryHandlingBehavior,
    userInvolvement: UserNavigationInvolvement,
    historyEntry: SessionHistoryEntry,
  ): void {
    this.isDelayingLoadEvents = false;
    const document = historyEntry.documentState.document;
    if (document === null) return;
    const activeDocument = this.activeDocument;
    if (activeDocument === null) {
      throw new InternalError('Navigation requires an active Document');
    }

    const browsingContext = document.browsingContext;
    if (browsingContext === null) {
      throw new InternalError('Navigation Document has no browsing context');
    }
    if (
      this.parent === null &&
      !(
        browsingContext.isAuxiliary &&
        browsingContext.openerBrowsingContext !== null
      ) &&
      !areSameOrigin(document.origin, activeDocument.origin)
    ) {
      historyEntry.documentState.navigableTargetName = '';
    }

    const traversable = requireTopLevelTraversable(this);
    const targetEntries = traversable.sessionHistoryEntries;
    let targetStep: number;
    if (historyHandling === 'push') {
      traversable.clearForwardSessionHistory();
      targetStep = traversable.currentSessionHistoryStep + 1;
      historyEntry.step = targetStep;
      targetEntries.push(historyEntry);
    } else {
      const entryToReplace = this.activeSessionHistoryEntry;
      const index = targetEntries.indexOf(entryToReplace);
      if (index < 0) {
        throw new InternalError('Active history entry is not in session history');
      }
      targetEntries[index] = historyEntry;
      historyEntry.step = entryToReplace.step;
      historyEntry.navigationAPIKey = entryToReplace.navigationAPIKey;
      targetStep = traversable.currentSessionHistoryStep;
    }

    const previousEntryForActivation = this.activeSessionHistoryEntry;
    traversable.applyPushOrReplaceHistoryStep(this, targetStep, historyEntry);
    document.getRelevantGlobalObject()!.navigation.updateActivation(historyHandling, previousEntryForActivation);
    void userInvolvement;
  }

  /** Complete the provisional local loader's reserved environment and response policies. */
  // TODO(HTML §7.4.5/§7.5.1): Remove this late preparation once params producers, including Browlet's local route,
  // supply complete inputs and Document creation preserves intentionally null reserved environments.
  #prepareResponsePolicy(params: NavigationParams): void {
    const browsingContext = this.activeBrowsingContext;
    if (browsingContext === null) throw new InternalError('Navigation requires an active browsing context');
    const activeDocument = browsingContext.activeDocument;
    if (activeDocument === null) throw new InternalError('Navigation requires an active Document');
    const userAgent = activeDocument.env.userAgent;
    const parent = this.parent?.activeWindow ?? null;
    params.reservedEnv ??= new BrowletEnvironmentBase({
      userAgent,
      creationURL: params.request?.currentURL ?? params.url,
      topLevelCreationURL: parent?.env.topLevelCreationURL ?? params.url,
      topLevelOrigin: parent?.env.topLevelOrigin ?? params.origin,
      targetBrowsingContext: browsingContext,
      isSecureContext: userAgent.isOriginPotentiallyTrustworthy(params.origin) && (parent === null || parent.isSecureContext),
    });
    if (params.coopEnforcementResult !== null) return;
    if (params.url.scheme !== 'blob') {
      params.policyContainer.embedderPolicy = EmbedderPolicy.obtain(params.response, params.reservedEnv);
    }
    // The local route supplies browser-UI inputs, without an initiator or history restoration.
    // TODO(HTML navigation): Supply captured source/target policy containers and history state in the full loader.
    params.policyContainer = PolicyContainer.determineForNavigation(
      params.url, null, null, this.containerDocument?.policyContainer ?? null, params.policyContainer,
    );
    params.coopEnforcementResult = {
      needsBrowsingContextGroupSwitch: false,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      url: activeDocument.url,
      origin: activeDocument.origin,
      openerPolicy: activeDocument.openerPolicy,
      // Local-route navigation currently originates in the host/browser UI.
      currentContextIsNavigationSource: false,
    };
    if (this.isTopLevelTraversable) {
      params.openerPolicy = OpenerPolicy.obtain(params.response, params.reservedEnv);
      params.coopEnforcementResult = browsingContext.enforceResponseOpenerPolicy(
        params.url, params.origin, params.openerPolicy, params.coopEnforcementResult, params.request?.referrer,
      );
      if (params.finalSandboxingFlagSet.size > 0 && params.openerPolicy.value !== 'unsafe-none') {
        // TODO: Fetch navigation must replace this response with a network error.
        throw new InternalError('Sandboxed COOP navigation requires network-error processing');
      }
    }
  }
}

/** Elements that retain a nullable child navigation destination. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#navigable-container
export type NavigableContainer = HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLEmbedElementImpl | HTMLFrameElementImpl;

/**
 * Optional inputs to HTML's navigate algorithm. Nullable inputs default to null and booleans to false;
 * historyHandling defaults to 'auto', referrerPolicy to '', and userInvolvement to 'none'.
 */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate
export type NavigateOptions = {
  documentResource?: PostResource | string | null;
  response?: FetchResponse | null;
  exceptionsEnabled?: boolean;
  historyHandling?: NavigationHistoryBehavior;
  navigationAPIState?: SerializedRecord | null;
  formDataEntryList?: FormDataEntry[] | null;
  referrerPolicy?: ReferrerPolicy;
  userInvolvement?: UserNavigationInvolvement;
  sourceElement?: ElementImpl | null;
  initialInsertion?: boolean;
  apiMethodTracker?: NavigationAPIMethodTracker | null;
};

/** Optional population inputs; IDs/params default to null, CSP type to other, POST to false, and completion to no steps. */
export type PopulateHistoryEntryOptions = {
  navigationId?: string | null;
  navigationParams?: NavigationParams | null;
  cspNavigationType?: 'form-submission' | 'other';
  allowPOST?: boolean;
  completionSteps?: () => void;
};

/** A navigation request retains HTML's concrete source client and captured policy container. */
export interface NavigationRequest extends FetchRequest {
  /** Initiating environment, or null for browser-UI navigation. */
  client: BrowletEnvironment | null;
  /** Independent source policy snapshot, including CSP's browser-owned algorithms. */
  policyContainer: PolicyContainer;
}

/** Optional reload inputs: state and tracker default to null; user involvement defaults to 'none'. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#reload
export type ReloadOptions = {
  navigationAPIState?: SerializedRecord | null;
  userInvolvement?: UserNavigationInvolvement;
  apiMethodTracker?: NavigationAPIMethodTracker | null;
};

/** Requested history action, before resolving the automatic behavior. */
// https://html.spec.whatwg.org/multipage/nav-history-apis.html#navigationhistorybehavior
export type NavigationHistoryBehavior = 'auto' | HistoryHandlingBehavior;

/** History action selected after resolving a navigation's default behavior. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#history-handling-behavior
export type HistoryHandlingBehavior = 'push' | 'replace';

/** User participation in a navigation or history traversal. */
export type UserNavigationInvolvement = 'none' | 'activation' | 'browser UI';

/** Result classification from choosing a navigable. */
type WindowType = 'existing-or-none' | 'new-and-unrestricted' | 'new-with-no-opener';

/** Coordinates session-history traversal for its descendant navigables. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#traversable-navigable
export class Traversable extends Navigable implements FetchPromptTarget {
  /** Joint session-history step currently applied to this traversable. */
  currentSessionHistoryStep = 0;
  /** Top-level history entries retained for traversal. */
  sessionHistoryEntries: SessionHistoryEntry[] = [];
  /** Browser-owned queue serializing history traversal across Documents and descendant Agents. */
  sessionHistoryTraversalQueue: SessionHistoryTraversalQueue;
  /** Whether apply-history-step is already running a nested operation. */
  // TODO(HTML §7.4.6.2): Set and clear this around synchronous-navigation steps that jump the queue.
  runningNestedApplyHistoryStep = false;
  /** Visibility reported by the host for this traversable. */
  systemVisibilityState: DocumentVisibilityState = 'visible';
  /** Whether web content, rather than the user, created this traversable. */
  isCreatedByWebContent = false;
  /** Session storage retained across this traversable's Documents. */
  // https://storage.spec.whatwg.org/#traversable-navigable-storage-shed
  storageShed = new StorageShed();
  /** Type-only identification as an eligible Fetch prompt destination. */
  declare [fetchPromptTargetBrand]: true;

  constructor(documentState: DocumentBackedState, parent: Navigable | null = null) {
    super(documentState, parent);
    this.sessionHistoryTraversalQueue = new SessionHistoryTraversalQueue(documentState.document.env.userAgent);
    documentState.document.setInitialVisibilityState(this.systemVisibilityState);
    documentState.document.notifyFullyActiveStateChanged();
  }

  /** Append traversal work to this traversable's session-history parallel queue. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#tn-append-session-history-traversal-steps
  appendSessionHistoryTraversalSteps(steps: SessionHistoryTraversalSteps): void {
    this.sessionHistoryTraversalQueue.append(steps);
  }

  /** Append tagged work that history application may select ahead of ordinary traversal work. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#tn-append-session-history-sync-nav-steps
  appendSessionHistorySynchronousNavigationSteps(targetNavigable: Navigable, steps: SessionHistoryTraversalSteps): void {
    this.sessionHistoryTraversalQueue.append(Object.assign(() => steps(), { targetNavigable }));
  }

  /** Reapply the current joint-history step after adding or removing a child. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-for-navigable-creation/destruction
  updateForNavigableCreationOrDestruction(): HistoryStepResult {
    // TODO(HTML §7.4.6.1): Apply currentSessionHistoryStep with checkForCancelation false,
    // null source/initiator, user involvement 'none', and null navigation type.
    throw new InternalError('History update for navigable creation/destruction is not implemented');
  }

  /** Traverse joint history; an omitted source Document denotes a browser-UI request. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#traverse-the-history-by-a-delta
  traverseHistoryByDelta(_delta: number, _sourceDocument?: DocumentImpl): void {
    // TODO(HTML 7.4): Snapshot a supplied source and retain its initiator, then append traversal steps.
    // Select the target from all used steps inside that queue, and apply it with sandbox permission,
    // navigate-event cancellation, unloading, document/state restoration, and history notifications.
    throw new InternalError('Session history delta traversal is not implemented');
  }

  /** Count distinct joint-history steps and locate the selected step within them. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-the-history-object-length-and-index
  getHistoryLengthAndIndex(step: number): [length: number, index: number] {
    const steps = this.getAllUsedHistorySteps();
    const index = steps.indexOf(step);
    if (index < 0) throw new InternalError('The selected history step is not present');
    return [steps.length, index];
  }

  /** Collect distinct history steps in ascending order, including retained descendant histories. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-all-used-history-steps
  // The sorted, duplicate-free array supports the callers' indexed history lookup.
  getAllUsedHistorySteps(): number[] {
    // TODO(HTML §7.4.1.4): Enforce traversal-queue ownership after §7.4.2.3 replaces provisional synchronous commits.
    const entryLists = new Set([this.sessionHistoryEntries]);
    const usedSteps = new Set<number>();
    for (const entries of entryLists) {
      for (const entry of entries) {
        if (entry.step === 'pending') throw new InternalError('Used history steps require committed entries');
        usedSteps.add(entry.step);
        for (const nested of entry.documentState.nestedHistories) entryLists.add(nested.entries);
      }
    }
    return [...usedSteps].sort((a, b) => a - b);
  }

  /** Apply a traversal with cancellation checks, its captured source, and initiating navigable. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-traverse-history-step
  applyTraverseHistoryStep(
    _step: number, _sourceSnapshotParams: SourceSnapshotParams,
    _initiatorToCheck: Navigable, _userInvolvement: UserNavigationInvolvement,
  ): HistoryStepResult {
    // TODO(HTML 7.4.6): Apply the history step with cancellation enabled and navigation type 'traverse'.
    // Check sandbox permission, beforeunload/navigate cancellation, and restore Documents/history with event/tracker notifications.
    // Restore entry.classicHistoryAPIState through structured deserialization and the specified History/popstate updates.
    // Repopulate or reactivate the shared DocumentState, then update each affected Document's latestEntry.
    // While waiting for population, run eligible tagged steps from the queue's algorithmSet with
    // runningNestedApplyHistoryStep set, excluding navigables already advanced by this traversal.
    // Return completion through the queued caller, and wake this operation when tagged steps or population continuations arrive.
    throw new InternalError('Traverse history-step application is not implemented');
  }

  /** Resume an intercepted same-document traversal after its cancellation checks have passed. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#resume-applying-the-traverse-history-step
  resumeTraverseHistoryStep(_step: number, _userInvolvement: UserNavigationInvolvement): void {
    // TODO(HTML 7.4.6): Apply the history step with checkForCancelation false, null source/initiator,
    // the supplied user involvement, and navigation type 'traverse', within the traversal queue.
    throw new InternalError('Resuming an intercepted history traversal is not implemented');
  }

  /** Activate the committed entry and retarget its browsing context's WindowProxy. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-push/replace-history-step
  // PROVISIONAL: only the supplied top-level entry participates in this history step.
  applyPushOrReplaceHistoryStep(
    navigable: Navigable,
    targetStep: number,
    historyEntry: SessionHistoryEntry,
  ): void {
    const document = historyEntry.documentState.document;
    if (document === null) return;

    // The full history-step algorithm must also update nonchanging child Documents.
    [document.history.lengthValue, document.history.index] = this.getHistoryLengthAndIndex(targetStep);
    document.latestEntry = historyEntry;
    navigable.currentSessionHistoryEntry = historyEntry;
    navigable.activeSessionHistoryEntry = historyEntry;
    this.currentSessionHistoryStep = targetStep;
    document.makeActive();
    // https://html.spec.whatwg.org/multipage/browsing-the-web.html#activate-history-entry
    document.setInitialVisibilityState(navigable.traversable.systemVisibilityState);
    // This provisional caller only commits newly-created Documents. Reactivation and same-document
    // updates need their separate §7.2.6.4 algorithms, events, and tracker settlement.
    document.getRelevantGlobalObject()!.navigation.initializeEntriesForNewDocument(
      navigable.getSessionHistoryEntriesForNavigationAPI(targetStep), historyEntry,
    );
  }

  /** Discard forward entries in this traversable and the child histories retained after pruning. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#clear-the-forward-session-history
  clearForwardSessionHistory(): void {
    // TODO(HTML §7.4.1.4): Enforce traversal-queue ownership after §7.4.2.3 replaces provisional synchronous commits.
    const step = this.currentSessionHistoryStep;
    const entryLists = new Set([this.sessionHistoryEntries]);
    for (const entries of entryLists) {
      for (let i = entries.length - 1; i >= 0; i--) {
        const entryStep = entries[i]!.step;
        if (entryStep === 'pending') throw new InternalError('Forward history clearing requires committed entries');
        if (entryStep > step) entries.splice(i, 1);
      }
      for (const entry of entries) {
        for (const nested of entry.documentState.nestedHistories) entryLists.add(nested.entries);
      }
    }
  }
}

/** Traversable representing a top-level browser window or tab. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#top-level-traversable
export class TopLevelTraversable extends Traversable {
  /** Live input streams indexed by IDs local to this top-level context and its descendants. */
  // https://w3c.github.io/pointerevents/#dom-pointerevent-pointerid
  // MouseInputProcessor reserves ID 1 and registers it before delivery.
  // TODO(Pointer Events §3.1 / other input producers): assign other IDs and
  // remove retired streams after final notifications. Author construction/dispatch
  // never populates this map. UserAgent.activePointers retains source identity.
  pointerEventStreams = new Map<PointerId, PointerEventStream>();

  constructor(documentState: DocumentBackedState) {
    super(documentState);
  }

  /** Create a top-level destination and register its initial document and history. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#creating-a-new-top-level-traversable
  static create(
    userAgent: UserAgent,
    opener: BrowsingContext | null,
    targetName: string,
    openerNavigableForWebDriver?: Navigable,
  ): TopLevelTraversable {
    let document: DocumentImpl;

    if (opener === null) {
      [, document] = BrowsingContext.createTopLevel(userAgent);
    } else {
      [, document] = BrowsingContext.createAuxiliary(opener);
    }

    const documentState = DocumentState.create(document);
    documentState.initiatorOrigin = opener === null
      ? null
      : document.origin;
    documentState.origin = document.origin;
    documentState.navigableTargetName = targetName;
    documentState.aboutBaseURL = document.aboutBaseURL;

    const traversable = new TopLevelTraversable(documentState);
    const initialHistoryEntry = traversable.activeSessionHistoryEntry;
    initialHistoryEntry.step = 0;
    traversable.sessionHistoryEntries.push(initialHistoryEntry);
    // Seed the initial entry's script-visible values in the current synchronous creation path.
    [document.history.lengthValue, document.history.index] = traversable.getHistoryLengthAndIndex(0);

    if (opener !== null) {
      opener.topLevelTraversable.storageShed.cloneSessionStorageInto(traversable.storageShed);
    }

    userAgent.appendTopLevelTraversable(traversable);
    userAgent.webDriverBiDiNavigableCreated(traversable, openerNavigableForWebDriver ?? null);
    return traversable;
  }

  override get isTopLevelTraversable(): true {
    return true;
  }

  /** Release pending capture after a DOM subtree is unlinked, without dispatching during removal. */
  // https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture
  // Scan the existing streams once per removal, rather than retaining a reverse
  // target registry or walking every node in the removed subtree.
  releaseDisconnectedPointerCaptures(): void {
    for (const stream of this.pointerEventStreams.values()) {
      const pending = stream.capture.pendingTargetOverride;
      if (pending && !pending.isConnected) stream.releasePointerCapture(pending);
    }
  }

  /**
   * Request teardown of retained Documents, then remove this destination from browser ownership.
   * Closing supplies the browsing context captured before unloading.
   */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#destroy-a-top-level-traversable
  destroy(browsingContext: BrowsingContext | null = this.activeBrowsingContext): void {
    if (browsingContext === null) throw new InternalError('Top-level destruction requires its browsing context');
    const group = browsingContext.group;
    if (group === null) throw new InternalError('Top-level destruction requires a browsing context group');
    const userAgent = group.userAgent;
    // SPEC_GAP(top-level-destruction-order): HTML leaves entry order open; request teardown in retained-list order.
    for (const entry of this.sessionHistoryEntries) entry.documentState.document?.destroyAndDescendants();
    this.pointerEventStreams.clear();
    group.remove(browsingContext);
    userAgent.removeTopLevelTraversableFromUI(this);
    userAgent.removeTopLevelTraversable(this);
    userAgent.webDriverBiDiNavigableDestroyed(this);
  }

  /** Close unless a script has already queued definite closing. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#close-a-top-level-traversable
  close(): void {
    if (this.isClosing) return;
    this.definitelyClose();
  }

  /** Check cancellation, then queue unloading and destroy this destination after unloading completes. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#definitely-close-a-top-level-traversable
  definitelyClose(): void {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Closing requires an active Document');
    const toUnload = document.getInclusiveDescendantNavigables();
    if (Navigable.checkIfUnloadingIsCanceled(toUnload) !== 'continue') return;
    this.appendSessionHistoryTraversalSteps(() => {
      const activeDocument = this.activeDocument;
      if (activeDocument === null) throw new InternalError('Closing requires an active Document when unloading begins');
      // SPEC_GAP(top-level-close-destroyed-document): HTML retrieves the context after unloading can clear it; retain it before unloading.
      const browsingContext = activeDocument.browsingContext;
      if (browsingContext === null) throw new InternalError('Closing requires a browsing context when unloading begins');
      activeDocument.unloadAndDescendants(null, () => { this.destroy(browsingContext); });
    });
  }

  /** Collect the active document tree's diagnostics and mask cross-origin descendants before exposure. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#build-not-restored-reasons-for-a-top-level-traversable-and-its-descendants
  buildNotRestoredReasons(): void {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Restoration diagnostics require an active Document');
    document.buildNotRestoredReasonsForDocumentState();
    // TODO(HTML lifecycle): Compare descendant origins and hide foreign URL/reasons/children.
    // SPEC_CLASH(not-restored-reasons-collection): HTML adds "masked" after copying the root's reasons. Resolve before publishing diagnostics.
    throw new InternalError('Cross-origin restoration-diagnostic masking is not implemented');
  }
}

/** Outcome of applying a history step, including cancellation before or during navigate-event firing. */
export type HistoryStepResult = 'initiator-disallowed' | 'canceled-by-beforeunload' | 'canceled-by-navigate' | 'applied';

function requireTopLevelTraversable(navigable: Navigable): TopLevelTraversable {
  if (!(navigable instanceof TopLevelTraversable)) {
    throw new InternalError('Nested navigable history is not implemented');
  }
  return navigable;
}
