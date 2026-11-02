import { afterEach, assert, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable, TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/state/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('navigable target name syntax', () => {
  it.each([
    ['', false], ['_private', false], ['target', true], ['MiXeD', true], ['é', true],
    ['two words', true], ['<', true], ['\t\n\r', true], ['<\t', false],
    ['\n<', false], ['a<\rb', false], ['<\f\v', true],
  ] as const)('checks the authoring validity of %j', (name, valid) => {
    expect(Navigable.isValidTargetName(name)).toBe(valid);
    expect(Navigable.isValidTargetNameOrKeyword(name)).toBe(valid);
  });

  it.each(['_blank', '_SELF', '_pArEnT', '_Top'])('also accepts the keyword %s', (name) => {
    expect(Navigable.isValidTargetName(name)).toBe(false);
    expect(Navigable.isValidTargetNameOrKeyword(name)).toBe(true);
  });

  it.each(['_self ', '_current', '_unfencedTop'])('rejects nonstandard keyword %j', (name) => {
    expect(Navigable.isValidTargetNameOrKeyword(name)).toBe(false);
  });
});

describe('existing navigable target selection', () => {
  it('resolves empty and case-insensitive special targets without named lookup or its prerequisites', () => {
    const { navigable: root } = createRoot();
    const { navigable: parent } = createChild(root, 'parent');
    const { navigable: child } = createChild(parent, 'child');
    const lookup = vi.spyOn(child, 'findNavigableByTargetName');

    for (const name of ['', '_sElF']) {
      expect(child.chooseNavigable(name, false)).toEqual([child, 'existing-or-none']);
    }
    expect(child.chooseNavigable('_pArEnT', true)).toEqual([parent, 'existing-or-none']);
    expect(child.chooseNavigable('_TOP', true)).toEqual([root, 'existing-or-none']);
    expect(root.chooseNavigable('_parent', false)).toEqual([root, 'existing-or-none']);
    expect(root.chooseNavigable('_top', false)).toEqual([root, 'existing-or-none']);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('searches self and then its descendants before the rest of the tab', () => {
    const { navigable: root } = createRoot();
    createChild(root, 'needle');
    const { navigable: source } = createChild(root, 'needle');
    const { navigable: nested } = createChild(source, 'needle');
    supplyLookupDependencies(source);

    expect(source.findNavigableByTargetName('needle')).toBe(source);
    source.activeSessionHistoryEntry.documentState.navigableTargetName = 'source';
    expect(source.chooseNavigable('needle', false)).toEqual([nested, 'existing-or-none']);
    expect(source.chooseNavigable('needle', true)).toEqual([nested, 'existing-or-none']);
  });

  it('searches the whole tab before preferring a nearer ancestor subtree', () => {
    const { navigable: root } = createRoot();
    const { navigable: outer } = createChild(root, 'needle');
    const { navigable: parent } = createChild(root, 'parent');
    createChild(parent, 'needle');
    const { navigable: source } = createChild(parent, 'source');
    supplyLookupDependencies(source);

    expect(source.findNavigableByTargetName('needle')).toBe(outer);
  });

  it('uses exact names even when they are not valid authoring target names', () => {
    const { navigable: root } = createRoot();
    const { navigable: upper } = createChild(root, 'Target');
    const { navigable: lower } = createChild(root, 'target');
    const { navigable: unusual } = createChild(root, '_private');
    supplyLookupDependencies(root);

    expect(root.chooseNavigable('Target', false)[0]).toBe(upper);
    expect(root.chooseNavigable('target', false)[0]).toBe(lower);
    expect(root.chooseNavigable('_private', false)[0]).toBe(unusual);
    unusual.activeSessionHistoryEntry.documentState.navigableTargetName = '<\t';
    expect(root.chooseNavigable('<\t', false)[0]).toBe(unusual);
    expect(root.findNavigableByTargetName('TARGET')).toBeNull();
  });

  it('reads live names and shadow-including tree order', () => {
    const { document, navigable: root } = createRoot();
    const first = createChild(root, 'needle');
    const host = document.createElement('div');
    document.body!.appendChild(host);
    const shadow = host.attachShadow({
      mode: 'closed', delegatesFocus: false, slotAssignment: 'named', clonable: false, serializable: false,
    });
    const second = createChild(root, 'needle');
    shadow.appendChild(second.container);
    supplyLookupDependencies(root);

    expect(root.findNavigableByTargetName('needle')).toBe(first.navigable);
    document.body!.insertBefore(host, first.container);
    expect(root.findNavigableByTargetName('needle')).toBe(second.navigable);
    second.navigable.activeSessionHistoryEntry.documentState.navigableTargetName = 'renamed';
    expect(root.findNavigableByTargetName('needle')).toBe(first.navigable);
    document.body!.removeChild(first.container);
    expect(root.findNavigableByTargetName('needle')).toBeNull();
  });

  it('filters blocked candidates using a single source snapshot before comparing names', () => {
    const { document, navigable: root } = createRoot();
    const { navigable: blocked } = createChild(root, 'needle');
    const { navigable: allowed } = createChild(root, 'needle');
    const { activation, permission } = supplyLookupDependencies(root);
    activation.mockReturnValue(true);
    document.activeSandboxingFlagSet.add('sandboxed-navigation');
    permission.mockImplementation((target) => target !== blocked);

    expect(root.findNavigableByTargetName('needle')).toBe(allowed);
    expect(activation).toHaveBeenCalledOnce();
    expect(permission.mock.calls.map(([target]) => target)).toEqual([root, blocked, allowed]);
    const snapshot = permission.mock.calls[0]![1];
    expect(permission.mock.calls.every(([, params]) => params === snapshot)).toBe(true);
    expect(snapshot.hasTransientActivation).toBe(true);
    expect(snapshot.sandboxingFlags).toBe(document.activeSandboxingFlagSet);
    expect(snapshot.fetchClient).toBe(document.env);
  });

  it('searches other top-level contexts in registration order, skipping unfamiliar or sandbox-blocked targets', () => {
    const { navigable: source } = createRoot();
    const unfamiliar = createOtherTopLevel(source, 'needle');
    const blocked = createOtherTopLevel(source, 'needle');
    const older = createOtherTopLevel(source, 'needle');
    const newer = createOtherTopLevel(source, 'needle');
    const { familiarity, permission } = supplyLookupDependencies(source);
    familiarity.mockImplementation((context) => context !== unfamiliar.activeBrowsingContext);
    permission.mockImplementation((target) => target !== blocked);

    expect(source.findNavigableByTargetName('needle')).toBe(older);
    expect(familiarity.mock.calls.map(([context]) => context)).toEqual([
      unfamiliar.activeBrowsingContext, blocked.activeBrowsingContext, older.activeBrowsingContext,
    ]);
    expect(permission.mock.calls.some(([target]) => target === unfamiliar)).toBe(false);
    expect(permission.mock.calls.some(([target]) => target === blocked)).toBe(true);
    const group = source.activeBrowsingContext!.group!;
    group.remove(older.activeBrowsingContext!);
    group.append(older.activeBrowsingContext!);
    expect(source.findNavigableByTargetName('needle')).toBe(newer);
  });

  it('checks familiarity per candidate and includes descendants of another top-level context', () => {
    const { navigable: source } = createRoot();
    const other = createOtherTopLevel(source, 'needle');
    const { navigable: nested } = createChild(other, 'needle');
    const { familiarity } = supplyLookupDependencies(source);
    familiarity.mockImplementation((context) => context === nested.activeBrowsingContext);

    expect(source.findNavigableByTargetName('needle')).toBe(nested);
    expect(familiarity.mock.calls.map(([context]) => context)).toEqual([
      other.activeBrowsingContext, nested.activeBrowsingContext,
    ]);
  });

  it('does not search another browsing-context group and applies popup blocking after a miss', () => {
    const { document, navigable: source } = createRoot();
    TopLevelTraversable.create(document.env.userAgent, null, 'needle');
    const { familiarity } = supplyLookupDependencies(source);

    expect(source.findNavigableByTargetName('needle')).toBeNull();
    expect(familiarity).not.toHaveBeenCalled();
    expect(source.chooseNavigable('needle', false)).toEqual([null, 'existing-or-none']);
  });

  it('keeps blank-target creation separate even if a context has that name', () => {
    const { navigable: source } = createRoot();
    createChild(source, '_blank');
    const lookup = vi.spyOn(source, 'findNavigableByTargetName');

    expect(() => source.chooseNavigable('_bLaNk', false)).toThrow('Window transient activation is not implemented');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('keeps activation, sandbox permission, and familiarity as explicit unfinished owners', () => {
    const { navigable: source } = createRoot();
    const other = createOtherTopLevel(source, 'needle');

    expect(() => source.findNavigableByTargetName('needle')).toThrow('Window transient activation is not implemented');
    vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
    expect(() => source.findNavigableByTargetName('needle')).toThrow('Sandbox navigation permission is not implemented');
    vi.spyOn(source, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
    expect(() => source.findNavigableByTargetName('needle')).toThrow('Browsing-context familiarity is not implemented');
    vi.spyOn(source.activeBrowsingContext!, 'isFamiliarWith').mockReturnValue(true);
    expect(source.findNavigableByTargetName('needle')).toBe(other);
  });

  it('connects projected Window.open to existing lookup without navigating for an empty URL', async () => {
    const { browser, navigable: source } = createRoot();
    const { navigable: target } = createChild(source, 'needle');
    supplyLookupDependencies(source);
    const navigate = vi.spyOn(target, 'navigate');

    expect(await browser.evaluate(() => window.open('', 'needle') === window[0])).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(target.activeBrowsingContext!.openerBrowsingContext).toBe(source.activeBrowsingContext);
  });
});

function createRoot() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  return { browser, document, navigable: document.getNodeNavigable()! };
}

function createChild(parent: Navigable, name: string) {
  const owner = parent.activeDocument!;
  const container = owner.createElement('iframe');
  assert(container.isNavigableContainer());
  const group = parent.topLevelTraversable.activeBrowsingContext!.group!;
  const [, document] = BrowsingContext.create(null, null, group);
  const state = createDocumentState(document);
  state.navigableTargetName = name;
  const navigable = new Navigable(state, parent);
  // Supply the child association while creator/embedder inheritance and startup remain unfinished.
  container.contentNavigable = navigable;
  owner.body!.appendChild(container);
  return { container, navigable };
}

function createOtherTopLevel(source: Navigable, name: string) {
  const group = source.topLevelTraversable.activeBrowsingContext!.group!;
  const [context, document] = BrowsingContext.create(null, null, group);
  // Supply group membership without pretending auxiliary-context creation is implemented.
  group.append(context);
  const state = createDocumentState(document);
  state.navigableTargetName = name;
  const navigable = new TopLevelTraversable(state);
  navigable.activeSessionHistoryEntry.step = 0;
  navigable.sessionHistoryEntries.push(navigable.activeSessionHistoryEntry);
  group.userAgent.appendTopLevelTraversable(navigable);
  return navigable;
}

function supplyLookupDependencies(source: Navigable) {
  const activation = vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
  const permission = vi.spyOn(source, 'isAllowedBySandboxingToNavigate').mockReturnValue(true);
  const familiarity = vi.spyOn(source.activeBrowsingContext!, 'isFamiliarWith').mockReturnValue(true);
  return { activation, permission, familiarity };
}
