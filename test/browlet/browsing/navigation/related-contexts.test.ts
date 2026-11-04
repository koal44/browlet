import { describe, expect, it } from 'vitest';

import { UserAgent } from '../../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, Traversable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { DocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { InternalError } from '../../../../src/infra/index';
import { createOpaqueOrigin, obtainURLOrigin, parseURL } from '../../../../src/url/index';

describe('related browsing contexts', () => {
  it('has no top-level or ancestor relationship before initial activation', () => {
    const context = new BrowsingContext();
    const root = createRoot();

    expect(context.isTopLevel).toBe(false);
    expect(context.topLevelBrowsingContext).toBeNull();
    expect(context.isAncestorOf(root.context)).toBe(false);
    expect(root.context.isAncestorOf(context)).toBe(false);
  });

  it('finds strict ancestors and the outermost active context', () => {
    const root = createRoot();
    const parent = createChild(root.navigable);
    const child = createChild(parent.navigable);
    const sibling = createChild(root.navigable);

    expect(root.context.isTopLevel).toBe(true);
    expect(root.context.topLevelBrowsingContext).toBe(root.context);
    expect(parent.context.isTopLevel).toBe(false);
    expect(child.context.topLevelBrowsingContext).toBe(root.context);
    expect(root.context.isAncestorOf(child.context)).toBe(true);
    expect(parent.context.isAncestorOf(child.context)).toBe(true);
    expect(child.context.isAncestorOf(root.context)).toBe(false);
    expect(parent.context.isAncestorOf(parent.context)).toBe(false);
    expect(sibling.context.isAncestorOf(child.context)).toBe(false);
  });

  it('does not use a retained ancestor tree after its containing Document becomes inactive', () => {
    const root = createRoot();
    const child = createChild(root.navigable);
    replaceDocument(root.navigable);

    expect(child.context.navigable).toBe(child.navigable);
    expect(child.document.getAncestorNavigables()).toEqual([root.navigable]);
    expect(child.document.isFullyActive()).toBe(false);
    expect(child.context.topLevelBrowsingContext).toBeNull();
    expect(root.context.isAncestorOf(child.context)).toBe(false);
  });

  it('follows the ancestor navigable\'s current browsing context after replacement', () => {
    const root = createRoot();
    const child = createChild(root.navigable);
    const [replacement, document] = BrowsingContext.create(null, null, root.context.group!);
    document.adoptNode(child.container);
    document.body!.appendChild(child.container);
    root.navigable.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));

    expect(root.context.navigable).toBe(root.navigable);
    expect(root.context.isTopLevel).toBe(false);
    expect(root.context.topLevelBrowsingContext).toBeNull();
    expect(root.context.isAncestorOf(child.context)).toBe(false);
    expect(replacement.isTopLevel).toBe(true);
    expect(replacement.isAncestorOf(child.context)).toBe(true);
    expect(child.context.topLevelBrowsingContext).toBe(replacement);
  });

  it('classifies a traversable separately from a top-level traversable', () => {
    const root = createRoot();
    const child = createChild(root.navigable, undefined, true);

    // HTML currently permits only top-level traversables; the context definition is deliberately broader.
    expect(child.navigable.isTopLevelTraversable).toBe(false);
    expect(child.context.isTopLevel).toBe(true);
    expect(child.context.topLevelBrowsingContext).toBe(root.context);
  });
});

describe('browsing-context familiarity', () => {
  it('compares strict origins independently of group identity and document.domain relaxation', () => {
    const source = createRoot();
    const same = createRoot();
    const foreign = createRoot('https://b.example.test/');

    expect(source.context.group).not.toBe(same.context.group);
    expect(source.context.isFamiliarWith(same.context)).toBe(true);
    expect(source.context.isFamiliarWith(foreign.context)).toBe(false);
    const first = source.document.origin;
    const second = foreign.document.origin;
    if (first.kind !== 'tuple' || second.kind !== 'tuple') throw new Error('Expected tuple origins');
    first.domain = second.domain = { kind: 'domain', value: 'example.test' };
    // SPEC_CLASH(familiarity-document-domain): Matching relaxed domains do not establish familiarity.
    expect(source.context.isFamiliarWith(foreign.context)).toBe(false);
  });

  it('compares opaque origins by identity', () => {
    const source = createRoot();
    const target = createRoot();
    source.document.origin = createOpaqueOrigin();
    target.document.origin = createOpaqueOrigin();
    expect(source.context.isFamiliarWith(target.context)).toBe(false);
    target.document.origin = source.document.origin;
    expect(source.context.isFamiliarWith(target.context)).toBe(true);
  });

  it('recognizes the source\'s top-level context despite different origins', () => {
    const root = createRoot();
    const child = createChild(root.navigable, 'https://b.example.test/');

    expect(child.context.isFamiliarWith(root.context)).toBe(true);
    expect(root.context.isFamiliarWith(child.context)).toBe(true);
  });

  it('recognizes an otherwise foreign target through its same-origin ancestor', () => {
    const source = createRoot();
    const other = createRoot('https://b.example.test/');
    const parent = createChild(other.navigable, 'https://a.example.test/');
    const target = createChild(parent.navigable, 'https://c.example.test/');

    expect(source.context.isFamiliarWith(target.context)).toBe(true);
    replaceDocument(other.navigable);
    expect(source.context.isFamiliarWith(target.context)).toBe(false);
  });

  it('retains the direct-origin match when a Document is no longer fully active', () => {
    const source = createRoot();
    const root = createRoot('https://b.example.test/');
    const target = createChild(root.navigable, 'https://a.example.test/');
    replaceDocument(root.navigable);

    expect(target.document.isFullyActive()).toBe(false);
    expect(source.context.isFamiliarWith(target.context)).toBe(true);
    expect(target.context.isFamiliarWith(source.context)).toBe(true);
  });

  it('walks several auxiliary openers without treating familiarity as symmetric', () => {
    const source = createRoot();
    const first = createAuxiliary(source.context, 'https://b.example.test/');
    const second = createAuxiliary(first.context, 'https://c.example.test/');
    const target = createAuxiliary(second.context, 'https://d.example.test/');

    // SPEC_CLASH(familiarity-opener-depth): HTML follows the full chain; browsers' named lookup does not.
    expect(source.context.isFamiliarWith(target.context)).toBe(true);
    expect(source.context.isFamiliarForNamedLookup(first.context)).toBe(true);
    expect(source.context.isFamiliarForNamedLookup(second.context)).toBe(false);
    expect(source.context.isFamiliarForNamedLookup(target.context)).toBe(false);
    expect(target.context.isFamiliarWith(source.context)).toBe(false);
  });

  it('keeps the same-origin match for a distant opener relationship', () => {
    const source = createRoot();
    const first = createAuxiliary(source.context);
    const second = createAuxiliary(first.context);
    const target = createAuxiliary(second.context);

    // SPEC_CLASH(familiarity-distant-target): HTML/Chromium/Firefox reuse this target; WebKit opens another window.
    expect(source.context.isFamiliarWith(target.context)).toBe(true);
    expect(source.context.isFamiliarForNamedLookup(target.context)).toBe(true);
  });

  it('does not follow an opener on a non-auxiliary context', () => {
    const source = createRoot();
    const target = createRoot('https://b.example.test/');
    target.context.openerBrowsingContext = source.context;
    expect(target.context.isAuxiliary).toBe(false);
    expect(source.context.isFamiliarWith(target.context)).toBe(false);
  });

  it('stops at a disowned opener while retaining auxiliary identity and direct-origin matches', () => {
    const source = createRoot();
    const target = createAuxiliary(source.context, 'https://b.example.test/');
    target.context.activeWindow.disownOpener();

    expect(target.context.isAuxiliary).toBe(true);
    expect(source.context.isFamiliarWith(target.context)).toBe(false);
    expect(source.context.isFamiliarForNamedLookup(target.context)).toBe(false);
    target.document.origin = source.document.origin;
    expect(source.context.isFamiliarWith(target.context)).toBe(true);
    expect(source.context.isFamiliarForNamedLookup(target.context)).toBe(true);
  });

  it('terminates a self-opener and a multi-context cycle, preserving matches within that cycle', () => {
    const source = createRoot();
    const first = createAuxiliary(source.context, 'https://b.example.test/');
    first.context.openerBrowsingContext = first.context;
    expect(source.context.isFamiliarWith(first.context)).toBe(false);
    const second = createAuxiliary(first.context, 'https://c.example.test/');
    first.context.openerBrowsingContext = second.context;
    expect(source.context.isFamiliarWith(first.context)).toBe(false);
    expect(source.context.isFamiliarForNamedLookup(first.context)).toBe(false);
    second.document.origin = source.document.origin;
    expect(source.context.isFamiliarWith(first.context)).toBe(true);
    expect(source.context.isFamiliarForNamedLookup(first.context)).toBe(true);
  });

  it('requires active Documents on both contexts', () => {
    const root = createRoot();
    const fresh = new BrowsingContext();
    expect(() => fresh.isFamiliarWith(root.context)).toThrow(InternalError);
    expect(() => root.context.isFamiliarWith(fresh)).toThrow(InternalError);
  });
});

function createRoot(url = 'https://a.example.test/') {
  const navigable = TopLevelTraversable.create(new UserAgent(), null, '');
  const document = navigable.activeDocument!;
  // Supply the post-navigation origin without invoking unfinished document-initiated navigation.
  document.origin = obtainURLOrigin(parseURL(url).url!);
  document.env.topLevelOrigin = document.origin;
  return { navigable, document, context: navigable.activeBrowsingContext! };
}

function createChild(parent: Navigable, url?: string, traversable = false) {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe') as HTMLIFrameElementImpl;
  owner.body!.appendChild(container);
  const [context, document] = BrowsingContext.create(owner, container, parent.topLevelTraversable.activeBrowsingContext!.group!);
  if (url !== undefined) document.origin = obtainURLOrigin(parseURL(url).url!);
  const state = DocumentState.create(document);
  const navigable = traversable ? new Traversable(state, parent) : new Navigable(state, parent);
  container.contentNavigable = navigable;
  return { context, document, navigable, container };
}

function createAuxiliary(opener: BrowsingContext, url?: string) {
  const navigable = TopLevelTraversable.create(opener.topLevelTraversable.activeDocument!.env.userAgent, opener, '');
  const document = navigable.activeDocument!;
  if (url !== undefined) document.origin = obtainURLOrigin(parseURL(url).url!);
  return { navigable, document, context: navigable.activeBrowsingContext! };
}

function replaceDocument(navigable: Navigable) {
  const document = navigable.activeDocument!.env.createDocument();
  document.browsingContext = navigable.activeBrowsingContext;
  navigable.activeSessionHistoryEntry = document.env.createSessionHistoryEntry(document.url, DocumentState.create(document));
  document.makeActive();
}
