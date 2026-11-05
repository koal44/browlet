import { asciiLower, assertNever, InternalError, internalType, type InternalPromise } from '../../../infra/index';
import { randomUUID } from '../../../js-engine/index';
import { DOMExceptionImpl } from '../../../web-idl/core/index';
import { coarsenedSharedCurrentTime } from '../../../timing/index';
import { utf8Decode, utf8Encode } from '../../../encoding/index';
import {
  aboutBlankURL, areSameOrigin, areSameOriginDomain, copyURL, createOpaqueOrigin, obtainURLOrigin,
  percentDecodeString, serializeURL, urlsEqual, type Origin, type URLRecord,
} from '../../../url/index';
import { StorageShed } from '../../../storage/index';
import {
  getMIMETypeEssence, isAudioOrVideoMIMEType, isHTMLMIMEType, isImageMIMEType,
  isJavaScriptMIMEType, isJSONMIMEType, isXMLMIMEType, type MIMEType,
} from '../../../mime/index';
import type { FormDataEntry } from '../../../xhr/index';
import {
  FetchBody, FetchRequest, FetchResponse, isFetchScheme, type FetchPromptTarget, type fetchPromptTargetBrand, type ReferrerPolicy,
} from '../../../fetch/index';

import { ClassicScript, ScriptFetchOptions, type EventLoop } from '../../scripting/index';
import type { PointerId } from '../../interaction/events/index';
import {
  EmbedderPolicy, OpenerPolicy, PermissionsPolicy, PolicyContainer, queueCOEPInheritanceViolation, SandboxingFlagSet,
} from '../policy/index';
import type { CSPList } from '../policy/csp/index';
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
import type { NavigationAPIMethodTracker, NavigationType } from './api/index';
import type { WindowImpl, WindowProxyHandle } from '../window/index';
import { BrowletEnvironmentBase, type BrowletEnvironment } from '../../environment/index';
import { HTMLDocumentParser, type ScriptHandler } from '../../html/parser/index';
import type { SerializedRecord } from '../../scripting/structured-data/index';
import { ResourceReader } from '../../loader/index';
import type { PointerEventStream } from '../../interaction/index';
import type { UserAgent } from '../../user-agent';

import { BrowsingContext } from './browsing-context';
import { NavigationParams, type NonFetchSchemeNavigationParams, type TargetSnapshotParams } from './params';
import { SessionHistoryTraversalQueue, type SessionHistoryTraversalSteps } from './session-history-traversal-queue';

/** Owns a navigation destination and its current and active history entries. */
// https://html.spec.whatwg.org/multipage/document-sequences.html#navigable
export class Navigable {
  /** Stable identity across this navigable's documents and browsing contexts. */
  id = Symbol('Navigable');
  /** History entry selected by the latest navigation or traversal. */
  // TODO(HTML §7.4.1): Restrict mutation to the traversable's session history traversal queue.
  currentSessionHistoryEntry: SessionHistoryEntry;
  /** Whether closing this navigable has begun. */
  isClosing = false;
  /** Whether its navigation is delaying the container document's load event. */
  isDelayingLoadEvents = false;
  /** Navigation UUID, "traversal" while applying history, or null when no navigation is ongoing. */
  #ongoingNavigation: string | null = null;
  /** Parallel waits observing changes to the ongoing navigation, without polling its Document. */
  #navigationChangeSteps = new Set<() => void>();
  /** History entry supplying the active Document, independently of the current traversal entry. */
  // HTML permits mutation only on that Document's event loop; history application must preserve this ownership.
  #activeSessionHistoryEntry: SessionHistoryEntry;
  /** Containing navigable, retained after destruction for existing references. */
  #parent: Navigable | null = null;
  /** Direct children in parent-association order, independent of Document tree order. */
  // TODO(HTML §7.4.6.1/§7.5.10): Reconcile retained child associations during restoration and recursive Document teardown.
  #childNavigables = new Set<Navigable>();
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

    this.currentSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, documentState);
    this.#activeSessionHistoryEntry = this.currentSessionHistoryEntry;
    this.parent = parent;
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
      return traversable.updateForNavigableCreationOrDestruction();
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
    if (navigable.parent !== null) navigable.parent.#childNavigables.delete(navigable);
    const parentNavigable = container.getNodeNavigable();
    if (parentNavigable === null) throw new InternalError('Child destruction requires the container\'s node navigable');
    const histories = parentNavigable.activeSessionHistoryEntry.documentState.nestedHistories;
    const index = histories.findIndex((history) => history.id === navigable.id);
    if (index !== -1) histories.splice(index, 1);
    const traversable = parentNavigable.traversable;
    traversable.appendSessionHistoryTraversalSteps(() => traversable.updateForNavigableCreationOrDestruction());
    env.userAgent.webDriverBiDiNavigableDestroyed(navigable);
  }

  /** Queue Document checks and resolve after cancellation or completion; the UserAgent owns the parallel wait. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#prompt-to-unload-a-document
  static checkIfUnloadingIsCanceled(
    navigablesThatNeedBeforeUnload: Navigable[], traversable: Traversable | undefined,
    targetStep: number | undefined, userInvolvementForNavigateEvent: UserNavigationInvolvement | undefined,
    userAgent: UserAgent,
  ): InternalPromise<UnloadCancellationResult> {
    const P = userAgent.HostPromise;
    const resultType = internalType<UnloadCancellationResult>();
    return P.try(() => {
      const documents = navigablesThatNeedBeforeUnload.map((navigable) => {
        const document = navigable.activeDocument;
        if (document === null) throw new InternalError('Unload cancellation requires active Documents');
        return document;
      });
      let unloadPromptShown = false;
      let finalStatus: UnloadCancellationResult = 'continue';
      const fireBeforeUnload = (document: DocumentImpl) => {
        const [shown, canceled] = document.fireBeforeUnload(unloadPromptShown);
        if (shown) unloadPromptShown = true;
        if (canceled) finalStatus = 'canceled-by-beforeunload';
      };
      const queueCheck = (document: DocumentImpl, steps: () => void) => {
        const completion = P.withResolvers(internalType<void>());
        // Tasks retain their global's activity gate; removal rejects the internal wait without firing author events.
        document.env.queueTask('navigation-and-traversal', () => {
          try { steps(); completion.resolve(); }
          catch (error) { completion.reject(error); }
        }, { discardSteps: () => { completion.reject(new InternalError('Unload check task was discarded')); } });
        return completion.promise;
      };
      const checkRemainingDocuments = () => {
        const checks = documents.map((document) => queueCheck(document, () => { fireBeforeUnload(document); }));
        return P.all(checks, internalType<void[]>()).then(() => finalStatus, undefined, resultType);
      };

      if (traversable !== undefined) {
        if (targetStep === undefined || userInvolvementForNavigateEvent === undefined) {
          throw new InternalError('Traversal unload checks require a target step and user involvement');
        }
        const targetEntry = traversable.getTargetHistoryEntry(targetStep);
        const currentEntry = traversable.currentSessionHistoryEntry;
        if (targetEntry === currentEntry) return checkRemainingDocuments();
        const targetOrigin = targetEntry.documentState.origin;
        const currentOrigin = currentEntry.documentState.origin;
        if (targetOrigin === null || currentOrigin === null) {
          throw new InternalError('Traversal unload checks require recorded history origins');
        }
        if (areSameOrigin(targetOrigin, currentOrigin)) {
          const document = traversable.activeDocument;
          if (document === null) throw new InternalError('Traversal unload checks require an active Document');
          const needsBeforeUnload = navigablesThatNeedBeforeUnload.includes(traversable);
          if (needsBeforeUnload) documents.splice(documents.indexOf(document), 1);
          return queueCheck(document, () => {
            if (needsBeforeUnload) {
              const activeDocument = traversable.activeDocument;
              if (activeDocument === null) throw new InternalError('Traversal beforeunload requires an active Document');
              fireBeforeUnload(activeDocument);
            }
            // SPEC_CLASH(unload-cancellation-completion): HTML aborts before setting eventsFired, stranding its wait.
            // Complete cancellation without navigate/descendant checks, so a dismissed traversal can finish and be retried.
            if (finalStatus === 'canceled-by-beforeunload') return;
            const window = traversable.activeWindow;
            if (window === null) throw new InternalError('Traversal navigate-event firing requires an active Window');
            if (!window.navigation.fireTraverseNavigateEvent(targetEntry, userInvolvementForNavigateEvent)) {
              finalStatus = 'canceled-by-navigate';
            }
          }).then(() => finalStatus === 'continue' ? checkRemainingDocuments() : finalStatus, undefined, resultType);
        }
      }
      return checkRemainingDocuments();
    }, resultType);
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

  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#concept-navigate-mature
  get ongoingNavigation(): string | null {
    return this.#ongoingNavigation;
  }

  set ongoingNavigation(value: string | null) {
    if (this.#ongoingNavigation === value) return;
    this.#ongoingNavigation = value;
    // Direct history assignments wake waits without invoking the Navigation API abortion algorithm.
    for (const steps of [...this.#navigationChangeSteps]) steps();
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

  /** Containing navigable, or null at the top level; changing it keeps the child collections paired. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#nav-parent
  get parent(): Navigable | null {
    return this.#parent;
  }
  set parent(parent: Navigable | null) {
    if (this.#parent === parent) return;
    if (this.#parent !== null) this.#parent.#childNavigables.delete(this);
    this.#parent = parent;
    if (parent !== null) parent.#childNavigables.add(this);
  }

  /** Direct children for history traversal, including children in shadow trees. */
  // https://html.spec.whatwg.org/multipage/document-sequences.html#child-navigable
  get childNavigables(): ReadonlySet<Navigable> {
    return this.#childNavigables;
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
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce queue ownership after local commits and history application use their specified queues.
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

  /** Select this navigable's entry with the greatest committed step at or before the requested step. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-the-target-history-entry
  getTargetHistoryEntry(step: number): SessionHistoryEntry {
    let target: SessionHistoryEntry | null = null;
    let targetStep = -1;
    for (const entry of this.getSessionHistoryEntries()) {
      if (entry.step === 'pending') throw new InternalError('Target history lookup requires committed entries');
      if (entry.step <= step && entry.step > targetStep) {
        target = entry;
        targetStep = entry.step;
      }
    }
    if (target === null) throw new InternalError('The target history step has no entry');
    return target;
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
    if (sandboxingFlagSet.has('sandboxed-navigation')) {
      // SPEC_CLASH(sandbox-noopener-creator): Retain the creator even with noopener, as browsers do; HTML #12297 tracks the omitted assignment.
      browsingContext.onePermittedSandboxedNavigator = this.activeBrowsingContext;
    }
    if (sandboxingFlagSet.has('sandbox-propagates-to-auxiliary-browsing-contexts')) {
      for (const flag of sandboxingFlagSet) browsingContext.popupSandboxingFlagSet.add(flag);
    }
    chosen.isCreatedByWebContent = true;
    return [chosen, windowType];
  }

  /** Check navigation permission against the initiating Document's captured sandbox state. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#allowed-to-navigate
  isAllowedBySandboxingToNavigate(target: Navigable, sourceSnapshotParams: SourceSnapshotParams): boolean {
    if (this === target) return true;
    for (let ancestor = target.parent; ancestor !== null; ancestor = ancestor.parent) {
      if (ancestor === this) return true;
    }

    const { sandboxingFlags, hasTransientActivation } = sourceSnapshotParams;
    for (let ancestor = this.parent; ancestor !== null; ancestor = ancestor.parent) {
      if (ancestor !== target) continue;
      // SPEC_CLASH(sandbox-intermediate-ancestor): Apply sandboxed-navigation as browsers and HTML's target table do; this algorithm says true.
      if (!target.isTopLevelTraversable) return !sandboxingFlags.has('sandboxed-navigation');
      return !sandboxingFlags.has(hasTransientActivation
        ? 'sandboxed-top-level-navigation-with-user-activation'
        : 'sandboxed-top-level-navigation-without-user-activation');
    }

    if (target.isTopLevelTraversable) {
      // HTML defines and populates this permission on browsing contexts; compare the navigables' active contexts.
      // SPEC_CLASH(sandbox-disowned-creator): Retain HTML/Firefox's original creator permission; Chromium/WebKit consult the mutable opener.
      const sourceContext = this.activeBrowsingContext;
      if (sourceContext !== null && target.activeBrowsingContext?.onePermittedSandboxedNavigator === sourceContext) return true;
    }
    // SPEC_CLASH(sandbox-unrelated-popup-escape): Keep HTML/Firefox/WebKit's restriction; Chromium's allow-popups-to-escape-sandbox bypasses it.
    return !sandboxingFlags.has('sandboxed-navigation');
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
          options.navigationAPIState ?? null, navigationId, options.apiMethodTracker ?? null,
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
      userAgent.runInParallel(() => {
        const activeDocument = this.activeDocument;
        if (activeDocument === null) throw new InternalError('Navigation requires an active Document');
        userAgent.checkIfUnloadingIsCanceled(activeDocument.getInclusiveDescendantNavigables()).observe((unloadStatus) => {
          userAgent.runInParallel(() => {
            if (unloadStatus !== 'continue' || this.ongoingNavigation !== navigationId) {
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
                  // TODO(HTML §7.4.6): History application still needs unloading and updates for every affected navigable.
                  this.finalizeCrossDocumentNavigation(historyHandling, userInvolvement, historyEntry);
                });
              },
            });
          });
        }, (error) => { userAgent.runInParallel(() => { throw error; }); });
      });
    };

    if (env?.realm.agent === targetEnv.realm.agent) steps();
    else targetEnv.queueTask('navigation-and-traversal', steps);
  }

  /** Queue preparation before unloading/activation; supplied failure steps take responsibility for asynchronous errors. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-history-step
  // Extracted step 12: completionSteps supplies the coordinator's continuation-queue insertion.
  prepareHistoryStep(
    traversable: Traversable, sourceSnapshotParams: SourceSnapshotParams | null,
    userInvolvement: UserNavigationInvolvement, navigationType: NavigationType | null,
    completionSteps: (continuation: ChangingNavigableContinuationState) => void,
    failureSteps?: (error: unknown) => void,
  ): void {
    const runSteps = (steps: () => void) => {
      try { steps(); }
      catch (error) {
        if (failureSteps === undefined) throw error;
        failureSteps(error);
      }
    };
    const window = this.activeWindow;
    if (window === null) throw new InternalError('History preparation requires an active Window');
    const taskOptions = {
      discardSteps: failureSteps === undefined ? undefined : () => { failureSteps(new InternalError('History preparation task was discarded')); },
    };
    window.env.queueTask('navigation-and-traversal', () => runSteps(() => {
      const displayedEntry = this.activeSessionHistoryEntry;
      const targetEntry = this.currentSessionHistoryEntry;
      const displayedDocument = displayedEntry.document;
      if (displayedDocument === null) throw new InternalError('History preparation requires a displayed Document');
      const continuation: ChangingNavigableContinuationState = {
        displayedDocument, targetEntry, navigable: this, updateOnly: false,
      };
      if (displayedEntry === targetEntry && !targetEntry.documentState.reloadPending) {
        continuation.updateOnly = true;
        completionSteps(continuation);
        return;
      }

      switch (navigationType) {
        case 'reload':
          if (!targetEntry.documentState.reloadPending) throw new InternalError('History reload requires a pending reload');
          break;
        case 'traverse':
          if (!targetEntry.documentState.everPopulated) throw new InternalError('History traversal requires a previously populated entry');
          break;
        case 'replace':
          if (targetEntry.step !== displayedEntry.step || targetEntry.documentState.everPopulated) {
            throw new InternalError('History replacement requires a new Document at the displayed step');
          }
          break;
        case 'push':
          if (displayedEntry.step === 'pending' || targetEntry.step !== displayedEntry.step + 1 || targetEntry.documentState.everPopulated) {
            throw new InternalError('History push requires a new Document at the next step');
          }
          break;
        case null: break;
        default: assertNever(navigationType);
      }

      const oldOrigin = targetEntry.documentState.origin;
      const displayedOrigin = displayedEntry.documentState.origin;
      if (navigationType === 'traverse' && this !== (traversable as Navigable) && targetEntry !== displayedEntry &&
        oldOrigin !== null && displayedOrigin !== null && areSameOrigin(oldOrigin, displayedOrigin)) {
        this.activeWindow!.navigation.fireTraverseNavigateEvent(targetEntry, userInvolvement);
      }

      const afterDocumentPopulated = () => {
        const document = targetEntry.document;
        if (document === null) {
          // SPEC_GAP(history-population-null-document): HTML marks update-only, then dereferences the null Document.
          // Keep the displayed page, as browsers do, without resetting retained origin-dependent state.
          continuation.updateOnly = true;
        } else if (oldOrigin === null || !areSameOrigin(document.origin, oldOrigin)) {
          targetEntry.classicHistoryAPIState = displayedDocument.env.serializeForStorage(null);
          const context = document.browsingContext;
          if (this.parent === null && !(context?.isAuxiliary && context.openerBrowsingContext !== null)) {
            targetEntry.documentState.navigableTargetName = '';
          }
        }
        completionSteps(continuation);
      };
      if (targetEntry.document === null || targetEntry.documentState.reloadPending) {
        const navigationTimingType = targetEntry.document === null ? 'back_forward' : 'reload';
        const targetSnapshotParams = this.snapshotTargetParams();
        let source = sourceSnapshotParams;
        if (source === null) {
          const activeDocument = this.activeDocument;
          if (activeDocument === null) throw new InternalError('History source snapshot requires an active Document');
          source = new SourceSnapshotParams(activeDocument);
        }
        // Optional user-agent repost confirmation has no host integration yet.
        const allowPOST = targetEntry.documentState.reloadPending;
        window.env.userAgent.runInParallel(() => runSteps(() => {
          try {
            // SPEC_GAP(history-population-timing-input): HTML computes navTimingType but omits it from this call.
            this.populateHistoryEntryDocument(targetEntry, navigationTimingType, source, targetSnapshotParams, userInvolvement, {
              allowPOST, failureSteps,
              completionSteps: () => {
                const activeWindow = this.activeWindow;
                if (activeWindow === null) throw new InternalError('History population completion requires an active Window');
                activeWindow.env.queueTask('navigation-and-traversal', () => runSteps(afterDocumentPopulated), taskOptions);
              },
            });
          } finally {
            // SPEC_CLASH(history-reload-pending-inputs): HTML clears this before both POST admission and request flags (#12760).
            // Preserve it until synchronous request construction has captured reloadNavigation; no response wait is needed.
            targetEntry.documentState.reloadPending = false;
          }
        }));
      } else {
        afterDocumentPopulated();
      }
    }), taskOptions);
  }

  /** Save the displayed entry's state, then activate a populated entry and initialize its Document's visibility. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#activate-history-entry
  activateHistoryEntry(entry: SessionHistoryEntry): void {
    // TODO(HTML §7.4.6.5): The persisted-state owner must capture scroll positions before activation can complete.
    this.activeSessionHistoryEntry.savePersistedState();
    const document = entry.document;
    if (document === null) throw new InternalError('History activation requires a populated Document');
    if (document.isInitialAboutBlank) throw new InternalError('History activation cannot restore the initial about:blank Document');
    this.activeSessionHistoryEntry = entry;
    document.makeActive();
    document.setInitialVisibilityState(this.traversable.systemVisibilityState);
  }

  /** Populate a pending entry in parallel, then run its completion steps without committing it here. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#attempt-to-populate-the-history-entry's-document
  // SPEC_MISMATCH: attempt to populate the history entry's document(entry, navigable, navTimingType, sourceSnapshotParams, targetSnapshotParams, userInvolvement, navigationId = null, navigationParams = null, cspNavigationType = "other", allowPOST = false, completionSteps = empty)
  populateHistoryEntryDocument(
    entry: SessionHistoryEntry, navigationTimingType: NavigationTimingType,
    sourceSnapshotParams: SourceSnapshotParams, targetSnapshotParams: TargetSnapshotParams,
    userInvolvement: UserNavigationInvolvement, options: PopulateHistoryEntryOptions = {},
  ): void {
    // TODO(HTML §7.4.5): Enforce parallel execution alongside the navigation/history queue assertions.
    const navigationId = options.navigationId ?? null;
    // SPEC_CLASH(history-population-navigation-id): HTML's history caller leaves the ID null while owning "traversal".
    // Capture that ownership for cancellation without exposing the sentinel as a navigation/BiDi ID.
    const expectedNavigation = navigationId === null && this.ongoingNavigation === 'traversal' ? 'traversal' : navigationId;
    const cspNavigationType = options.cspNavigationType ?? 'other';
    const completionSteps = options.completionSteps;
    const failureSteps = options.failureSteps;
    // TODO(HTML §7.5.10): Teardown must also cancel in-flight Fetch/body reads and settle their waiting owner
    // when there is no queued task to discard; later callbacks must not enqueue work for a destroyed Document.
    const taskOptions = {
      discardSteps: failureSteps === undefined ? undefined : () => { failureSteps(new InternalError('History population task was discarded')); },
    };
    const runSteps = (steps: () => void) => {
      try { steps(); }
      catch (error) {
        if (failureSteps === undefined) throw error;
        failureSteps(error);
      }
    };
    const queueResponse = (params: NavigationParams | NonFetchSchemeNavigationParams | null | undefined) => {
      const window = this.activeWindow;
      if (window === null) throw new InternalError('History population requires an active Window');
      window.env.queueTask('navigation-and-traversal', () => runSteps(() => {
        // Fetch's bare return is cancellation, even if another navigation reuses the null ID.
        if (params === undefined || this.ongoingNavigation !== expectedNavigation) {
          completionSteps?.();
          return;
        }
        let saveExtraDocumentState = true;
        const complete = () => {
          // Non-fetch/error pages retain the entry's origin and history policies.
          const document = entry.document;
          if (document !== null) {
            entry.documentState.everPopulated = true;
            if (saveExtraDocumentState && params instanceof NavigationParams) {
              entry.documentState.origin = document.origin;
              if (PolicyContainer.requiresStorageInHistory(document.url)) {
                entry.documentState.historyPolicyContainer = params.policyContainer;
              }
            }
            if (entry.documentState.requestReferrer === undefined && params instanceof NavigationParams) {
              // SPEC_GAP(navigation-history-null-request): HTML asserts a request exists, although synthetic params can omit it.
              // TODO(HTML §7.4.5): Resolve synthetic referrer persistence before enabling the inline/Document loaders.
              if (params.request === null) throw new InternalError('Synthetic navigation history referrer capture is not implemented');
              entry.documentState.requestReferrer = params.request.referrer;
            }
          }
          completionSteps?.();
        };
        if (params !== null && !(params instanceof NavigationParams)) {
          entry.documentState.document = this.attemptToCreateNonFetchSchemeDocument(params);
          saveExtraDocumentState = false;
        } else if (
          params === null ||
          params.policyContainer.cspList?.isNavigationResponseBlocked(
            params.request, params.response, cspNavigationType, this, window.env.userAgent,
          ) ||
          (params.reservedEnv !== null && !this.checkResponseEmbedderPolicy(params.response, params.policyContainer.embedderPolicy)) ||
          !this.checkResponseFrameOptions(params.response, params.policyContainer.cspList)
        ) {
          // TODO(HTML §7.5.7): The inline-content owner must accept the failure description when it implements error pages.
          const document = this.createDocumentForInlineContent(null, navigationTimingType, userInvolvement);
          entry.documentState.document = document;
          document.makeUnsalvageable('navigation-failure');
          saveExtraDocumentState = false;
          if (params !== null) {
            // SPEC_GAP(navigation-failure-null-environment): HTML discards a nullable reservation; synthetic responses have none.
            params.reservedEnv?.discard();
            window.env.userAgent.webDriverBiDiNavigationFailed(this, {
              id: navigationId, status: 'canceled', url: params.url,
            });
          }
        } else if (params.response.hasAttachmentDisposition()) {
          if (sourceSnapshotParams.allowsDownloading && !params.finalSandboxingFlagSet.has('sandboxed-downloads') &&
            window.env.userAgent.isNavigationDownloadAllowed(params.response, sourceSnapshotParams)) {
            window.env.userAgent.handleAsDownload(params.response, this, navigationId);
          }
          // SPEC_CLASH(navigation-empty-attachment): HTML/Chromium/WebKit select downloads before 204/205;
          // Firefox ignores those statuses without downloading. Both branches leave the entry unpopulated.
        } else if (params.response.status !== 204 && params.response.status !== 205) {
          const resource = new ResourceReader(params.response, window.env.userAgent);
          const fail = (error: unknown) => window.env.queueTask('navigation-and-traversal', () => runSteps(() => { throw error; }), taskOptions);
          // Sniffing can wait for bytes. Resume Document creation and retained-state updates on the destination's task.
          // TODO(HTML §7.5): Document teardown must cancel the retained reader if it discards this continuation task.
          resource.determineMIMEType().observe(() => window.env.queueTask('navigation-and-traversal', () => runSteps(() => {
            if (this.ongoingNavigation !== expectedNavigation) {
              // Cleanup can fail after completion; report it separately rather than failing the completed job.
              resource.cancel().observe(() => {}, (error) => {
                window.env.queueTask('navigation-and-traversal', () => { throw error; });
              });
              completionSteps?.();
              return;
            }
            entry.documentState.document = this.loadDocument(params, sourceSnapshotParams, entry.documentState.initiatorOrigin, resource);
            complete();
          }), taskOptions), fail);
          return;
        }
        complete();
      }), taskOptions);
    };

    let params: NavigationParams | NonFetchSchemeNavigationParams | null = options.navigationParams ?? null;
    const documentResource = entry.documentState.resource;
    if (params === null) {
      const fetchScheme = isFetchScheme(entry.url.scheme);
      if (typeof documentResource === 'string') {
        const env = this.activeWindow?.env;
        if (env === undefined) throw new InternalError('Srcdoc population requires an active Window');
        params = NavigationParams.fromSrcdoc(
          entry, this, targetSnapshotParams, userInvolvement, navigationId, navigationTimingType, env,
        );
      } else if (fetchScheme && (documentResource === null || options.allowPOST === true && documentResource.requestBody !== 'failure')) {
        const env = this.activeWindow?.env;
        if (env === undefined) throw new InternalError('Fetching navigation parameters requires an active Window');
        const fail = (error: unknown) => env.userAgent.runInParallel(() => runSteps(() => { throw error; }));
        NavigationParams.fromFetch(
          entry, this, sourceSnapshotParams, targetSnapshotParams, cspNavigationType,
          userInvolvement, navigationId, navigationTimingType, env,
        ).observe((response) => {
          try { queueResponse(response); }
          catch (error) { fail(error); }
        }, fail);
        return;
      } else if (!fetchScheme) {
        const initiatorOrigin = entry.documentState.initiatorOrigin;
        if (initiatorOrigin === null) throw new InternalError('Non-fetch population requires a retained initiator origin');
        params = {
          id: navigationId, url: entry.url, targetSnapshotSandboxingFlags: targetSnapshotParams.sandboxingFlags,
          sourceSnapshotHasTransientActivation: sourceSnapshotParams.hasTransientActivation, initiatorOrigin,
          navigationTimingType, userInvolvement,
        };
      }
    }
    queueResponse(params);
  }

  /** Evaluate a queued javascript: request after checking the source policy and live destination. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-to-a-javascript:-url
  navigateToJavaScriptURL(
    request: NavigationRequest, historyHandling: HistoryHandlingBehavior, initiatorOrigin: Origin,
    userInvolvement: UserNavigationInvolvement, cspNavigationType: 'form-submission' | 'other',
    initialInsertion: boolean, navigationId: string, targetSnapshotParams: TargetSnapshotParams,
  ): void {
    if (historyHandling !== 'replace') throw new InternalError('JavaScript URL navigation must replace history');
    if (this.ongoingNavigation !== navigationId) return;
    const env = this.activeWindow?.env;
    if (env === undefined) throw new InternalError('JavaScript URL navigation requires an active Window');
    // The navigate algorithm queues this operation on the target Window, establishing the executing loop.
    this.setOngoingNavigation(null, env);
    const document = this.activeDocument;
    if (document === null) throw new InternalError('JavaScript URL navigation requires an active Document');
    if (!areSameOriginDomain(initiatorOrigin, document.origin)) return;

    if (request.policyContainer.cspList?.isNavigationRequestBlocked(request, cspNavigationType, request.client)) return;
    const newDocument = this.evaluateJavaScriptURL(request.url, initiatorOrigin, userInvolvement, navigationId, targetSnapshotParams);
    if (newDocument === null) {
      // Trusted Types or script execution can remove the container or replace its Document.
      const container = this.container;
      if (initialInsertion && container !== null && this.activeDocument!.isInitialAboutBlank) {
        if (container instanceof HTMLIFrameElementImpl) container.runLoadEventSteps();
        else container.fireEvent('load');
      }
      return;
    }
    if (newDocument.origin !== initiatorOrigin) throw new InternalError('JavaScript URL replacement must retain the initiator origin');
    const entryToReplace = this.activeSessionHistoryEntry;
    const oldState = entryToReplace.documentState;
    const documentState = DocumentState.create(newDocument);
    documentState.historyPolicyContainer = oldState.historyPolicyContainer?.clone() ?? null;
    documentState.requestReferrer = oldState.requestReferrer;
    documentState.requestReferrerPolicy = oldState.requestReferrerPolicy;
    documentState.initiatorOrigin = initiatorOrigin;
    documentState.origin = initiatorOrigin;
    documentState.aboutBaseURL = oldState.aboutBaseURL;
    documentState.everPopulated = true;
    documentState.navigableTargetName = oldState.navigableTargetName;
    // A fresh state clears the resource and child histories; the javascript: URL is never stored.
    const historyEntry = newDocument.env.createSessionHistoryEntry(entryToReplace.url, documentState);
    this.traversable.appendSessionHistoryTraversalSteps(() => {
      // TODO(HTML §7.4.6): Full history application, including unloading and other Documents' updates, remains unfinished.
      this.finalizeCrossDocumentNavigation(historyHandling, userInvolvement, historyEntry);
    });
  }

  /** Run a URL as a classic script; only a normal string completion produces a replacement Document. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#evaluate-a-javascript:-url
  evaluateJavaScriptURL(
    url: URLRecord, newDocumentOrigin: Origin, userInvolvement: UserNavigationInvolvement, navigationId: string,
    targetSnapshotParams: TargetSnapshotParams,
  ): DocumentImpl | null {
    const encodedSource = serializeURL(url).slice('javascript:'.length);
    // SPEC_CLASH(javascript-url-utf8-decoding): Follow HTML/Firefox/WebKit's UTF-8 replacement;
    // Chromium falls back to byte-for-byte characters when the escaped bytes are invalid UTF-8.
    const source = utf8Decode(Uint8Array.from(percentDecodeString(encodedSource)));
    const env = this.activeDocument?.env;
    if (env === undefined) throw new InternalError('JavaScript URL evaluation requires an active Document');
    const script = new ClassicScript(source, env, env.apiBaseURL, new ScriptFetchOptions());
    const completion = script.run();
    if (completion.type !== 'normal' || typeof completion.value !== 'string') return null;

    const document = this.activeDocument;
    if (document === null) throw new InternalError('JavaScript URL replacement requires an active Document');
    const response = new FetchResponse();
    response.urlList.push(document.url);
    response.headerList.append('Content-Type', 'text/html;charset=utf-8');
    // SPEC_CLASH(javascript-result-encoding): Follow HTML/Chromium/WebKit's UTF-8;
    // Firefox encodes Latin-1-only results as Windows-1252 for legacy image compatibility.
    // The browser's internal Fetch environment keeps delivery independent of the departing Document.
    response.body = FetchBody.fromBytes(utf8Encode(completion.value), document.env.userAgent.sandbox);
    const policyContainer = document.policyContainer;
    const finalSandboxFlags = policyContainer.cspList?.getSandboxingFlags() ?? new SandboxingFlagSet();
    const coop = document.openerPolicy;
    // SPEC_CLASH(javascript-replacement-referrer): Keep HTML/Firefox's null request and empty
    // Document.referrer. Chromium/WebKit preserve the previous Document's referrer instead.
    const params = new NavigationParams(
      response, finalSandboxFlags, coarsenedSharedCurrentTime(document.env.crossOriginIsolatedCapability).milliseconds,
    );
    params.id = navigationId;
    params.origin = newDocumentOrigin;
    params.policyContainer = policyContainer;
    params.openerPolicy = coop;
    params.coopEnforcementResult = {
      needsBrowsingContextGroupSwitch: false,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      url, origin: newDocumentOrigin, openerPolicy: coop, currentContextIsNavigationSource: false,
    };
    // SPEC_GAP(javascript-navigation-target-snapshot): HTML reads an undefined snapshot;
    // carry beginning-navigation's existing target snapshot through both javascript: operations.
    params.iframeReferrerPolicy = targetSnapshotParams.iframeReferrerPolicy;
    params.aboutBaseURL = document.aboutBaseURL;
    params.cookieURL = copyURL(document.cookieURL);
    params.userInvolvement = userInvolvement;
    // Request, Fetch controller, early hints, and reserved environment retain their specified null defaults.
    return this.loadHTMLDocument(params);
  }

  /** Update same-document history, navigate-event state, and scrolling for a fragment destination. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate-fragid
  navigateToFragment(
    url: URLRecord, historyHandling: HistoryHandlingBehavior, userInvolvement: UserNavigationInvolvement,
    sourceElement: ElementImpl | null, navigationAPIState: SerializedRecord | null, navigationId: string,
    apiMethodTracker: NavigationAPIMethodTracker | null = null,
  ): void {
    const navigation = this.activeWindow?.navigation;
    if (navigation === undefined) throw new InternalError('Fragment navigation requires an active Window');
    // Capture Navigation state before firing; the live entry's Document and scroll mode are selected afterward.
    // SPEC_CLASH(fragment-destination-state): Follow HTML/Firefox's inherited state; Chromium/WebKit expose undefined
    // in the event's destination even though their committed entry inherits the state.
    const destinationNavigationAPIState = navigationAPIState ?? this.activeSessionHistoryEntry.navigationAPIState;
    // SPEC_GAP(fragment-navigation-method-tracker): HTML drops navigate()'s tracker here; retain event.info and result promises.
    const shouldContinue = navigation.firePushReplaceReloadNavigateEvent(historyHandling, url, true, {
      userInvolvement, sourceElement, navigationAPIState: destinationNavigationAPIState, apiMethodTracker,
    });
    if (!shouldContinue) {
      // SPEC_CLASH(fragment-interception-abort): All browsers preserve the intercepted event. HTML's aborting setter
      // cancels the event it just created, contrary to its note about keeping browser-UI/window.stop cancellation available.
      if (navigation.ongoingNavigateEvent !== null) this.ongoingNavigation = navigationId;
      return;
    }

    // Publish the new active entry synchronously; joint-history insertion happens on the traversal queue.
    const activeEntry = this.activeSessionHistoryEntry;
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Fragment navigation requires an active Document');
    const historyEntry = document.env.createSessionHistoryEntry(url, activeEntry.documentState);
    historyEntry.navigationAPIState = destinationNavigationAPIState;
    historyEntry.scrollRestorationMode = activeEntry.scrollRestorationMode;
    const entryToReplace = historyHandling === 'replace' ? activeEntry : null;
    if (entryToReplace !== null) historyEntry.navigationAPIKey = entryToReplace.navigationAPIKey;
    const history = document.history;
    let scriptHistoryIndex = history.index;
    let scriptHistoryLength = history.lengthValue;
    if (historyHandling === 'push') {
      history.stateValue = null;
      scriptHistoryIndex++;
      scriptHistoryLength = scriptHistoryIndex + 1;
    }
    document.url = url;
    this.activeSessionHistoryEntry = historyEntry;
    // SPEC_CLASH(fragment-history-length-index): HTML's fragment call swaps these arguments; use the callee's
    // length/index order, matching browsers' synchronous history length and Navigation entry index.
    document.updateForHistoryStepApplication(historyEntry, true, scriptHistoryLength, scriptHistoryIndex, historyHandling);
    this.activeDocument!.scrollToFragment();

    const traversable = this.traversable;
    traversable.appendSessionHistorySynchronousNavigationSteps(this, () => {
      traversable.finalizeSameDocumentNavigation(this, historyEntry, entryToReplace, historyHandling, userInvolvement);
      document.env.userAgent.webDriverBiDiFragmentNavigated(this, { id: navigationId, url, status: 'complete' });
    });
  }

  /** Route a non-fetch URL without changing history when it is handled externally. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#attempt-to-create-a-non-fetch-scheme-document
  attemptToCreateNonFetchSchemeDocument(params: NonFetchSchemeNavigationParams): DocumentImpl | null {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Non-fetch navigation requires an active Document');
    const userAgent = document.env.userAgent;
    if (userAgent.shouldHandleURLExternally(params.url)) {
      userAgent.handoffToExternalSoftware(
        params.url, this, params.targetSnapshotSandboxingFlags,
        params.sourceSnapshotHasTransientActivation, params.initiatorOrigin,
      );
      return null;
    }
    return this.createDocumentForInlineContent(params.id, params.navigationTimingType, params.userInvolvement);
  }

  /** Create a browser-provided page without activating it or committing history. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#navigate-ua-inline
  createDocumentForInlineContent(
    _navigationId: string | null, _navigationTimingType: NavigationTimingType, _userInvolvement: UserNavigationInvolvement,
    _resource?: ResourceReader,
  ): DocumentImpl {
    // TODO(HTML §7.5.7): Opaque origin/COOP, context selection, Document creation, browser rendering,
    // and parser completion (including iframe load steps). A chosen registered handler instead navigates to its handler URL.
    // SPEC_GAP(inline-document-response): HTML reads an undefined response URL and receives no content/resource input.
    // Its callers can also supply a null navigation ID, retained here until this owner is audited.
    throw new InternalError('Inline user-agent Document creation is not implemented');
  }

  /** Reload this destination after its cancelable navigate event and through the traversal queue. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#reload
  reload(options: ReloadOptions = {}): void {
    // TODO: Explicit host forced reloads need cache bypass, subresource policy, and service-worker bypass.
    const userInvolvement = options.userInvolvement ?? 'none';
    if (userInvolvement !== 'browser UI') {
      const window = this.activeWindow;
      if (window === null) throw new InternalError('Reload requires an active Window');
      const entry = this.activeSessionHistoryEntry;
      const navigationAPIState = options.navigationAPIState ?? entry.navigationAPIState;
      // SPEC_CLASH(history-zero-delta-reload): Follow HTML/Chromium/Firefox for every reload caller.
      // WebKit's history.go(0) instead exposes sameDocument true and undefined Navigation state.
      if (!window.navigation.firePushReplaceReloadNavigateEvent('reload', entry.url, false, {
        navigationAPIState, userInvolvement, apiMethodTracker: options.apiMethodTracker ?? null,
      })) return;
    }

    this.activeSessionHistoryEntry.documentState.reloadPending = true;
    const traversable = this.traversable;
    traversable.appendSessionHistoryTraversalSteps(() => traversable.applyReloadHistoryStep(userInvolvement));
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

  /** Wake a parallel wait when the navigation changes; return its removal steps. */
  addNavigationChangeSteps(steps: () => void): () => void {
    this.#navigationChangeSteps.add(steps);
    return () => { this.#navigationChangeSteps.delete(steps); };
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

  /** Check child framing against the response URL's origin; an absent CSP list contains no policies. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#the-x-frame-options-header
  checkResponseFrameOptions(response: FetchResponse, cspList: CSPList | undefined): boolean {
    if (this.parent === null) return true;
    if (cspList?.policies.some((policy) => policy.disposition === 'enforce' && policy.directives.has('frame-ancestors'))) return true;

    // SPEC_CLASH(x-frame-options-quoted-values): Follow HTML/Fetch and Chromium's quoted splitting;
    // Firefox/WebKit split commas inside quotes, which can turn an ignored invalid value into a conflict.
    const values = new Set((response.headerList.getDecodeAndSplit('X-Frame-Options') ?? []).map(asciiLower));
    if (values.size > 1) return !values.has('deny') && !values.has('allowall') && !values.has('sameorigin');
    if (values.has('deny')) return false;
    if (!values.has('sameorigin')) return true;

    const url = response.url;
    if (url === null) throw new InternalError('X-Frame-Options SAMEORIGIN requires a response URL');
    // SPEC_CLASH(x-frame-options-sandbox-origin): All three browsers use the response URL's origin,
    // not HTML's destination Document origin, which sandboxing can make opaque.
    const origin = obtainURLOrigin(url);
    let document = this.containerDocument;
    while (document !== null) {
      if (!areSameOrigin(document.origin, origin)) return false;
      document = document.containerDocument;
    }
    return true;
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

  /** Select a response's Document loader, or return null after handing the resource off externally. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#loading-a-document
  // MIME preparation precedes this synchronous dispatch; the same reader retains the sniffed bytes for its consumer.
  loadDocument(
    params: NavigationParams, sourceSnapshotParams: SourceSnapshotParams, initiatorOrigin: Origin | null,
    resource: ResourceReader,
  ): DocumentImpl | null {
    const type = resource.mimeType;
    const essence = getMIMETypeEssence(type);
    const userAgent = this.activeWindow!.env.userAgent;
    const handler = userAgent.documentTypeHandlers.get(essence);
    if (handler !== 'external') {
      if (isHTMLMIMEType(type)) return this.loadHTMLDocument(params, undefined, resource);
      if (isXMLMIMEType(type) && handler === undefined) return this.loadXMLDocument(params, type, resource);
      if (isJavaScriptMIMEType(type) || isJSONMIMEType(type) && handler === undefined ||
        essence === 'text/css' || essence === 'text/plain' || essence === 'text/vtt') {
        return this.loadTextDocument(params, type, resource);
      }
      if (essence === 'multipart/x-mixed-replace') {
        return this.loadMultipartDocument(params, sourceSnapshotParams, initiatorOrigin, resource);
      }
      if ((isImageMIMEType(type) || isAudioOrVideoMIMEType(type)) && userAgent.supportsMIMEType(type)) {
        return this.loadMediaDocument(params, type, resource);
      }
      if ((essence === 'application/pdf' || essence === 'text/pdf') && userAgent.pdfViewerSupported) {
        return this.createDocumentForInlineContent(params.id, params.navigationTimingType, params.userInvolvement, resource);
      }
    }
    if (handler === 'inline' || handler === undefined && userAgent.shouldDisplayUnsupportedResourceInline(type)) {
      return this.createDocumentForInlineContent(params.id, params.navigationTimingType, params.userInvolvement, resource);
    }
    if (initiatorOrigin === null) {
      // SPEC_GAP(document-loading-null-initiator): Openerless initial about:blank history can retain null;
      // our provisional createHistoryEntry() also writes null. Fresh navigate() supplies an origin.
      // TODO: Resolve absent attribution at external handoff; null alone does not establish browser-UI authority.
      throw new InternalError('External resource handoff without an initiator origin is not implemented');
    }
    userAgent.handoffToExternalSoftware(
      params.response, this, params.finalSandboxingFlagSet, sourceSnapshotParams.hasTransientActivation, initiatorOrigin, resource,
    );
    return null;
  }

  /**
   * Create an HTML document after handler selection and start consuming its response.
   * Navigation supplies the reader whose MIME type selected this handler; parser script
   * preparation remains unfinished. Byte-loader callers currently supply that callback.
   */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html
  loadHTMLDocument(
    params: NavigationParams, handleScript?: ScriptHandler, resource?: ResourceReader,
  ): DocumentImpl {
    if (handleScript === undefined || resource === undefined) {
      // TODO(HTML §7.5.2/§4.12.1): Supply parser script preparation alongside the prepared reader,
      // and honor scripts-may-run while history activation is pending. Document creation preserves
      // synthetic params' null reservation; the about:blank body and cookie-URL rules remain below/at their owners.
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
      (element, write) => document.waitForScriptsMayRun().then(() => {
        if (parser.stopped) return;
        return handleScript(element, write);
      }),
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

  /** Create and begin parsing an XML response after MIME dispatch. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-xml
  // Keep the parsed MIME type and prepared reader at the loader boundary instead of serializing and parsing them again.
  loadXMLDocument(_params: NavigationParams, _type: MIMEType, _resource: ResourceReader): DocumentImpl {
    // TODO(HTML §7.5.3): Create the XML Document, connect its parser and scripts-may-run gate, then finish/abort loading.
    throw new InternalError('XML document loading is not implemented');
  }

  /** Create a text presentation without interpreting the response as HTML. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-text
  loadTextDocument(_params: NavigationParams, _type: MIMEType, _resource: ResourceReader): DocumentImpl {
    // TODO(HTML §7.5.4): Select encoding, create the HTML/pre presentation, disable HTML tokenization, and finish loading.
    throw new InternalError('Text document loading is not implemented');
  }

  /** Process successive replacement parts through the navigation owner. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-multipart-x-mixed-replace
  loadMultipartDocument(
    _params: NavigationParams, _sourceSnapshotParams: SourceSnapshotParams, _initiatorOrigin: Origin | null,
    _resource: ResourceReader,
  ): DocumentImpl | null {
    // TODO(HTML §7.5.5): Parse MIME parts, navigate each supplied response, and coordinate replacement/completion.
    throw new InternalError('Multipart document loading is not implemented');
  }

  /** Create the supported image/audio/video presentation for this response. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-media
  loadMediaDocument(_params: NavigationParams, _type: MIMEType, _resource: ResourceReader): DocumentImpl {
    // TODO(HTML §7.5.6): Create the media element/presentation, feed its decoder, and coordinate loading and rendering.
    throw new InternalError('Media document loading is not implemented');
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
      let requestsOAC = params.requestsOriginAgentCluster();
      if (requestsOAC) {
        // SPEC_GAP(document-oac-null-reservation): HTML's security check requires an environment,
        // but supplied-response navigation permits null. Use the incoming Window's
        // security inputs in that case, without inventing a Fetch reservation.
        const isSecureContext = params.reservedEnv?.isSecureContext ??
          group.userAgent.computeWindowSecureContext(params.origin, parent?.env);
        // SPEC_CLASH(document-oac-insecure-ancestor): Keep HTML/WebKit's secure-context gate;
        // Chromium/Firefox honor an HTTPS child's OAC header even beneath an insecure HTTP parent.
        if (!isSecureContext) requestsOAC = false;
      }
      const agent = group.obtainSimilarOriginWindowAgent(params.origin, requestsOAC);
      const parentEnv = this.container?.env;
      const topLevelCreationURL = parentEnv === undefined ? creationURL : parentEnv.topLevelCreationURL;
      const topLevelOrigin = parentEnv === undefined ? params.origin : parentEnv.topLevelOrigin;
      if (topLevelCreationURL === null || topLevelOrigin === null) {
        throw new InternalError('Document creation requires initialized parent Window settings');
      }
      window = group.userAgent.createWindowEnvironment({
        agent, userAgent: group.userAgent,
        creationURL,
        origin: params.origin,
        parent,
        topLevelCreationURL,
        topLevelOrigin,
        reservedEnv: params.reservedEnv,
        previousRealm: browsingContext.activeWindow.env.realm,
      }).window;
    }

    // Steps 8–9 create fresh Document state even when the initial Window is reused.
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
    // Consume the selected cookie URL; local-URL producer/history capture remains a NavigationParams dependency.
    document.cookieURL = copyURL(params.cookieURL);
    document.allowDeclarativeShadowRoots = true;
    // TODO(HTML §4.13.4): Registry identity is available; public members and Window exposure remain at its owner.
    document.customElementRegistry = new CustomElementRegistryImpl();

    // Step 10 associates the Window without performing the later history activation of this Document.
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

  /** Insert a populated entry into this navigable's history, then apply the joint history step. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-cross-document-navigation
  finalizeCrossDocumentNavigation(
    historyHandling: HistoryHandlingBehavior,
    userInvolvement: UserNavigationInvolvement,
    historyEntry: SessionHistoryEntry,
  ): void {
    // TODO(HTML §7.4.2.3.1): Enforce traversal-queue ownership once the provisional local loader also queues its commits.
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

    const entryToReplace = historyHandling === 'replace' ? this.activeSessionHistoryEntry : null;
    const traversable = this.traversable;
    const targetEntries = this.getSessionHistoryEntries();
    let targetStep: number;
    if (entryToReplace === null) {
      traversable.clearForwardSessionHistory();
      targetStep = traversable.currentSessionHistoryStep + 1;
      historyEntry.step = targetStep;
      targetEntries.push(historyEntry);
    } else {
      const index = targetEntries.indexOf(entryToReplace);
      if (index < 0) {
        throw new InternalError('Active history entry is not in session history');
      }
      targetEntries[index] = historyEntry;
      historyEntry.step = entryToReplace.step;
      const origin = historyEntry.documentState.origin;
      const previousOrigin = entryToReplace.documentState.origin;
      if (origin !== null && previousOrigin !== null && areSameOrigin(origin, previousOrigin)) {
        historyEntry.navigationAPIKey = entryToReplace.navigationAPIKey;
      }
      targetStep = traversable.currentSessionHistoryStep;
    }

    traversable.applyPushOrReplaceHistoryStep(targetStep, historyHandling, userInvolvement, this, historyEntry);
  }

  /** Complete the provisional local loader's reserved environment and response policies. */
  // TODO(HTML §7.4.5/§7.5.1): Remove this late preparation once params producers, including Browlet's local route,
  // supply complete inputs. Final params, including intentionally null reservations, bypass this adapter.
  #prepareResponsePolicy(params: NavigationParams): void {
    if (params.coopEnforcementResult !== null) return;
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
      isSecureContext: userAgent.computeWindowSecureContext(params.origin, parent?.env),
    });
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
  /** Take responsibility for an asynchronous failure; absent these steps, report on the existing task/parallel owner. */
  failureSteps?: (error: unknown) => void;
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

  /** Reconcile a synchronous same-document change with this traversable's joint history. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#finalize-a-same-document-navigation
  finalizeSameDocumentNavigation(
    targetNavigable: Navigable, targetEntry: SessionHistoryEntry, entryToReplace: SessionHistoryEntry | null,
    historyHandling: HistoryHandlingBehavior, userInvolvement: UserNavigationInvolvement,
  ): void {
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce traversal-queue ownership alongside the other history operations.
    // Return joint-history completion once applyPushOrReplaceHistoryStep() uses the coordinator, retaining nested queue ownership.
    // SPEC_CLASH(same-document-finalization-active-entry): HTML's exact-entry check drops earlier queued pushes/replacements.
    // Preserve updates within the active DocumentState; discard work from a replaced or destroyed Document.
    // https://github.com/whatwg/html/issues/10232 and https://github.com/whatwg/html/issues/10274
    if (targetEntry.document === null || targetNavigable.activeSessionHistoryEntry.documentState !== targetEntry.documentState) return;

    const targetEntries = targetNavigable.getSessionHistoryEntries();
    let targetStep: number;
    if (entryToReplace === null) {
      this.clearForwardSessionHistory();
      targetStep = this.currentSessionHistoryStep + 1;
      targetEntry.step = targetStep;
      targetEntries.push(targetEntry);
    } else {
      const index = targetEntries.indexOf(entryToReplace);
      if (index < 0) throw new InternalError('The same-document replacement entry is not present in session history');
      targetEntries[index] = targetEntry;
      targetEntry.step = entryToReplace.step;
      targetStep = this.currentSessionHistoryStep;
    }
    this.applyPushOrReplaceHistoryStep(targetStep, historyHandling, userInvolvement, targetNavigable, targetEntry);
  }

  /** Reapply the current joint-history step after adding or removing a child. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#update-for-navigable-creation/destruction
  updateForNavigableCreationOrDestruction(): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(this.currentSessionHistoryStep, false, null, null, 'none', null);
  }

  /** Traverse joint history; an omitted source Document denotes a browser-UI request. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#traverse-the-history-by-a-delta
  traverseHistoryByDelta(delta: number, sourceDocument?: DocumentImpl): void {
    const sourceSnapshotParams = sourceDocument === undefined ? null : new SourceSnapshotParams(sourceDocument);
    const initiatorToCheck = sourceDocument?.getNodeNavigable() ?? null;
    const userInvolvement = sourceDocument === undefined ? 'browser UI' : 'none';
    this.appendSessionHistoryTraversalSteps(() => {
      const allSteps = this.getAllUsedHistorySteps();
      const currentStepIndex = allSteps.indexOf(this.currentSessionHistoryStep);
      if (currentStepIndex < 0) throw new InternalError('The current history step is not present');
      const targetStep = allSteps[currentStepIndex + delta];
      if (targetStep === undefined) return;
      return this.applyTraverseHistoryStep(targetStep, sourceSnapshotParams, initiatorToCheck, userInvolvement);
    });
  }

  /** Select the greatest retained step at or before the request, including gaps left by removed children. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-the-used-step
  getUsedStep(step: number): number {
    const steps = this.getAllUsedHistorySteps();
    for (let index = steps.length - 1; index >= 0; index--) {
      if (steps[index]! <= step) return steps[index]!;
    }
    throw new InternalError('The requested history step has no retained predecessor');
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
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce queue ownership after local commits and history application use their specified queues.
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

  /** Apply the current joint-history step as a reload, with cancellation checks and no external initiator. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-reload-history-step
  applyReloadHistoryStep(userInvolvement: UserNavigationInvolvement): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(this.currentSessionHistoryStep, true, null, null, userInvolvement, 'reload');
  }

  /** Apply a traversal with cancellation checks, its captured source, and initiating navigable. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-traverse-history-step
  // Browser-UI delta traversal supplies null source/initiator, as accepted by the underlying apply-history-step operation.
  applyTraverseHistoryStep(
    step: number, sourceSnapshotParams: SourceSnapshotParams | null,
    initiatorToCheck: Navigable | null, userInvolvement: UserNavigationInvolvement,
  ): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(step, true, sourceSnapshotParams, initiatorToCheck, userInvolvement, 'traverse');
  }

  /** Resume an intercepted same-document traversal after its cancellation checks have passed. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#resume-applying-the-traverse-history-step
  resumeTraverseHistoryStep(step: number, userInvolvement: UserNavigationInvolvement): InternalPromise<HistoryStepResult> {
    return this.applyHistoryStep(step, false, null, null, userInvolvement, 'traverse');
  }

  /** Activate the selected entry and retarget its browsing context's WindowProxy. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-push/replace-history-step
  // PROVISIONAL: Only the supplied entry participates; §7.4.6 must select all affected navigables from the target step.
  applyPushOrReplaceHistoryStep(
    targetStep: number, historyHandling: HistoryHandlingBehavior, userInvolvement: UserNavigationInvolvement,
    navigable: Navigable, historyEntry: SessionHistoryEntry,
  ): void {
    const document = historyEntry.documentState.document;
    if (document === null) return;
    if (navigable.activeDocument === document) {
      // TODO(HTML §7.4.6): Reconcile same-document history on the Document's event loop without
      // repeating synchronous events, rewinding a newer active entry, or reinitializing Navigation.
      // Nested application must coordinate joint-step allocation with queued updates (HTML issue #12576).
      throw new InternalError('Same-document history-step application is not implemented');
    }

    // TODO(HTML §7.4.6): Unload/reactivate Documents and update nonchanging Documents on their own event loops.
    // Forward user involvement to those updates; source/initiator and cancellation checks are null/false on this path.
    void userInvolvement;
    const previousEntryForActivation = navigable.activeSessionHistoryEntry;
    [document.history.lengthValue, document.history.index] = this.getHistoryLengthAndIndex(targetStep);
    document.latestEntry = historyEntry;
    navigable.currentSessionHistoryEntry = historyEntry;
    navigable.activeSessionHistoryEntry = historyEntry;
    this.currentSessionHistoryStep = targetStep;
    document.makeActive();
    // TODO(HTML §7.4.6.1): Replace this provisional activation with activateHistoryEntry() through the full coordinator,
    // once savePersistedState() can capture the departing entry rather than throwing at its §7.4.6.5 boundary.
    document.setInitialVisibilityState(navigable.traversable.systemVisibilityState);
    // This provisional caller only commits newly-created Documents. Reactivation and same-document
    // updates need their separate §7.2.6.4 algorithms, events, and tracker settlement.
    document.getRelevantGlobalObject()!.navigation.initializeEntriesForNewDocument(
      navigable.getSessionHistoryEntriesForNavigationAPI(targetStep), historyEntry,
    );
    document.getRelevantGlobalObject()!.navigation.updateActivation(historyHandling, previousEntryForActivation);
    // PROVISIONAL: this local loader commits synchronously. Full history application owns the same script gate
    // after persisted-state restoration, BiDi committed reporting, and fragment-scroll scheduling.
    document.setReadyToRunScripts();
  }

  /** Begin applying joint history, waiting for cancellation before advancing current entries. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#apply-the-history-step
  // The UserAgent-owned completion carries the result while keeping the traversal queue occupied.
  applyHistoryStep(
    step: number, checkForCancelation: boolean, sourceSnapshotParams: SourceSnapshotParams | null,
    initiatorToCheck: Navigable | null, userInvolvement: UserNavigationInvolvement, navigationType: NavigationType | null,
  ): InternalPromise<HistoryStepResult> {
    const queue = this.sessionHistoryTraversalQueue;
    const userAgent = queue.userAgent;
    const P = userAgent.HostPromise;
    const resultType = internalType<HistoryStepResult>();
    return P.try(() => {
      if (!queue.isExecuting) throw new InternalError('History application must begin in its session history traversal queue');
      const targetStep = this.getUsedStep(step);
      if (initiatorToCheck !== null) {
        if (sourceSnapshotParams === null) throw new InternalError('History traversal with an initiator requires a source snapshot');
        for (const navigable of this.getNavigablesThatWillChangeOrReload(targetStep)) {
          if (!initiatorToCheck.isAllowedBySandboxingToNavigate(navigable, sourceSnapshotParams)) return 'initiator-disallowed';
        }
      }

      const crossing = this.getNavigablesThatMightCrossDocuments(targetStep);
      const check = checkForCancelation
        ? userAgent.checkIfUnloadingIsCanceled(crossing, this, targetStep, userInvolvement)
        : P.resolve('continue', internalType<UnloadCancellationResult>());
      return check.then((result) => {
        if (result !== 'continue') return result;
        // Cancellation callbacks can change entries and child navigables. Select both lists before writing current entries.
        let changingNavigables = this.getNavigablesThatWillChangeOrReload(targetStep);
        if (navigationType === null) {
          // SPEC_CLASH(history-bookkeeping-navigation): HTML lets creation/destruction take over pending navigations (#12724).
          // Follow browser isolation and Ladybird's guard: leave reload/document changes to their owning navigation.
          changingNavigables = changingNavigables.filter((navigable) => {
            const ongoing = navigable.ongoingNavigation;
            if (ongoing !== null && ongoing !== 'traversal') return false;
            const targetEntry = navigable.getTargetHistoryEntry(targetStep);
            return ongoing === 'traversal' ||
              (targetEntry.document === navigable.activeDocument && !targetEntry.documentState.reloadPending);
          });
        }
        const nonchangingNavigables = this.getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(targetStep);
        for (const navigable of changingNavigables) {
          const targetEntry = navigable.getTargetHistoryEntry(targetStep);
          navigable.currentSessionHistoryEntry = targetEntry;
          if (targetEntry.document !== navigable.activeDocument) {
            const window = navigable.activeWindow;
            if (window === null) throw new InternalError('History-step Navigation cleanup requires an active Window');
            window.env.queueTask('navigation-and-traversal', () => {
              const navigation = navigable.activeWindow?.navigation;
              if (navigation === undefined) throw new InternalError('History-step Navigation cleanup requires an active Window');
              navigation.ongoingNavigateEvent = null;
              navigation.ongoingAPIMethodTracker = null;
            });
          }
          // Assignment wakes parallel waits without aborting the successful navigation's event or tracker.
          navigable.ongoingNavigation = 'traversal';
        }

        // TODO(HTML §7.4.6.1, step 9 onward): Connect Navigable.prepareHistoryStep() to a continuation queue,
        // processing ready jobs alongside runSynchronousNavigationSteps() and wake-ups for new tagged appends.
        // Add each dequeued continuation's navigable to the waiting set before dispatching its activation/update job.
        // Retain displayed-Document ownership through deactivation (HTML #12668); population can replace its shared state.
        // Call Document.deactivateForCrossDocumentNavigation() for cross-document changes before activation.
        // Its CSS eligibility/setup and recursive-unloading owners still throw explicitly.
        // Call activateHistoryEntry() for non-update-only continuations after any required unloading.
        // Connect failureSteps to completion so rejected jobs release the wait without duplicate reporting.
        // Run Document.updateForHistoryStepApplication() on each Document's loop, including classic
        // state, latestEntry, Navigation notifications, visibility, scrolling, and persisted state.
        // Update nonchangingNavigables on their loops and finish the joint step only after all jobs complete.
        // Connect task-discard notifications to coordinator cleanup; in-flight population still needs teardown cancellation.
        void nonchangingNavigables;
        throw new InternalError('History-step population and activation is not implemented');
      }, undefined, resultType);
    }, resultType);
  }

  /** Run eligible synchronous navigations before taking the next ready history continuation. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#sync-navigations-jump-queue
  runSynchronousNavigationSteps(waitingNavigables: Set<Navigable>): InternalPromise<void> {
    const queue = this.sessionHistoryTraversalQueue;
    const P = queue.userAgent.HostPromise;
    const runNext = (): void | InternalPromise<void> => {
      if (this.runningNestedApplyHistoryStep) return;
      while (true) {
        let steps: SessionHistoryTraversalSteps | undefined;
        for (const candidate of queue.algorithmSet) {
          if (candidate.targetNavigable !== undefined && !waitingNavigables.has(candidate.targetNavigable)) {
            steps = candidate;
            break;
          }
        }
        if (steps === undefined) return;
        queue.algorithmSet.delete(steps);
        this.runningNestedApplyHistoryStep = true;
        try {
          const completion = queue.runSteps(steps);
          if (completion !== undefined) {
            return P.fromInternal(completion).then(() => {
              this.runningNestedApplyHistoryStep = false;
              return runNext();
            }, (error) => {
              this.runningNestedApplyHistoryStep = false;
              throw error;
            }, internalType<void>());
          }
        } catch (error) {
          this.runningNestedApplyHistoryStep = false;
          throw error;
        }
        this.runningNestedApplyHistoryStep = false;
      }
    };
    return P.try(() => queue.runSteps(runNext), internalType<void>());
  }

  /** Select entries that differ from the current entry or have a pending reload. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#get-all-navigables-whose-current-session-history-entry-will-change-or-reload
  getNavigablesThatWillChangeOrReload(targetStep: number): Navigable[] {
    const results: Navigable[] = [];
    const navigablesToCheck: Navigable[] = [this];
    for (const navigable of navigablesToCheck) {
      const targetEntry = navigable.getTargetHistoryEntry(targetStep);
      const reloadPending = targetEntry.documentState.reloadPending;
      if (targetEntry !== navigable.currentSessionHistoryEntry || reloadPending) results.push(navigable);
      if (targetEntry.document === navigable.activeDocument && !reloadPending) {
        for (const child of navigable.childNavigables) navigablesToCheck.push(child);
      }
    }
    return results;
  }

  /** Select unchanged branches whose Documents only need the joint-history length and index. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-all-navigables-that-only-need-history-object-length/index-update
  getNavigablesThatOnlyNeedHistoryLengthAndIndexUpdate(targetStep: number): Navigable[] {
    const results: Navigable[] = [];
    const navigablesToCheck: Navigable[] = [this];
    for (const navigable of navigablesToCheck) {
      const targetEntry = navigable.getTargetHistoryEntry(targetStep);
      if (targetEntry === navigable.currentSessionHistoryEntry && !targetEntry.documentState.reloadPending) {
        results.push(navigable);
        for (const child of navigable.childNavigables) navigablesToCheck.push(child);
      }
    }
    return results;
  }

  /** Select possible cross-document traversals; descendants of a selected navigable unload with it. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#getting-all-navigables-that-might-experience-a-cross-document-traversal
  getNavigablesThatMightCrossDocuments(targetStep: number): Navigable[] {
    const results: Navigable[] = [];
    const navigablesToCheck: Navigable[] = [this];
    for (const navigable of navigablesToCheck) {
      const targetEntry = navigable.getTargetHistoryEntry(targetStep);
      if (targetEntry.document !== navigable.activeDocument || targetEntry.documentState.reloadPending) {
        results.push(navigable);
      } else {
        for (const child of navigable.childNavigables) navigablesToCheck.push(child);
      }
    }
    return results;
  }

  /** Discard forward entries in this traversable and the child histories retained after pruning. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#clear-the-forward-session-history
  clearForwardSessionHistory(): void {
    // TODO(HTML §7.4.1.4/§7.4.6): Enforce queue ownership after local commits and history application use their specified queues.
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

  /** Repair pointer targets after unlinking, without dispatching during removal. */
  // https://w3c.github.io/pointerevents/#firing-events-using-the-pointerevent-interface
  // https://w3c.github.io/pointerevents/#implicit-release-of-pointer-capture
  // Scan the existing streams once per removal, rather than retaining a reverse
  // target registry or walking every node in the removed subtree.
  notifyPointerTargetRemoval(): void {
    for (const stream of this.pointerEventStreams.values()) {
      stream.clearDisconnectedTarget();
      const pending = stream.capture.pendingTargetOverride;
      if (pending && !pending.isConnected) stream.releasePointerCapture(pending);
    }
  }

  /** Discard one Document's pointer references while retaining the shared input sources and other Documents' state. */
  clearPointerStateForDocument(document: DocumentImpl): void {
    for (const stream of this.pointerEventStreams.values()) stream.clearForDocument(document);
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
    const userAgent = document.env.userAgent;
    userAgent.checkIfUnloadingIsCanceled(toUnload).observe((status) => {
      if (status !== 'continue') return;
      this.appendSessionHistoryTraversalSteps(() => {
        const activeDocument = this.activeDocument;
        if (activeDocument === null) throw new InternalError('Closing requires an active Document when unloading begins');
        // SPEC_GAP(top-level-close-destroyed-document): HTML retrieves the context after unloading can clear it; retain it before unloading.
        const browsingContext = activeDocument.browsingContext;
        if (browsingContext === null) throw new InternalError('Closing requires a browsing context when unloading begins');
        activeDocument.unloadAndDescendants(null, () => { this.destroy(browsingContext); });
      });
    }, (error) => { userAgent.runInParallel(() => { throw error; }); });
  }

  /** Collect the active document tree's diagnostics and mask cross-origin descendants before exposure. */
  // https://html.spec.whatwg.org/multipage/browsing-the-web.html#build-not-restored-reasons-for-a-top-level-traversable-and-its-descendants
  buildNotRestoredReasons(): void {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Restoration diagnostics require an active Document');
    document.buildNotRestoredReasons();
    // TODO(HTML lifecycle): Unloading/cache eviction must call this before destruction; Navigation Timing must consume the filtered record.
  }
}

/** Retained first-half history-job state, consumed later when synchronous navigations permit activation. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#changing-navigable-continuation-state
export interface ChangingNavigableContinuationState {
  /** Document displayed before population can replace the target entry's shared state. */
  displayedDocument: DocumentImpl;
  /** Entry selected when the preparation task runs. */
  targetEntry: SessionHistoryEntry;
  /** Destination retained independently of the displayed Document's later activity. */
  navigable: Navigable;
  /** Whether the later job only updates history rather than unloading and activating a Document. */
  updateOnly: boolean;
}

/** Outcome of applying a history step, including cancellation before or during navigate-event firing. */
export type HistoryStepResult = 'initiator-disallowed' | 'canceled-by-beforeunload' | 'canceled-by-navigate' | 'applied';

/** Result shared by navigation, closing, and history traversal's asynchronous unload checks. */
export type UnloadCancellationResult = 'canceled-by-beforeunload' | 'canceled-by-navigate' | 'continue';
