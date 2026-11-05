import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable, type HistoryStepResult } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type {
  HTMLEmbedElementImpl, HTMLIFrameElementImpl, HTMLObjectElementImpl,
} from '../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/legacy/frame';
import type { HTMLIFrameElement, HTMLObjectElement, HTMLFrameElement, Window } from '../../../../src/browlet/platform';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { InternalError, internalType } from '../../../../src/infra/index';
import { createOpaqueOrigin, parseURL, type TupleOrigin } from '../../../../src/url/index';
import { getRelevantRealm, project, unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe.each(['iframe', 'object', 'frame'] as const)('%s child-container access', (tag) => {
  it('starts with no child, content Document, or content Window', () => {
    const browser = new Browlet({ route: () => '' });
    const container = browser.document.createElement(tag) as PlatformContainer;

    expect(unwrap<Container>(container).contentNavigable).toBeNull();
    expect(container.contentDocument).toBeNull();
    expect(container.contentWindow).toBeNull();
  });

  it('projects the child Document and WindowProxy with their existing identities', () => {
    const { owner, container, platform, document, navigable } = createChild(tag);

    expect(platform.contentDocument).toBe(project(document));
    expect(platform.contentDocument).toBe(platform.contentDocument);
    expect(platform.contentWindow).toBe(navigable.activeWindowProxy.platform);
    expect(platform.contentWindow).toBe(platform.contentWindow);
    expect(platform.contentDocument).toBeInstanceOf((document.env.global as Window).Document);
    expect(platform.contentDocument).not.toBeInstanceOf((owner.env.global as Window).Document);
    expect(navigable.parent).toBe(owner.getNodeNavigable());
    expect(navigable.container).toBe(container);
    expect(navigable.containerDocument).toBe(owner);
    expect(document.containerDocument).toBe(owner);
  });

  it('hides a foreign Document without hiding its WindowProxy', () => {
    const { owner, platform, document, navigable } = createChild(tag);
    owner.origin = tupleOrigin('parent.example');
    document.origin = tupleOrigin('child.example');

    expect(platform.contentDocument).toBeNull();
    expect(platform.contentWindow).toBe(navigable.activeWindowProxy.platform);
    document.origin = tupleOrigin('parent.example');
    expect(platform.contentDocument).toBe(project(document));
    document.origin = createOpaqueOrigin();
    expect(platform.contentDocument).toBeNull();
    owner.origin = document.origin;
    expect(platform.contentDocument).toBe(project(document));
  });

  it('uses the current same-origin-domain relationship', () => {
    const { owner, platform, document } = createChild(tag);
    const parentOrigin = tupleOrigin('parent.example');
    const childOrigin = tupleOrigin('child.example');
    owner.origin = parentOrigin;
    document.origin = childOrigin;

    parentOrigin.domain = { kind: 'domain', value: 'example' };
    expect(platform.contentDocument).toBeNull();
    childOrigin.domain = { kind: 'domain', value: 'example' };
    expect(platform.contentDocument).toBe(project(document));
    childOrigin.domain = null;
    expect(platform.contentDocument).toBeNull();
  });

  it('reads the active Document and follows browsing-context replacement', () => {
    const { owner, platform, document, navigable } = createChild(tag);
    const proxy = platform.contentWindow;
    const replacement = document.env.createDocument();
    replacement.origin = owner.origin;
    replacement.browsingContext = document.browsingContext;
    navigable.activeWindow!.setAssociatedDocument(replacement);
    navigable.activeSessionHistoryEntry = replacement.env.createSessionHistoryEntry(replacement.url, DocumentState.create(replacement));

    // Compare identity without asking the matcher to inspect native Window properties.
    expect(platform.contentDocument === project(replacement), 'new active Document').toBe(true);
    expect(platform.contentWindow === proxy, 'same browsing context proxy').toBe(true);
    expect(document.containerDocument === null, 'retired Document container').toBe(true);
    expect(replacement.containerDocument === owner, 'replacement Document container').toBe(true);

    const [, switchedDocument] = BrowsingContext.createTopLevel(owner.env.userAgent);
    switchedDocument.origin = owner.origin;
    navigable.activeSessionHistoryEntry = switchedDocument.env.createSessionHistoryEntry(switchedDocument.url, DocumentState.create(switchedDocument));

    expect(platform.contentDocument === project(switchedDocument), 'switched Document').toBe(true);
    expect(platform.contentWindow === navigable.activeWindowProxy.platform, 'switched browsing context proxy').toBe(true);
    expect(platform.contentWindow === proxy, 'old and new proxies differ').toBe(false);
  });

  it('clears both accessors and the reverse links when the child association is removed', () => {
    const { container, platform, document, navigable } = createChild(tag);
    const proxy = platform.contentWindow;
    container.contentNavigable = null;

    expect(platform.contentDocument).toBeNull();
    expect(platform.contentWindow).toBeNull();
    expect(navigable.container).toBeNull();
    expect(navigable.containerDocument).toBeNull();
    expect(document.containerDocument).toBeNull();
    expect(navigable.activeWindowProxy.platform).toBe(proxy);
  });

  it('checks the container\'s current node Document after adoption', () => {
    const { container, platform, document, navigable } = createChild(tag);
    const other = new Browlet({ route: () => '' });
    const otherDocument = unwrap<DocumentImpl>(other.document);
    otherDocument.adoptNode(container);

    expect(navigable.containerDocument).toBe(otherDocument);
    expect(document.containerDocument).toBe(otherDocument);
    expect(platform.contentDocument).toBeNull();
    otherDocument.origin = document.origin;
    expect(platform.contentDocument).toBe(project(document));
  });

  it('borrows getters using the receiver\'s container and rejects incompatible receivers', () => {
    const { platform, document, navigable } = createChild(tag);
    const other = new Browlet({ route: () => '' });
    const otherContainer = other.document.createElement(tag);
    const prototype = Object.getPrototypeOf(otherContainer) as object;
    const documentDescriptor = Object.getOwnPropertyDescriptor(prototype, 'contentDocument')!;
    const windowDescriptor = Object.getOwnPropertyDescriptor(prototype, 'contentWindow')!;
    const documentGetter = Reflect.get(documentDescriptor, 'get') as (this: unknown) => object | null;
    const windowGetter = Reflect.get(windowDescriptor, 'get') as (this: unknown) => object | null;

    expect(documentGetter.call(platform)).toBe(project(document));
    expect(windowGetter.call(platform)).toBe(navigable.activeWindowProxy.platform);
    expect(() => documentGetter.call({})).toThrow(getRelevantRealm(other.window).TypeError);
    expect(() => windowGetter.call({})).toThrow(getRelevantRealm(other.window).TypeError);
    expect(documentDescriptor).toHaveProperty('set', undefined);
    expect(windowDescriptor).toHaveProperty('set', undefined);
  });
});

describe('embed child-navigation state', () => {
  it('maintains the container links and participates in child lookup', () => {
    const { owner, container: iframe, document, navigable } = createChild('iframe');
    const embed = owner.createElement('embed') as HTMLEmbedElementImpl;
    expect(embed.contentNavigable).toBeNull();
    owner.body!.appendChild(embed);
    embed.contentNavigable = navigable;
    navigable.activeSessionHistoryEntry.documentState.navigableTargetName = 'embedded-child';

    expect(iframe.contentNavigable).toBeNull();
    expect(navigable.container).toBe(embed);
    expect(document.containerDocument).toBe(owner);
    expect(owner.getDocumentTreeChildNavigables()).toEqual([navigable]);
    expect(owner.getDescendantNavigables()).toEqual([navigable]);
    const window = navigable.parent!.activeWindowProxy.platform;
    expect(window.length).toBe(1);
    expect(window[0] === navigable.activeWindowProxy.platform).toBe(true);
    expect(Reflect.get(window, 'embedded-child') === navigable.activeWindowProxy.platform).toBe(true);
    expect(Reflect.has(project(embed), 'contentDocument')).toBe(false);
    expect(Reflect.has(project(embed), 'contentWindow')).toBe(false);

    embed.contentNavigable = null;

    expect(navigable.container).toBeNull();
    expect(document.containerDocument).toBeNull();
    expect(owner.getDocumentTreeChildNavigables()).toEqual([]);
    expect(owner.getDescendantNavigables()).toEqual([]);
    expect(window.length).toBe(0);
  });

  it('includes shadow-tree embeds in descendant activity, but not document-tree child lookup', () => {
    const { owner, document, navigable } = createChild('iframe');
    const host = owner.createElement('div');
    owner.body!.appendChild(host);
    const shadow = host.attachShadow({
      mode: 'open', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const embed = owner.createElement('embed') as HTMLEmbedElementImpl;
    shadow.appendChild(embed);
    embed.contentNavigable = navigable;
    const notified = vi.spyOn(document, 'notifyFullyActiveStateChanged');

    owner.notifyFullyActiveStateChanged();

    expect(navigable.container).toBe(embed);
    expect(owner.getDocumentTreeChildNavigables()).toEqual([]);
    expect(owner.getDescendantNavigables()).toEqual([navigable]);
    expect(notified).toHaveBeenCalledExactlyOnceWith();
  });
});

describe('child navigable creation', () => {
  it('creates the inherited iframe context, then reaches the unfinished history population on the queue', async () => {
    const userAgent = new UserAgent();
    const turns: (() => void)[] = [];
    vi.spyOn(userAgent, 'runInParallel').mockImplementation((steps) => { turns.push(steps); });
    const parent = TopLevelTraversable.create(userAgent, null, '');
    const owner = parent.activeDocument!;
    const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
    owner.body!.appendChild(container);

    userAgent.createChildNavigable(container);

    const child = container.contentNavigable!;
    const document = child.activeDocument!;
    expect(child.parent).toBe(parent);
    expect(document.origin).toBe(owner.origin);
    expect(document.isFullyActive()).toBe(true);
    expect(document.policyContainer).not.toBe(owner.policyContainer);
    expect(child.activeBrowsingContext!.activeDocument).toBe(document);
    expect(document.env.realm).not.toBe(owner.env.realm);
    expect(child.activeSessionHistoryEntry.step).toBe('pending');
    expect(parent.activeSessionHistoryEntry.documentState.nestedHistories).toEqual([]);
    expect(turns).toHaveLength(1);
    turns.shift()!();
    await expect.poll(() => turns.length).toBe(1);
    expect(turns.shift()!).toThrow('History-step population and activation is not implemented');
    expect(child.activeSessionHistoryEntry.step).toBe(0);
    expect(parent.activeSessionHistoryEntry.documentState.nestedHistories)
      .toEqual([{ id: child.id, entries: [child.activeSessionHistoryEntry] }]);
  });

  it.each([null, '', 'child-target'])('initializes a child with name %s before queuing its history', (name) => {
    const { parent, container, document, context, createContext, queued, created } = prepareChildCreation();
    if (name !== null) container.setAttribute('name', name);
    parent.systemVisibilityState = 'hidden';
    document.aboutBaseURL = parseURL('https://parent.test/base/').url!;

    container.nodeDocument.env.userAgent.createChildNavigable(container);

    const child = container.contentNavigable!;
    expect(createContext).toHaveBeenCalledExactlyOnceWith(container.nodeDocument, container, parent.activeBrowsingContext!.group);
    expect(child.parent).toBe(parent);
    expect(child.container).toBe(container);
    expect(child.activeDocument).toBe(document);
    expect(child.activeBrowsingContext).toBe(context);
    expect(document.containerDocument).toBe(container.nodeDocument);
    expect(document.visibilityState).toBe('hidden');
    expect(document.isFullyActive()).toBe(true);
    expect(child.targetName).toBe(name ?? '');
    const entry = child.activeSessionHistoryEntry;
    expect(entry).toBe(child.currentSessionHistoryEntry);
    expect(entry.step).toBe('pending');
    expect(entry.documentState.initiatorOrigin).toBe(document.origin);
    expect(entry.documentState.origin).toBe(document.origin);
    expect(entry.documentState.aboutBaseURL).toBe(document.aboutBaseURL);
    expect(parent.activeSessionHistoryEntry.documentState.nestedHistories).toEqual([]);
    expect(queued).toHaveLength(1);
    expect(created).toHaveBeenCalledExactlyOnceWith(child);
    expect(container.env.userAgent.topLevelTraversableSet).toEqual(new Set([parent]));
  });

  it('uses the first entry for the parent Document state when the queued steps run', () => {
    const { parent, container, queued } = prepareChildCreation();
    const initialState = parent.activeSessionHistoryEntry.documentState;
    container.nodeDocument.env.userAgent.createChildNavigable(container);
    const child = container.contentNavigable!;

    // The queue must read the parent's active state at execution, not at insertion.
    const laterState = Object.assign(new DocumentState(), initialState, { nestedHistories: [] });
    const { env } = container.nodeDocument;
    const url = parent.activeSessionHistoryEntry.url;
    const first = env.createSessionHistoryEntry(url, laterState);
    first.step = 2;
    const current = env.createSessionHistoryEntry(url, laterState);
    current.step = 4;
    parent.sessionHistoryEntries.push(first, current);
    parent.activeSessionHistoryEntry = current;
    const update = vi.spyOn(parent, 'updateForNavigableCreationOrDestruction').mockImplementation(() => {
      expect(child.activeSessionHistoryEntry.step).toBe(2);
      expect(child.getSessionHistoryEntries()).toEqual([child.activeSessionHistoryEntry]);
      return env.userAgent.HostPromise.resolve('applied', internalType<HistoryStepResult>());
    });

    queued[0]!();

    expect(initialState.nestedHistories).toEqual([]);
    expect(laterState.nestedHistories).toEqual([{ id: child.id, entries: [child.activeSessionHistoryEntry] }]);
    expect(update).toHaveBeenCalledExactlyOnceWith();
  });

  it('does not attach a child or notify automation when context creation fails', () => {
    const { container, createContext, queued, created } = prepareChildCreation();
    const failure = new InternalError('child context creation failed');
    createContext.mockImplementation(() => { throw failure; });

    expect(() => container.nodeDocument.env.userAgent.createChildNavigable(container)).toThrow(failure);
    expect(container.contentNavigable).toBeNull();
    expect(queued).toEqual([]);
    expect(created).not.toHaveBeenCalled();
  });

  it('uses the top-level group and traversable queue for a grandchild', () => {
    const { parent, container, document, createContext, queued, created } = prepareChildCreation();
    const update = vi.spyOn(parent, 'updateForNavigableCreationOrDestruction')
      .mockReturnValue(document.env.userAgent.HostPromise.resolve('applied', internalType<HistoryStepResult>()));
    container.nodeDocument.env.userAgent.createChildNavigable(container);
    queued.shift()!();
    createContext.mockRestore();
    created.mockImplementation(() => {});
    const group = parent.activeBrowsingContext!.group!;
    const [context, grandchildDocument] = BrowsingContext.create(null, null, group);
    const nestedFactory = vi.spyOn(BrowsingContext, 'create').mockReturnValue([context, grandchildDocument]);
    const nested = document.createElement('iframe') as HTMLIFrameElementImpl;
    document.body!.appendChild(nested);

    nested.nodeDocument.env.userAgent.createChildNavigable(nested);

    const child = container.contentNavigable!;
    const grandchild = nested.contentNavigable!;
    expect(nestedFactory).toHaveBeenCalledExactlyOnceWith(document, nested, group);
    expect(grandchild.parent).toBe(child);
    expect(grandchild.traversable).toBe(parent);
    expect(queued).toHaveLength(1);
    expect(created).toHaveBeenLastCalledWith(grandchild);
    queued.shift()!();
    expect(child.activeSessionHistoryEntry.documentState.nestedHistories)
      .toEqual([{ id: grandchild.id, entries: [grandchild.activeSessionHistoryEntry] }]);
    expect(grandchild.activeSessionHistoryEntry.step).toBe(0);
    expect(update).toHaveBeenCalledTimes(2);
  });
});

type Container = HTMLIFrameElementImpl | HTMLObjectElementImpl | HTMLFrameElementImpl;
type PlatformContainer = HTMLIFrameElement | HTMLObjectElement | HTMLFrameElement;

function createChild(tag: 'iframe' | 'object' | 'frame') {
  const browser = new Browlet({ route: () => '' });
  const owner = unwrap<DocumentImpl>(browser.document);
  const container = owner.createElement(tag) as Container;
  const [, document] = BrowsingContext.createTopLevel(owner.env.userAgent);
  document.origin = owner.origin;
  const navigable = new Navigable(DocumentState.create(document), owner.getNodeNavigable());
  // Child creation is unfinished; exercise the accessors through real retained implementations and bindings.
  container.contentNavigable = navigable;
  owner.body!.appendChild(container);
  return { owner, container, platform: project(container) as PlatformContainer, document, navigable };
}

function tupleOrigin(host: string): TupleOrigin {
  return { kind: 'tuple', scheme: 'https', host: { kind: 'domain', value: host }, port: null, domain: null };
}

function prepareChildCreation() {
  const userAgent = new UserAgent();
  const parent = TopLevelTraversable.create(userAgent, null, '');
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
  owner.body!.appendChild(container);
  // Supply a controllable initial Document and the unfinished queue drain for the ordering tests.
  const [context, document] = BrowsingContext.create(null, null, parent.activeBrowsingContext!.group!);
  document.origin = owner.origin;
  const createContext = vi.spyOn(BrowsingContext, 'create').mockReturnValue([context, document]);
  const queued: (() => void)[] = [];
  vi.spyOn(parent, 'appendSessionHistoryTraversalSteps').mockImplementation((steps) => { queued.push(steps); });
  const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated').mockImplementation((child) => {
    expect(container.contentNavigable).toBe(child);
    expect(queued).toHaveLength(1);
  });
  return { parent, container, context, document, createContext, queued, created };
}
