import { asciiLower, assertNever, HTML_NAMESPACE, InternalError, internalType, type InternalPromise } from '../../../infra/index';
import { bindAsyncContext, randomUUID } from '../../../js-engine/index';
import { DOMExceptionImpl } from '../../../web-idl/core/index';
import { coarsenedSharedCurrentTime } from '../../../timing/index';
import { utf8Decode, utf8Encode } from '../../../encoding/index';
import {
  aboutBlankURL, areSameOrigin, areSameOriginDomain, copyURL, createOpaqueOrigin, obtainURLOrigin,
  percentDecodeString, serializeURL, urlsEqual, type Origin, type URLRecord,
} from '../../../url/index';
import {
  getMIMETypeEssence, isAudioOrVideoMIMEType, isHTMLMIMEType, isImageMIMEType,
  isJavaScriptMIMEType, isJSONMIMEType, isXMLMIMEType, type MIMEType,
} from '../../../mime/index';
import type { FormDataEntry } from '../../../xhr/index';
import {
  FetchBody, FetchRequest, FetchResponse, isFetchScheme, type ReferrerPolicy,
} from '../../../fetch/index';

import { ClassicScript, ScriptFetchOptions, type EventLoop } from '../../scripting/index';
import { taskSources } from '../../scripting/tasks';
import type { CSPList } from '../policy/csp/index';
import {
  EmbedderPolicy, OpenerPolicy, PermissionsPolicy, PolicyContainer, queueCOEPInheritanceViolation, SandboxingFlagSet,
} from '../policy/index';
import { DocumentMode, type DocumentImpl, type ElementImpl } from '../../dom/nodes/index';
import {
  HTMLIFrameElementImpl, type HTMLEmbedElementImpl, type HTMLObjectElementImpl,
  type HTMLImageElementImpl, type HTMLMediaElementImpl,
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
import { MultipartResourceReader, processSpeculationRulesHeader, ResourceReader } from '../../loader/index';
import type { UserAgent } from '../../user-agent';

import { BrowsingContext } from './browsing-context';
import { NavigationParams, type NonFetchSchemeNavigationParams, type TargetSnapshotParams } from './params';
import type { Traversable } from './traversable';
import type { TopLevelTraversable } from './top-level-traversable';

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
  /** Outer replacement stream, including intervals without an admitted or committed part Document. */
  multipartResource: MultipartResourceReader | null = null;
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
    if (!this.isTraversable()) {
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
    // A pending first part need not belong to any committed Document yet.
    navigable.multipartResource?.cancel(new DOMExceptionImpl('', 'AbortError')).observe(() => {}, () => {});
    // TODO(HTML §7.5.10): Off-loop abortion is queued against this now-inactive Document; resolve delivery with teardown.
    navigable.informNavigationAPIAboutChildNavigableDestruction(env.responsibleEventLoop);
    const document = navigable.activeDocument;
    if (document === null) throw new InternalError('Child destruction requires an active Document');
    document.destroyAndDescendants().observe(() => {}, (error) => { env.userAgent.runInParallel(() => { throw error; }); });
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
        document.env.queueTask('navigation-and-traversal', {
          run: () => {
            try { steps(); completion.resolve(); }
            catch (error) { completion.reject(error); }
          },
          discard: () => { completion.reject(new InternalError('Unload check task was discarded')); },
        });
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
    return this.isTopLevelTraversable() &&
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
    while (!navigable.isTraversable()) {
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
    if (!navigable.isTopLevelTraversable()) throw new InternalError('A navigable needs a top-level traversable');
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

  /** Identify traversal owners without a runtime dependency on the subclass. */
  isTraversable(): this is Traversable {
    return false;
  }

  /** Identify top-level destinations without a runtime dependency on the subclass. */
  isTopLevelTraversable(): this is TopLevelTraversable {
    return false;
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
    if (this.isTraversable()) return this.sessionHistoryEntries;
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

  /** Find the retained states belonging to this Document, including shared and not-yet-inserted entries. */
  getDocumentStates(document: DocumentImpl): DocumentState[] {
    const matches: DocumentState[] = [];
    // Include current/active entries before insertion and the last committed entry after history pruning.
    const states = new Set([this.activeSessionHistoryEntry.documentState, this.currentSessionHistoryEntry.documentState]);
    if (document.latestEntry !== null) states.add(document.latestEntry.documentState);
    for (const entry of this.traversable.sessionHistoryEntries) states.add(entry.documentState);
    for (const state of states) {
      for (const history of state.nestedHistories) {
        for (const entry of history.entries) states.add(entry.documentState);
      }
      if (state.document === document) matches.push(state);
    }
    return matches;
  }

  /** Release only this Document's history references, preserving entries and their restoration inputs. */
  // Part of https://html.spec.whatwg.org/multipage/document-lifecycle.html#destroy-a-document
  clearDocumentFromHistory(document: DocumentImpl): void {
    for (const state of this.getDocumentStates(document)) state.document = null;
  }

  /** Release finished child associations belonging to a destroyed parent Document. */
  releaseDestroyedChildNavigables(document: DocumentImpl): void {
    for (const child of this.#childNavigables) {
      if (child.containerDocument !== document || child.activeDocument !== null) continue;
      child.multipartResource?.cancel(new DOMExceptionImpl('', 'AbortError')).observe(() => {}, () => {});
      child.container!.contentNavigable = null;
      this.#childNavigables.delete(child);
      // Retain the parent identity for history and pending lifecycle work.
    }
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
    const chosen = userAgent.createTopLevelTraversable(opener, targetName, this);
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
      if (!target.isTopLevelTraversable()) return !sandboxingFlags.has('sandboxed-navigation');
      return !sandboxingFlags.has(hasTransientActivation
        ? 'sandboxed-top-level-navigation-with-user-activation'
        : 'sandboxed-top-level-navigation-without-user-activation');
    }

    if (target.isTopLevelTraversable()) {
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
    // Capture navigation inputs once for the queued and parallel steps below.
    const {
      documentResource = null, response = null, responseReferrer = null,
      exceptionsEnabled = false, historyHandling: historyBehavior = 'auto',
      navigationAPIState = null, formDataEntryList = null, referrerPolicy = '',
      userInvolvement = 'none', sourceElement = null, initialInsertion = false,
      apiMethodTracker = null, multipartResource,
    } = options;
    const referrer = responseReferrer === null ? null : copyURL(responseReferrer);

    // Capture the source state and check its permission to navigate this destination.
    const discardResponse = () => {
      response?.body?.stream.cancelInternal(undefined).observe(() => {}, () => {});
    };
    const runSteps = (steps: () => void) => {
      try { steps(); }
      catch (error) {
        discardResponse();
        // An implementation failure stops the load; an ordinary navigation veto retires only its part.
        multipartResource?.cancel(error).observe(() => {}, () => {});
        throw error;
      }
    };
    const cspNavigationType = formDataEntryList === null ? 'other' : 'form-submission';
    const sourceSnapshotParams = new SourceSnapshotParams(sourceDocument);
    let initiatorOriginSnapshot: Origin = createOpaqueOrigin();
    let initiatorBaseURLSnapshot = copyURL(aboutBlankURL);
    if (sourceDocument === null) {
      if (userInvolvement !== 'browser UI') throw new InternalError('Sourceless navigation requires browser UI involvement');
      if (url.scheme === 'javascript') {
        const document = this.activeDocument;
        if (document === null) throw new InternalError('Navigation requires an active Document');
        initiatorOriginSnapshot = document.origin;
      }
    } else {
      if (userInvolvement === 'browser UI') throw new InternalError('Document-initiated navigation cannot have browser UI involvement');
      const sourceNavigable = sourceDocument.getNodeNavigable();
      if (sourceNavigable === null) throw new InternalError('Navigation requires the source Document\'s node navigable');
      if (!sourceNavigable.isAllowedBySandboxingToNavigate(this, sourceSnapshotParams)) {
        discardResponse();
        if (exceptionsEnabled) throw new DOMExceptionImpl('Sandboxing prevents navigation', 'SecurityError');
        return;
      }
      initiatorOriginSnapshot = sourceDocument.origin;
      initiatorBaseURLSnapshot = sourceDocument.getBaseURL();
    }
    const navigationId = randomUUID();
    const targetEnv = this.activeDocument?.env;
    if (targetEnv === undefined) throw new InternalError('Navigation requires an active Document');

    // These steps read live target state, on its Agent after the source snapshots above.
    const steps = () => {
      let document = this.activeDocument;
      if (document === null) throw new InternalError('Navigation requires an active Document');
      const userAgent = document.env.userAgent;
      if (document.unloadCounter > 0) {
        discardResponse();
        userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
        return;
      }
      const container = this.container;
      if (container instanceof HTMLIFrameElementImpl && container.willLazyLoad()) {
        container.nodeDocument.stopObservingLazyLoadingElement(container);
        container.lazyLoadResumptionSteps = null;
      }
      if (this.isNavigationOrHistoryUpdateBlocked()) {
        discardResponse();
        userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
        return;
      }
      // Select history handling and take the same-document fragment path when applicable.
      const historyHandling = this.resolveHistoryBehavior(url, initiatorOriginSnapshot, historyBehavior, userInvolvement);
      if (
        documentResource === null && response === null &&
        urlsEqual(url, this.activeSessionHistoryEntry.url, true) && url.fragment !== null
      ) {
        this.navigateToFragment(
          url, historyHandling, userInvolvement, sourceElement,
          navigationAPIState, navigationId, apiMethodTracker,
        );
        return;
      }
      // Capture target policy before replacing the ongoing navigation and notifying author code.
      if (this.parent !== null) this.isDelayingLoadEvents = true;
      const targetSnapshotParams = this.snapshotTargetParams();
      userAgent.webDriverBiDiNavigationStarted(this, { id: navigationId, status: 'pending', url });
      if (this.ongoingNavigation === 'traversal') {
        discardResponse();
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
        activeEnv.queueTask('navigation-and-traversal', {
          run: () => this.navigateToJavaScriptURL(
            request, historyHandling, initiatorOriginSnapshot, userInvolvement,
            cspNavigationType, initialInsertion, navigationId, targetSnapshotParams,
          ),
        });
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
          ? formDataEntryList : null;
        const shouldContinue = navigation.firePushReplaceReloadNavigateEvent(historyHandling, url, false, {
          userInvolvement, sourceElement: sourceElement ?? undefined, formDataEntryList: entryListForFiring ?? undefined,
          navigationAPIState: navigationAPIState ?? navigation.env.serializeForStorage(undefined),
          apiMethodTracker: apiMethodTracker ?? undefined,
        });
        if (!shouldContinue) { discardResponse(); return; }
      }
      const currentContainer = this.container;
      // SPEC_GAP(deferred-fetch-null-container): Browser-UI top-level navigation has neither
      // a source Document nor a container Document; their equality cannot reserve on a null container.
      if (currentContainer !== null && sourceDocument === currentContainer.nodeDocument) {
        currentContainer.reserveDeferredFetchQuota(obtainURLOrigin(url));
      }

      // In parallel, check unloading and populate an entry before queued history finalization.
      userAgent.runInParallel(() => runSteps(() => {
        const activeDocument = this.activeDocument;
        if (activeDocument === null) throw new InternalError('Navigation requires an active Document');
        userAgent.checkIfUnloadingIsCanceled(activeDocument.getInclusiveDescendantNavigables()).observe((unloadStatus) => {
          userAgent.runInParallel(() => runSteps(() => {
            if (unloadStatus !== 'continue' || this.ongoingNavigation !== navigationId) {
              discardResponse();
              activeDocument.env.userAgent.webDriverBiDiNavigationFailed(this, { id: navigationId, status: 'canceled', url });
              return;
            }
            const activeEnv = this.activeWindow?.env;
            if (activeEnv === undefined) throw new InternalError('Navigation requires an active Window');
            activeEnv.queueTask('navigation-and-traversal', {
              run: () => {
                const documentToAbort = this.activeDocument;
                if (documentToAbort === null) throw new InternalError('Navigation abortion requires an active Document');
                for (const descendant of documentToAbort.getDescendantNavigables()) {
                  descendant.multipartResource?.cancel(new DOMExceptionImpl('', 'AbortError')).observe(() => {}, () => {});
                }
                documentToAbort.abortAndDescendants();
              },
            });
            const documentState = DocumentState.createForNavigation(
              url, initiatorOriginSnapshot, initiatorBaseURLSnapshot,
              referrerPolicy, documentResource, this.targetName,
            );
            if (response !== null) documentState.requestReferrer = referrer;
            const historyEntry = activeEnv.createSessionHistoryEntry(url, documentState);
            const navigationParams = response === null ? undefined : NavigationParams.fromResponse(
              response, this, sourceDocument, targetSnapshotParams, documentState,
              navigationId, userInvolvement, activeEnv,
            );
            this.populateHistoryEntryDocument(historyEntry, 'navigate', sourceSnapshotParams, targetSnapshotParams, userInvolvement, {
              navigationId, navigationParams, cspNavigationType, allowPOST: true,
              failureSteps: multipartResource === undefined ? undefined : (error) => {
                userAgent.runInParallel(() => runSteps(() => { throw error; }));
              },
              completionSteps: () => {
                this.traversable.appendSessionHistoryTraversalSteps(() => {
                  // TODO(HTML §7.4.6): History application still needs unloading and updates for every affected navigable.
                  this.finalizeCrossDocumentNavigation(historyHandling, userInvolvement, historyEntry);
                });
              },
            });
          }));
        }, (error) => { userAgent.runInParallel(() => runSteps(() => { throw error; })); });
      }));
    };

    if (env?.realm.agent === targetEnv.realm.agent) runSteps(steps);
    else targetEnv.queueTask('navigation-and-traversal', { run: () => runSteps(steps), discard: discardResponse });
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
    const discard = failureSteps === undefined ? undefined : () => { failureSteps(new InternalError('History preparation task was discarded')); };
    window.env.queueTask('navigation-and-traversal', {
      run: () => runSteps(() => {
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
                  activeWindow.env.queueTask('navigation-and-traversal', { run: () => runSteps(afterDocumentPopulated), discard });
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
      }),
      discard,
    });
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
    const discard = failureSteps === undefined ? undefined : () => { failureSteps(new InternalError('History population task was discarded')); };
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
      window.env.queueTask('navigation-and-traversal', {
        run: () => runSteps(() => {
          // Fetch's bare return is cancellation, even if another navigation reuses the null ID.
          if (params === undefined || this.ongoingNavigation !== expectedNavigation) {
            if (params instanceof NavigationParams) params.response.body?.stream.cancelInternal(undefined).observe(() => {}, () => {});
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
                // SPEC_GAP(navigation-history-null-request): HTML asserts a request even for request-less responses.
                // Persist the resolved supplied value (no-referrer by default), without inventing a Fetch request.
                entry.documentState.requestReferrer = params.referrer;
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
            const document = this.createDocumentForInlineContent(null, navigationTimingType, userInvolvement, params?.url ?? entry.url);
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
            } else {
              params.response.body?.stream.cancelInternal(undefined).observe(() => {}, () => {});
            }
            // SPEC_CLASH(navigation-empty-attachment): HTML/Chromium/WebKit select downloads before 204/205;
            // Firefox ignores those statuses without downloading. Both branches leave the entry unpopulated.
          } else if (params.response.status !== 204 && params.response.status !== 205) {
            const resource = new ResourceReader(params.response, window.env.userAgent);
            // Creating the incoming Document can reuse this Window and change its associated
            // Document before history activation. Keep admission tasks on the still-active Document.
            const taskDocument = this.activeDocument;
            const queueAdmission = (steps: () => void, discardSteps = discard) => window.env.responsibleEventLoop.queueTask(
              taskSources['navigation-and-traversal'], taskDocument, { run: bindAsyncContext(() => runSteps(steps)), discard: discardSteps },
            );
            const reportCleanupFailure = (error: unknown) => window.env.userAgent.runInParallel(() => { throw error; });
            const disposeIncomingDocument = (document: DocumentImpl | null) => {
              resource.cancel().observe(() => {}, reportCleanupFailure);
              // The incoming Window may belong to another Agent. Destruction queues its own
              // ungated tasks, releases parser readiness, and preserves a replacement Window.
              document?.destroyAndDescendants().observe(() => {}, reportCleanupFailure);
            };
            const fail = (error: unknown) => queueAdmission(() => { throw error; });
            // Sniffing can wait for bytes. Resume Document creation and retained-state updates on the destination's task.
            // TODO(HTML §7.5): Document teardown must cancel the retained reader if it discards this continuation task.
            resource.determineMIMEType().observe(() => window.env.queueTask('navigation-and-traversal', {
              run: () => runSteps(() => {
                if (this.ongoingNavigation !== expectedNavigation) {
                  // Cleanup can fail after completion; report it separately rather than failing the completed job.
                  resource.cancel().observe(() => {}, (error) => {
                    window.env.queueTask('navigation-and-traversal', { run: () => { throw error; } });
                  });
                  completionSteps?.();
                  return;
                }
                // SPEC_GAP(navigation-timing-history-input): The incoming Document has no node navigable yet.
                // Forward its target state's already-masked diagnostics after redirects, before loader callbacks.
                // Child states hold raw collection data and must not be exposed through their own timing entries.
                params.notRestoredReasons = this.isTopLevelTraversable() ? entry.documentState.notRestoredReasons : null;
                this.loadDocument(params, sourceSnapshotParams, entry.documentState.initiatorOrigin, resource).observe((document) => {
                  queueAdmission(() => {
                    if (this.ongoingNavigation !== expectedNavigation) {
                      disposeIncomingDocument(document);
                      completionSteps?.();
                      return;
                    }
                    entry.documentState.document = document;
                    complete();
                  }, () => {
                    disposeIncomingDocument(document);
                    discard?.();
                  });
                }, fail);
              }),
              discard,
            }), fail);
            return;
          } else {
            params.response.body?.stream.cancelInternal(undefined).observe(() => {}, () => {});
          }
          complete();
        }),
        discard,
      });
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
      userInvolvement, sourceElement: sourceElement ?? undefined, navigationAPIState: destinationNavigationAPIState,
      apiMethodTracker: apiMethodTracker ?? undefined,
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
    // SPEC_CLASH(legacy-navigation-fragment-type): Follow Chromium/WebKit's last non-redirect navigation
    // classification; Firefox retains the original load type. Canceled/intercepted paths returned above.
    document.legacyNavigationType = 'navigate';
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
    return this.createDocumentForInlineContent(params.id, params.navigationTimingType, params.userInvolvement, params.url);
  }

  /** Create a browser-provided page without activating it or committing history. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#navigate-ua-inline
  createDocumentForInlineContent(
    navigationId: string | null, navigationTimingType: NavigationTimingType, userInvolvement: UserNavigationInvolvement,
    url: URLRecord, resource?: ResourceReader,
  ): DocumentImpl {
    const window = this.activeWindow;
    if (window === null) throw new InternalError('Inline content requires an active Window');
    const env = window.env;
    // SPEC_GAP(inline-document-response): HTML reads an undefined response URL, then creates a response
    // without a URL. Retain the caller's destination on a fresh response; the original resource stays separate.
    const response = new FetchResponse();
    response.urlList.push(copyURL(url));
    const params = new NavigationParams(
      response, new SandboxingFlagSet(), coarsenedSharedCurrentTime(env.crossOriginIsolatedCapability).milliseconds,
    );
    params.id = navigationId;
    params.origin = createOpaqueOrigin();
    params.navigationTimingType = navigationTimingType;
    params.userInvolvement = userInvolvement;
    params.coopEnforcementResult = {
      url: params.url, origin: params.origin, openerPolicy: params.openerPolicy,
      needsBrowsingContextGroupSwitch: false,
      wouldNeedBrowsingContextGroupSwitchDueToReportOnly: false,
      currentContextIsNavigationSource: false,
    };
    // The remaining NavigationParams defaults supply null request/Fetch/reservation slots and fresh,
    // empty policies. Do not run the original response's policy preparation for browser-owned content.
    const document = this.createAndInitializeDocument('html', 'text/html', params);
    env.userAgent.renderInlineDocument(document, resource);
    document.waitForScriptsMayRun().observe(() => document.env.queueTask('network', {
      run: () => {
        // TODO(HTML stop-parsing/§7.5.8): Replace provisional completion with the full lifecycle,
        // including iframe load steps for both blocked responses and network errors.
        document.finishLoading();
      },
    }), (error) => document.env.queueTask('network', { run: () => { throw error; } }));
    return document;
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
        navigationAPIState, userInvolvement, apiMethodTracker: options.apiMethodTracker,
      })) return;
    }

    this.activeSessionHistoryEntry.documentState.reloadPending = true;
    const traversable = this.traversable;
    traversable.appendSessionHistoryTraversalSteps(() => traversable.applyReloadHistoryStep(userInvolvement));
  }

  /** Stop ordinary navigation and abort loading without canceling a history traversal. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#nav-stop
  stopLoading(): void {
    const document = this.activeDocument;
    if (document === null) throw new InternalError('Stopping navigation requires an active Document');
    if (!document.env.responsibleEventLoop.isRunningTaskOrCheckpoint) {
      throw new InternalError('Stopping navigation requires a task on its owning event loop');
    }
    // SPEC_CLASH(stop-during-unload): HTML only preserves the navigation ID; browsers also leave parsing
    // untouched during dismissal. Ignore the whole stop while the Document's unload counter is nonzero.
    if (document.unloadCounter !== 0) return;
    for (const navigable of document.getInclusiveDescendantNavigables()) {
      if (navigable.multipartResource === null) continue;
      navigable.multipartResource.cancel(new DOMExceptionImpl('', 'AbortError')).observe(() => {}, () => {});
      navigable.activeDocument?.makeUnsalvageable('fetch');
    }
    if (this.ongoingNavigation !== null && this.ongoingNavigation !== 'traversal') {
      this.setOngoingNavigation(null, document.env);
    }
    document.abortAndDescendants();
    // TODO(HTML #6905): Browser-UI stopping of traversal has a separate, unspecified operation.
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
    else window.env.queueTask('navigation-and-traversal', { run: abort });
  }

  /** Notify abortion, then reject the pending traversal requests for the selected child Window. */
  // https://html.spec.whatwg.org/multipage/nav-history-apis.html#inform-the-navigation-api-about-child-navigable-destruction
  // SPEC_MISMATCH: inform the navigation API about child navigable destruction(navigable)
  informNavigationAPIAboutChildNavigableDestruction(callerEventLoop: EventLoop | null): void {
    const navigation = this.activeWindow?.navigation;
    if (navigation === undefined) throw new InternalError('Child destruction notification requires an active Window');
    const eventLoop = navigation.env.responsibleEventLoop;
    if (callerEventLoop === eventLoop) {
      this.informNavigationAPIAboutAbortingNavigation(callerEventLoop);
    } else {
      // SPEC_CLASH(document-destruction-task-activity): Detachment must not strand this teardown notification.
      // Ordinary navigation abortion retains its global-task activity gate.
      eventLoop.queueTask(taskSources['navigation-and-traversal'], null, {
        run: () => {
          this.informNavigationAPIAboutAbortingNavigation(eventLoop);
        },
      });
    }
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
  // MIME preparation precedes dispatch; multipart admission additionally waits for its first part.
  loadDocument(
    params: NavigationParams, sourceSnapshotParams: SourceSnapshotParams, initiatorOrigin: Origin | null,
    resource: ResourceReader,
  ): InternalPromise<DocumentImpl | null> {
    const type = resource.mimeType;
    const essence = getMIMETypeEssence(type);
    const userAgent = this.activeWindow!.env.userAgent;
    return userAgent.HostPromise.try(() => {
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
          return this.createDocumentForInlineContent(params.id, params.navigationTimingType, params.userInvolvement, params.url, resource);
        }
      }
      if (handler === 'inline' || handler === undefined && userAgent.shouldDisplayUnsupportedResourceInline(type)) {
        return this.createDocumentForInlineContent(params.id, params.navigationTimingType, params.userInvolvement, params.url, resource);
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
    }, internalType<DocumentImpl | null>());
  }

  /**
   * Create an HTML document after handler selection and start consuming its response.
   * Reuse navigation's prepared reader, or read a directly supplied HTML response.
   * The optional script handler remains a provisional integration seam until §4.12.1 preparation exists.
   */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-html
  loadHTMLDocument(
    params: NavigationParams, handleScript?: ScriptHandler, resource?: ResourceReader,
  ): DocumentImpl {
    const document = this.createAndInitializeDocument('html', 'text/html', params);
    const { env } = document;
    // SPEC_CLASH(javascript-about-blank-body): All three browsers parse string-result bodies at
    // about:blank; follow them instead of HTML's unconditional empty-document branch.
    // A null request with a body identifies supplied HTML, including an empty string result.
    if (document.URL === 'about:blank' && (params.request !== null || params.response.body === null)) {
      // SPEC_CLASH(loaded-about-blank-quirks): HTML omits the mode change; all three browsers
      // use quirks for a non-initial empty about:blank, as they do for the initial Document.
      document.mode = DocumentMode.Quirks;
      document.populateWithHTMLHeadBody();
      // There is no parser EOF on this branch. Finish through the same queued lifecycle
      // handoff after history activation, retaining finishLoading's explicit dependencies.
      env.queueTask('network', { run: () => { document.finishLoading(); } });
      return document;
    }

    const parser = new HTMLDocumentParser(
      document,
      (element, write) => document.waitForScriptsMayRun().then(() => {
        if (parser.stopped) return;
        // TODO(HTML §4.12.1/§13.2): Prepare parser-inserted scripts, including their type,
        // fetch, pending parsing-blocking state, execution, and document.write insertion point.
        if (handleScript === undefined) throw new InternalError('Parser script preparation is not implemented');
        return handleScript(element, write);
      }),
    );
    // PROVISIONAL(HTML bytes): BOM/transport decoding works; full encoding
    // selection and replay for restart remain with the parser integration.
    const parsing = parser.parseBytes(
      resource ?? new ResourceReader(params.response, env.userAgent),
      () => document.processLinkHeaders(params.response, 'media'),
    );
    parsing.observe(
      () => env.queueTask('network', {
        run: () => {
          document.finishLoading();
        },
      }),
      (error) => env.queueTask('network', {
        run: () => {
          document.abort();
          // An unfinished implementation must remain visible; ordinary body failures abort loading.
          if (error instanceof InternalError) throw error;
        },
      }),
    );
    return document;
  }

  /** Create and begin parsing an XML response after MIME dispatch. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-xml
  // Keep the parsed MIME type and prepared reader at the loader boundary instead of serializing and parsing them again.
  loadXMLDocument(_params: NavigationParams, _type: MIMEType, _resource: ResourceReader): DocumentImpl {
    // TODO(HTML §7.5.3/XML/Namespaces/RFC 7303): Deferred until Browlet's XML parser work.
    // Create the XML Document, decode its bytes, build the namespace-aware tree, process media Link headers,
    // gate scripts, clear during-loading navigation ID at EOF, and integrate errors/completion/abortion.
    throw new InternalError('XML document loading is not implemented');
  }

  /** Create a text presentation without interpreting the response as HTML. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-text
  loadTextDocument(params: NavigationParams, type: MIMEType, resource: ResourceReader): DocumentImpl {
    const document = this.createAndInitializeDocument('html', getMIMETypeEssence(type), params);
    const { env } = document;
    document.parserCannotChangeMode = true;
    document.mode = DocumentMode.NoQuirks;
    const parser = new HTMLDocumentParser(document, () => {
      // Text cannot create scripts, and this loader adds no optional user-agent head content.
      throw new InternalError('A text document parser cannot execute scripts');
    });
    // SPEC_CLASH(empty-text-document-pre): HTML/Firefox create pre even for empty input;
    // Chromium/WebKit wait for input. Keep HTML's immediate presentation.
    parser.initializeForText();
    // TODO(HTML §7.5.4/MIME encoding): Apply the computed type's decoding rules and full fallback selection.
    // For now reuse BOM/transport decoding; the remaining policies are inventoried in loader/ROADMAP.md.
    const parsing = parser.parseBytes(resource, () => document.processLinkHeaders(params.response, 'media'));
    parsing.observe(
      () => env.queueTask('network', { run: () => { document.finishLoading(); } }),
      (error) => env.queueTask('network', {
        run: () => {
          document.abort();
          if (error instanceof InternalError) throw error;
        },
      }),
    );
    return document;
  }

  /** Process successive replacement parts through the navigation owner. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-multipart-x-mixed-replace
  loadMultipartDocument(
    params: NavigationParams, sourceSnapshotParams: SourceSnapshotParams, initiatorOrigin: Origin | null,
    resource: ResourceReader,
  ): InternalPromise<DocumentImpl | null> {
    const env = this.activeWindow!.env;
    const userAgent = env.userAgent;
    // Retain the original request metadata across all parts, before callbacks or replacement policy changes.
    const { referrer, referrerPolicy } = params;
    const responseReferrer = referrer === null ? undefined : copyURL(referrer);
    const parts = new MultipartResourceReader(resource, userAgent, (reason) => { finish(); result.reject(reason); });
    this.multipartResource = parts;
    const result = userAgent.HostPromise.withResolvers(internalType<DocumentImpl | null>());
    let ownedNavigation = this.ongoingNavigation;
    let replacing = false;
    const finish = () => {
      if (this.multipartResource === parts) this.multipartResource = null;
      this.#navigationChangeSteps.delete(changed);
    };
    const stop = (reason: unknown) => {
      if (parts.isCanceled) return;
      parts.cancel(reason).observe(() => {}, (error) => {
        // Canceling an already-errored stream rejects with that same stored failure.
        if (error !== reason) userAgent.runInParallel(() => { throw error; });
      });
    };
    const changed = () => {
      if (replacing && this.ongoingNavigation !== null) {
        // Adopt only this replacement; a subsequent author navigation supersedes the stream.
        ownedNavigation = this.ongoingNavigation;
        replacing = false;
      }
      else if (this.ongoingNavigation !== null && this.ongoingNavigation !== ownedNavigation) {
        const reason = new InternalError('Multipart navigation was superseded');
        stop(reason);
      }
    };
    const fail = (error: unknown) => {
      if (parts.isCanceled) return;
      if (!result.isResolved) result.reject(error);
      else if (error instanceof InternalError) userAgent.runInParallel(() => { throw error; });
      stop(error);
    };
    const next = () => parts.readPart().observe((response) => {
      if (parts.isCanceled) return;
      if (response === null) {
        finish();
        return;
      }
      const window = this.activeWindow;
      if (window === null) { stop(new InternalError('Multipart navigable was destroyed')); return; }
      window.env.queueTask('navigation-and-traversal', {
        run: () => {
          if (parts.isCanceled) return;
          try {
            const document = this.activeDocument;
            if (document === null) { stop(new InternalError('Multipart navigable was destroyed')); return; }
            // SPEC_CLASH(multipart-replacement-inputs): HTML reuses the outer response and first Document;
            // use the new part and current Document, so replacement consumes new bytes with a live source.
            // SPEC_GAP(multipart-null-request): Supplied responses have no request; retain their final URL.
            replacing = true;
            this.navigate(params.request?.currentURL ?? params.url, document, {
              response, responseReferrer, referrerPolicy, historyHandling: 'replace', multipartResource: parts,
            }, document.env);
            next();
          } catch (error) { fail(error); }
          finally { replacing = false; }
        },
        discard: () => stop(new InternalError('Multipart replacement task was discarded')),
      });
    }, fail);
    this.#navigationChangeSteps.add(changed);
    parts.readPart().observe((response) => {
      if (parts.isCanceled) return;
      if (response === null) {
        finish();
        result.resolve(null);
        return;
      }
      const partResource = new ResourceReader(response, userAgent);
      partResource.determineMIMEType().observe((type) => env.queueTask('navigation-and-traversal', {
        run: () => {
          try {
            if (result.isResolved || parts.isCanceled) return;
            if (getMIMETypeEssence(type) === 'multipart/x-mixed-replace') {
              // TODO(HTML §7.5.5/RFC 2046 §5.1.2): Coordinate nested replacement streams and their cancellation owners.
              throw new InternalError('Nested multipart Document loading is not implemented');
            }
            const partParams = params.withMultipartResponse(response);
            if (partParams.policyContainer.cspList?.isNavigationResponseBlocked(partParams.request, response, 'other', this, userAgent)) {
              // TODO(HTML §7.5.7): Supply the blocked-part diagnosis to the unfinished browser renderer.
              const document = this.createDocumentForInlineContent(null, params.navigationTimingType, params.userInvolvement, partParams.url);
              document.makeUnsalvageable('navigation-failure');
              partParams.reservedEnv?.discard();
              userAgent.webDriverBiDiNavigationFailed(this, { id: params.id, status: 'canceled', url: partParams.url });
              result.resolve(document);
              stop(new InternalError('Multipart part was blocked by CSP'));
              return;
            }
            this.loadDocument(partParams, sourceSnapshotParams, initiatorOrigin, partResource).observe((document) => {
              if (parts.isCanceled) {
                // Cancellation already settled the load; retire a Document created before that cancellation arrived.
                document?.destroyAndDescendants().observe(() => {}, (error) => userAgent.runInParallel(() => { throw error; }));
                return;
              }
              result.resolve(document);
              if (document === null) { stop(new InternalError('Multipart first part produced no Document')); return; }
              // History initialization releases this gate. No replacement may use an uncommitted source Document.
              document.waitForScriptsMayRun().observe(next, fail);
            }, fail);
          } catch (error) { fail(error); }
        },
        discard: () => fail(new InternalError('Multipart admission task was discarded')),
      }), fail);
    }, fail);
    return result.promise;
  }

  /** Create the supported image/audio/video presentation for this response. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#read-media
  loadMediaDocument(params: NavigationParams, type: MIMEType, resource: ResourceReader): DocumentImpl {
    const localName = type.type === 'image' ? 'img' : type.type === 'audio' ? 'audio' : type.type === 'video' ? 'video' : null;
    if (localName === null) {
      // TODO(HTML §4.8.11): application/ogg requires track inspection to choose audio or video.
      throw new InternalError('Media document element selection requires decoded track information');
    }
    const document = this.createAndInitializeDocument('html', getMIMETypeEssence(type), params);
    document.mode = DocumentMode.NoQuirks;
    document.populateWithHTMLHeadBody();
    // SPEC_CLASH(media-document-host-element): Follow HTML's img/audio/video table and src attribute.
    // All three engines use video for audio; Blink uses a source child and Gecko a retained channel without src.
    const host = document.createElementNode(localName, HTML_NAMESPACE) as HTMLImageElementImpl | HTMLMediaElementImpl;
    document.body!.appendChild(host);
    host.setAttributeNS(null, 'src', document.URL);
    // Hand the prepared response to the element owner, including any bytes retained by sniffing.
    // Its unfinished loading algorithm must establish load-event delays and avoid a second fetch.
    host.loadDocumentResource(resource);
    document.processLinkHeaders(params.response, 'media');
    // No optional user-agent scripts are added. Completion events can execute author callbacks,
    // so they must wait for history initialization to release the new Document's script gate.
    document.waitForScriptsMayRun().observe(() => document.env.queueTask('network', {
      run: () => {
        // TODO(HTML stop-parsing): Replace the provisional finishLoading path with the full lifecycle,
        // including media load-event delays, readiness milestones, and separate DOM tasks.
        document.finishLoading();
      },
    }), (error) => document.env.queueTask('network', { run: () => { throw error; } }));
    return document;
  }

  /** Select the Window and realm, then create the document for a navigation response. */
  // https://html.spec.whatwg.org/multipage/document-lifecycle.html#create-and-initialize-a-document-object
  createAndInitializeDocument(
    type: 'html' | 'xml', contentType: string, params: NavigationParams,
  ): DocumentImpl {
    const { response } = params;
    this.#prepareResponsePolicy(params);
    // As in history population, only an incoming Fetch reservation needs this admission check.
    // In particular, a synthetic error Document must not be rejected by the policy that blocked its response.
    if (params.reservedEnv !== null && !this.checkResponseEmbedderPolicy(response, params.policyContainer.embedderPolicy)) {
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
    // Navigation Timing §8.1 permits implementation-specific Document creation points for domLoading.
    // The Window association selects this Document's time origin before any initialization callbacks.
    document.domLoadingTime = window.env.currentHighResolutionTime().toTimestamp();
    document.initializeAncestry(params.iframeReferrerPolicy, this.containerDocument);
    document.initializeInsecureRequestsPolicy();
    document.initializeCSP();
    document.initializeReferrer(params.referrer);
    document.createNavigationTimingEntry(params);
    document.initializeResponseMetadata(response);
    document.processDefaultStyleHeaders(response);
    window.env.getWindowOrWorkerGlobalScopeMixin().initializeReportingEndpoints(response);

    document.processRefreshHeaders(response);
    params.commitEarlyHints?.(document);
    // CSSOM stylesheet relations are processed once, independently of HTML's two Link phases.
    document.processStyleSheetLinkHeaders(response);
    document.processLinkHeaders(response, 'pre-media');
    // https://html.spec.whatwg.org/multipage/speculative-loading.html#process-the-speculation-rules-header
    if (this.isTopLevelTraversable()) processSpeculationRulesHeader(document, response);
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
    const referrer = params.referrer;
    documentState.requestReferrer = referrer === null ? null : copyURL(referrer);
    documentState.requestReferrerPolicy = params.referrerPolicy;
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
    if (this.isTopLevelTraversable()) {
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
 * Optional inputs to HTML's navigate algorithm; omission is the only absent input value.
 * navigate() supplies HTML's null defaults once. Booleans default to false,
 * historyHandling to 'auto', referrerPolicy to '', and userInvolvement to 'none'.
 */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#navigate
export type NavigateOptions = {
  documentResource?: PostResource | string;
  response?: FetchResponse;
  /** Resolved original referrer for a supplied response; absence selects no-referrer. */
  responseReferrer?: URLRecord;
  exceptionsEnabled?: boolean;
  historyHandling?: NavigationHistoryBehavior;
  navigationAPIState?: SerializedRecord;
  formDataEntryList?: FormDataEntry[];
  referrerPolicy?: ReferrerPolicy;
  userInvolvement?: UserNavigationInvolvement;
  sourceElement?: ElementImpl;
  initialInsertion?: boolean;
  apiMethodTracker?: NavigationAPIMethodTracker;
  /** The navigation-owned outer load supplying this replacement part. */
  multipartResource?: MultipartResourceReader;
};

/** Optional population inputs; IDs/params default to null, CSP type to other, POST to false, and completion to no steps. */
export type PopulateHistoryEntryOptions = {
  navigationId?: string;
  navigationParams?: NavigationParams;
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

/** Optional reload inputs: omitted state retains the active entry's state; involvement defaults to 'none'. */
// https://html.spec.whatwg.org/multipage/browsing-the-web.html#reload
export type ReloadOptions = {
  navigationAPIState?: SerializedRecord;
  userInvolvement?: UserNavigationInvolvement;
  apiMethodTracker?: NavigationAPIMethodTracker;
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

/** Result shared by navigation, closing, and history traversal's asynchronous unload checks. */
export type UnloadCancellationResult = 'canceled-by-beforeunload' | 'canceled-by-navigate' | 'continue';
