import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { Duration } from '../../../../src/timing/index';
import { createOpaqueOrigin } from '../../../../src/url/index';
import { unwrap } from '../../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('new navigable target selection', () => {
  it('admits one popup with real transient activation and blocks the next after consumption', () => {
    const { source, window, activation, userAgent } = fixture();
    activation.mockRestore();
    vi.spyOn(window.env, 'currentHighResolutionTime').mockReturnValue(new Duration(1000));
    window.lastActivationTimestamp = 1000;
    const [target, type] = source.chooseNavigable('_blank', false);
    expect(target).not.toBeNull();
    expect(type).toBe('new-and-unrestricted');
    expect(window.hasTransientActivation()).toBe(false);
    expect(window.hasStickyActivation()).toBe(true);
    expect(source.chooseNavigable('_blank', false)).toEqual([null, 'existing-or-none']);
    expect(userAgent.topLevelTraversableSet.size).toBe(2);
  });

  it.each(['new', 'current', 'none'] as const)('blocks an unactivated popup before the %s destination policy', (policy) => {
    const { userAgent, source, window, activation } = fixture();
    userAgent.newNavigablePolicy = policy;
    activation.mockReturnValue(false);
    const create = vi.spyOn(TopLevelTraversable, 'create');

    expect(source.chooseNavigable('_blank', false)).toEqual([null, 'existing-or-none']);
    expect(window.lastActivationTimestamp).toBe(12);
    expect(create).not.toHaveBeenCalled();
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([source]));
  });

  it.each(['new', 'current', 'none'] as const)('rejects sandboxed auxiliary creation before the %s destination policy', (policy) => {
    const { userAgent, source, document, window } = fixture();
    userAgent.newNavigablePolicy = policy;
    document.activeSandboxingFlagSet.add('sandboxed-auxiliary-navigation');

    expect(source.chooseNavigable('_blank', false)).toEqual([null, 'existing-or-none']);
    expect(window.lastActivationTimestamp).toBe(12);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([source]));
  });

  it.each(['current', 'none'] as const)('uses the %s policy without creating or consuming activation', (policy) => {
    const { userAgent, source, window, activation } = fixture();
    userAgent.newNavigablePolicy = policy;
    userAgent.popupBlockerEnabled = false;

    expect(source.chooseNavigable('_blank', false)).toEqual([policy === 'current' ? source : null, 'existing-or-none']);
    expect(activation).not.toHaveBeenCalled();
    expect(window.lastActivationTimestamp).toBe(12);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([source]));
  });

  it('retains sandbox rejection even when the popup blocker is disabled', () => {
    const { userAgent, source, document, activation } = fixture();
    userAgent.popupBlockerEnabled = false;
    document.activeSandboxingFlagSet.add('sandboxed-auxiliary-navigation');

    expect(source.chooseNavigable('_blank', true)).toEqual([null, 'existing-or-none']);
    expect(activation).not.toHaveBeenCalled();
  });

  it('retains the sandboxed creator for a noopener destination', () => {
    const { source, document } = fixture();
    document.activeSandboxingFlagSet.add('sandboxed-navigation');

    const [target] = source.chooseNavigable('_blank', true);

    expect(target!.activeBrowsingContext!.openerBrowsingContext).toBeNull();
    expect(target!.activeBrowsingContext!.onePermittedSandboxedNavigator).toBe(source.activeBrowsingContext);
  });

  it('does not apply new-destination policy or consume activation for an existing named target', () => {
    const { userAgent, source, window, activation } = fixture();
    userAgent.newNavigablePolicy = 'none';
    activation.mockReturnValue(false);

    expect(source.chooseNavigable('source', false)).toEqual([source, 'existing-or-none']);
    expect(window.lastActivationTimestamp).toBe(12);
    expect(activation).toHaveBeenCalledOnce();
  });

  it.each(['_bLaNk', 'named', '_private'] as const)('creates a noopener destination for %j and retains the automation opener', (name) => {
    const { userAgent, source, window } = fixture();
    const auxiliary = vi.spyOn(BrowsingContext, 'createAuxiliary');
    const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated').mockImplementation(() => {
      expect(window.lastActivationTimestamp).toBe(-Infinity);
    });

    const [chosen, type] = source.chooseNavigable(name, true);

    expect(type).toBe('new-and-unrestricted');
    expect(chosen).toBeInstanceOf(TopLevelTraversable);
    const target = chosen as TopLevelTraversable;
    expect(target.targetName).toBe(name === '_bLaNk' ? '' : name);
    expect(target.isCreatedByWebContent).toBe(true);
    expect(target.isScriptClosable).toBe(true);
    expect(target.activeBrowsingContext!.group).not.toBe(source.activeBrowsingContext!.group);
    expect(target.activeBrowsingContext!.openerBrowsingContext).toBeNull();
    expect(target.activeBrowsingContext!.onePermittedSandboxedNavigator).toBeNull();
    expect(target.activeBrowsingContext!.popupSandboxingFlagSet.size).toBe(0);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([source, target]));
    expect(created).toHaveBeenCalledExactlyOnceWith(target, source);
    expect(auxiliary).not.toHaveBeenCalled();
  });

  it('can create without querying activation when the popup blocker is disabled', () => {
    const { userAgent, source, window, activation } = fixture();
    userAgent.popupBlockerEnabled = false;
    activation.mockRestore();

    const [chosen] = source.chooseNavigable('_blank', true);

    expect(chosen).not.toBeNull();
    expect(window.lastActivationTimestamp).toBe(-Infinity);
  });

  it('creates an auxiliary top-level traversable, including storage cloning and registration', () => {
    const { userAgent, source, window } = fixture();
    const auxiliary = vi.spyOn(BrowsingContext, 'createAuxiliary');
    const clone = vi.spyOn(source.storageShed, 'cloneSessionStorageInto');
    const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated');

    const [chosen, type] = source.chooseNavigable('_blank', false);

    const target = chosen as TopLevelTraversable;
    expect(type).toBe('new-and-unrestricted');
    expect(target.targetName).toBe('');
    expect(auxiliary).toHaveBeenCalledExactlyOnceWith(source.activeBrowsingContext);
    expect(target.activeBrowsingContext!.openerBrowsingContext).toBe(source.activeBrowsingContext);
    expect(target.activeBrowsingContext!.onePermittedSandboxedNavigator).toBeNull();
    expect(clone).toHaveBeenCalledExactlyOnceWith(target.storageShed);
    expect(created).toHaveBeenCalledExactlyOnceWith(target, source);
    expect(window.lastActivationTimestamp).toBe(-Infinity);
  });

  it.each([false, true])('copies popup sandbox restrictions with noopener=%s and retains only a permitted opener', (noopener) => {
    const { source, document } = fixture();
    const flags = document.activeSandboxingFlagSet;
    flags.add('sandboxed-navigation');
    flags.add('sandboxed-forms');
    flags.add('sandbox-propagates-to-auxiliary-browsing-contexts');

    const [target] = source.chooseNavigable('_blank', noopener);
    const context = target!.activeBrowsingContext!;

    expect(context.onePermittedSandboxedNavigator).toBe(source.activeBrowsingContext);
    expect(context.popupSandboxingFlagSet).toEqual(flags);
    expect(context.popupSandboxingFlagSet).not.toBe(flags);
    context.popupSandboxingFlagSet.add('sandboxed-downloads');
    expect(flags.has('sandboxed-downloads')).toBe(false);
  });

  it('does not propagate other sandbox flags without the propagation flag', () => {
    const { source, document } = fixture();
    document.activeSandboxingFlagSet.add('sandboxed-forms');

    const [target] = source.chooseNavigable('_blank', true);

    expect(target!.activeBrowsingContext!.popupSandboxingFlagSet.size).toBe(0);
  });

  it.each([
    ['same-origin', true, true], ['same-origin-plus-COEP', true, true],
    ['same-origin', false, false], ['same-origin-plus-COEP', false, false],
    ['unsafe-none', true, false], ['same-origin-allow-popups', true, false], ['noopener-allow-popups', true, false],
  ] as const)('applies COOP %s with cross-origin top=%s, forcing separation=%s', (policy, crossOrigin, forced) => {
    const { source, document } = fixture();
    document.openerPolicy.value = policy;
    document.env.topLevelOrigin = crossOrigin ? createOpaqueOrigin() : document.origin;
    const auxiliary = vi.spyOn(BrowsingContext, 'createAuxiliary');

    const [target, type] = source.chooseNavigable('named', false);

    expect(type).toBe(forced ? 'new-with-no-opener' : 'new-and-unrestricted');
    expect(target!.targetName).toBe(forced ? '' : 'named');
    expect(target!.activeBrowsingContext!.openerBrowsingContext).toBe(forced ? null : source.activeBrowsingContext);
    expect(auxiliary).toHaveBeenCalledTimes(forced ? 0 : 1);
  });

  it('does not force separation for report-only COOP', () => {
    const { source, document } = fixture();
    document.openerPolicy.reportOnlyValue = 'same-origin-plus-COEP';
    document.env.topLevelOrigin = createOpaqueOrigin();
    const auxiliary = vi.spyOn(BrowsingContext, 'createAuxiliary');

    const [, type] = source.chooseNavigable('_blank', false);

    expect(type).toBe('new-and-unrestricted');
    expect(auxiliary).toHaveBeenCalledOnce();
  });

  it('propagates creation failure after activation consumption and before registration', () => {
    const { userAgent, source, window } = fixture();
    const created = vi.spyOn(userAgent, 'webDriverBiDiNavigableCreated');
    const failure = new Error('Creation failed');
    vi.spyOn(BrowsingContext, 'createAuxiliary').mockImplementation(() => { throw failure; });

    expect(() => source.chooseNavigable('_blank', false)).toThrow(failure);
    expect(window.lastActivationTimestamp).toBe(-Infinity);
    expect(userAgent.topLevelTraversableSet).toEqual(new Set([source]));
    expect(created).not.toHaveBeenCalled();
  });

  it('returns null through Window.open when sandboxing rejects a new destination', async () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    document.activeSandboxingFlagSet.add('sandboxed-auxiliary-navigation');
    vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(true);

    expect(await browser.evaluate(() => window.open('', '_blank'))).toBeNull();
  });
});

function fixture() {
  const userAgent = new UserAgent();
  const source = TopLevelTraversable.create(userAgent, null, 'source');
  const document = source.activeDocument!;
  const window = source.activeWindow!;
  window.lastActivationTimestamp = 12;
  // Most policy cases isolate activation; the first regression uses real timestamps and consumption.
  const activation = vi.spyOn(window, 'hasTransientActivation').mockReturnValue(true);
  return { userAgent, source, document, window, activation };
}
