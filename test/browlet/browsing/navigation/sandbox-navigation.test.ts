import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/top-level-traversable';
import { DocumentState, SourceSnapshotParams } from '../../../../src/browlet/browsing/navigation/state/index';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import { createOpaqueOrigin, parseURL } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('sandbox navigation permission', () => {
  it('allows self and descendants even with every sandbox restriction', () => {
    const { top, parent, source } = fixture();
    const params = snapshot('', false);

    expect(source.isAllowedBySandboxingToNavigate(source, params)).toBe(true);
    expect(top.isAllowedBySandboxingToNavigate(top, params)).toBe(true);
    expect(top.isAllowedBySandboxingToNavigate(parent, params)).toBe(true);
    expect(top.isAllowedBySandboxingToNavigate(source, params)).toBe(true);
    expect(parent.isAllowedBySandboxingToNavigate(source, params)).toBe(true);
  });

  it.each(['', 'allow-top-navigation', 'allow-top-navigation-by-user-activation'])(
    'blocks an intermediate ancestor despite %j and activation', (directive) => {
      const { parent, source } = fixture();
      // SPEC_CLASH(sandbox-intermediate-ancestor): All browsers and HTML's target table block this.
      expect(source.isAllowedBySandboxingToNavigate(parent, snapshot(directive, true))).toBe(false);
    },
  );

  it.each([
    ['', false, false], ['', true, false],
    ['allow-top-navigation', false, true], ['allow-top-navigation', true, true],
    ['allow-top-navigation-by-user-activation', false, false],
    ['allow-top-navigation-by-user-activation', true, true],
    ['allow-popups', true, false], ['allow-top-navigation-to-custom-protocols', true, false],
  ] as const)('checks top navigation for %j with activation=%s: %s', (directive, activation, allowed) => {
    const { top, source } = fixture();
    expect(source.isAllowedBySandboxingToNavigate(top, snapshot(directive, activation))).toBe(allowed);
  });

  it('uses only the top-navigation flag selected by captured activation', () => {
    const { top, source } = fixture();
    const params = new SourceSnapshotParams(null);
    params.sandboxingFlags.add('sandboxed-top-level-navigation-with-user-activation');
    params.hasTransientActivation = false;
    expect(source.isAllowedBySandboxingToNavigate(top, params)).toBe(true);
    params.hasTransientActivation = true;
    expect(source.isAllowedBySandboxingToNavigate(top, params)).toBe(false);
  });

  it('permits unrestricted navigation to ancestors, siblings, and other top levels', () => {
    const { top, parent, source } = fixture();
    const sibling = child(parent, 'sibling');
    const other = TopLevelTraversable.create(top.activeDocument!.env.userAgent, null, 'other');
    const params = new SourceSnapshotParams(null);

    for (const target of [top, parent, sibling, other]) {
      expect(source.isAllowedBySandboxingToNavigate(target, params)).toBe(true);
    }
  });

  it('blocks same-origin siblings and their descendants without consulting origin', () => {
    const { parent, source } = fixture();
    const sibling = child(parent, 'sibling');
    const nested = child(sibling, 'nested');
    expect(sibling.activeDocument!.origin).toBe(source.activeDocument!.origin);

    expect(source.isAllowedBySandboxingToNavigate(sibling, snapshot('', false))).toBe(false);
    expect(source.isAllowedBySandboxingToNavigate(nested, snapshot('', true))).toBe(false);
    sibling.activeDocument!.origin = createOpaqueOrigin();
    expect(source.isAllowedBySandboxingToNavigate(sibling, new SourceSnapshotParams(null))).toBe(true);
  });

  it.each([false, true])('permits a sandbox-created popup with noopener=%s', (noopener) => {
    const { source, document } = fixture();
    document.activeSandboxingFlagSet = SandboxingFlagSet.parse('allow-popups allow-popups-to-escape-sandbox');
    vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(true);
    const params = new SourceSnapshotParams(document);
    const [popup] = source.chooseNavigable('_blank', noopener);

    expect(source.isAllowedBySandboxingToNavigate(popup!, params)).toBe(true);
    expect(popup!.activeBrowsingContext!.openerBrowsingContext).toBe(noopener ? null : source.activeBrowsingContext);
  });

  it('retains creator permission after disowning an opener, without granting it to a different creator', () => {
    const { source, document, parent } = fixture();
    document.activeSandboxingFlagSet = SandboxingFlagSet.parse('allow-popups');
    vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(true);
    const [popup] = source.chooseNavigable('_blank', false);
    popup!.activeWindow!.disownOpener();
    const params = new SourceSnapshotParams(document);

    // SPEC_CLASH(sandbox-disowned-creator): HTML/Firefox keep this permission independently of opener.
    expect(source.isAllowedBySandboxingToNavigate(popup!, params)).toBe(true);
    expect(parent.isAllowedBySandboxingToNavigate(popup!, params)).toBe(false);
  });

  it.each(['allow-popups', 'allow-popups allow-popups-to-escape-sandbox', 'allow-top-navigation'])(
    'does not grant unrelated popup permission with %j', (directive) => {
      const { top, source } = fixture();
      const popup = TopLevelTraversable.create(top.activeDocument!.env.userAgent, top.activeBrowsingContext, 'unrelated');
      // SPEC_CLASH(sandbox-unrelated-popup-escape): Escaping inherited flags grants no new navigation targets.
      expect(source.isAllowedBySandboxingToNavigate(popup, snapshot(directive, true))).toBe(false);
    },
  );

  it('uses the supplied snapshot after live activation and sandbox flags change', () => {
    const { top, source, document } = fixture();
    document.activeSandboxingFlagSet = SandboxingFlagSet.parse('allow-top-navigation-by-user-activation');
    const activation = vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(true);
    const params = new SourceSnapshotParams(document);
    document.activeSandboxingFlagSet = SandboxingFlagSet.parse('');
    activation.mockReturnValue(false);

    expect(source.isAllowedBySandboxingToNavigate(top, params)).toBe(true);
    expect(activation).toHaveBeenCalledOnce();
    expect(source.isAllowedBySandboxingToNavigate(top, new SourceSnapshotParams(document))).toBe(false);
  });

  it('filters a blocked sibling during real named lookup', () => {
    const { parent, source, document } = fixture();
    const sibling = child(parent, 'needle');
    document.activeSandboxingFlagSet = SandboxingFlagSet.parse('allow-same-origin');
    vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(false);

    expect(source.findNavigableByTargetName('needle')).toBeNull();
    document.activeSandboxingFlagSet = new SandboxingFlagSet();
    expect(source.findNavigableByTargetName('needle')).toBe(sibling);
  });

  it.each([false, true])('stops navigate at real sandbox admission with exceptions=%s', (exceptionsEnabled) => {
    const { top, source, document } = fixture();
    document.activeSandboxingFlagSet = SandboxingFlagSet.parse('');
    vi.spyOn(source.activeWindow!, 'hasTransientActivation').mockReturnValue(false);
    const queue = vi.spyOn(top.activeDocument!.env, 'queueTask');
    const targetURL = top.activeDocument!.url;
    const navigate = () => top.navigate(parseURL('https://example.test/blocked').url!, document, { exceptionsEnabled }, document.env);

    if (exceptionsEnabled) expect(navigate).toThrow(expect.objectContaining({ name: 'SecurityError' }));
    else expect(navigate).not.toThrow();
    expect(queue).not.toHaveBeenCalled();
    expect(top.activeDocument!.url).toBe(targetURL);
    expect(top.ongoingNavigation).toBeNull();
  });
});

function fixture() {
  const browser = new Browlet({ route: () => '' });
  const topDocument = unwrap<DocumentImpl>(browser.document);
  const top = topDocument.getNodeNavigable()!.topLevelTraversable;
  const parent = child(top, 'parent');
  const source = child(parent, 'source');
  return { top, parent, source, document: source.activeDocument! };
}

function child(parent: Navigable, name: string) {
  const document = parent.activeDocument!;
  const container = document.createElement('iframe') as HTMLIFrameElementImpl;
  const [, childDocument] = BrowsingContext.create(document, container, parent.topLevelTraversable.activeBrowsingContext!.group!);
  const state = DocumentState.create(childDocument);
  state.navigableTargetName = name;
  const navigable = new Navigable(state, parent);
  container.contentNavigable = navigable;
  document.body!.appendChild(container);
  return navigable;
}

function snapshot(directive: string, activation: boolean) {
  const params = new SourceSnapshotParams(null);
  params.sandboxingFlags = SandboxingFlagSet.parse(directive);
  params.hasTransientActivation = activation;
  return params;
}
