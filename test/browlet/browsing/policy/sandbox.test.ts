import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { BrowsingContext } from '../../../../src/browlet/browsing/navigation/browsing-context';
import { createDocumentState } from '../../../../src/browlet/browsing/navigation/document-state';
import { Navigable } from '../../../../src/browlet/browsing/navigation/navigable';
import { SandboxingFlagSet } from '../../../../src/browlet/browsing/policy/sandbox';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import type { HTMLIFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/iframe';
import type { HTMLObjectElementImpl } from '../../../../src/browlet/dom/nodes/html/embedded/object';
import type { HTMLFrameElementImpl } from '../../../../src/browlet/dom/nodes/html/legacy/frame';
import { FetchResponse } from '../../../../src/fetch/response';
import { parseURL } from '../../../../src/url/url';
import { unwrap } from '../../../support/browlet-binding';

describe('HTML sandbox directives', () => {
  it('starts with every restriction for an empty or unrecognized token list', () => {
    const empty = SandboxingFlagSet.parse('');
    expect(empty.size).toBe(16);
    expect(SandboxingFlagSet.parse('unknown')).toEqual(empty);
    expect(empty.has('sandboxed-origin')).toBe(true);
    expect(empty.has('sandboxed-scripts')).toBe(true);
  });

  it('recognizes ASCII whitespace and case-insensitive keywords without relaxing other flags', () => {
    const flags = SandboxingFlagSet.parse('\tALLOW-SCRIPTS\nallow-same-origin\fALLOW-SCRIPTS\r');
    expect(flags.has('sandboxed-origin')).toBe(false);
    expect(flags.has('sandboxed-scripts')).toBe(false);
    expect(flags.has('sandboxed-automatic-features')).toBe(false);
    expect(flags.has('sandboxed-forms')).toBe(true);
    expect(SandboxingFlagSet.parse('allow-scripts\u00A0allow-same-origin')).toEqual(SandboxingFlagSet.parse(''));
  });

  it.each([
    ['allow-popups', 'sandboxed-auxiliary-navigation'],
    ['allow-forms', 'sandboxed-forms'],
    ['allow-pointer-lock', 'sandboxed-pointer-lock'],
    ['allow-popups-to-escape-sandbox', 'sandbox-propagates-to-auxiliary-browsing-contexts'],
    ['allow-modals', 'sandboxed-modals'],
    ['allow-orientation-lock', 'sandboxed-orientation-lock'],
    ['allow-presentation', 'sandboxed-presentation'],
    ['allow-downloads', 'sandboxed-downloads'],
  ] as const)('applies %s', (token, flag) => {
    expect(SandboxingFlagSet.parse(token).has(flag)).toBe(false);
  });

  it('distinguishes activation-limited navigation from unrestricted navigation', () => {
    const limited = SandboxingFlagSet.parse('allow-top-navigation-by-user-activation');
    expect(limited.has('sandboxed-top-level-navigation-with-user-activation')).toBe(false);
    expect(limited.has('sandboxed-top-level-navigation-without-user-activation')).toBe(true);
    expect(limited.has('sandboxed-custom-protocols-navigation')).toBe(true);
    const unrestricted = SandboxingFlagSet.parse('allow-top-navigation');
    expect(unrestricted.has('sandboxed-top-level-navigation-with-user-activation')).toBe(false);
    expect(unrestricted.has('sandboxed-top-level-navigation-without-user-activation')).toBe(false);
    expect(unrestricted.has('sandboxed-custom-protocols-navigation')).toBe(false);
  });

  it.each(['allow-top-navigation-to-custom-protocols', 'allow-popups'])(
    'permits custom protocols through %s without enabling all top-level navigation', (token) => {
      const flags = SandboxingFlagSet.parse(token);
      expect(flags.has('sandboxed-custom-protocols-navigation')).toBe(false);
      expect(flags.has('sandboxed-top-level-navigation-without-user-activation')).toBe(true);
    },
  );

  it('retains the unconditional flags even when every exception is supplied', () => {
    const flags = SandboxingFlagSet.parse([
      'allow-popups', 'allow-top-navigation', 'allow-same-origin', 'allow-forms', 'allow-pointer-lock',
      'allow-scripts', 'allow-popups-to-escape-sandbox', 'allow-modals', 'allow-orientation-lock',
      'allow-presentation', 'allow-downloads',
    ].join(' '));
    expect([...flags]).toEqual(['sandboxed-navigation', 'sandboxed-document-domain']);
  });
});

describe('Sandbox state and creation flags', () => {
  it('updates iframe restrictions on attribute creation, replacement, Attr mutation, and removal', () => {
    const browser = new Browlet({ route: () => '' });
    const iframe = browser.document.createElement('iframe');
    const implementation = unwrap<HTMLIFrameElementImpl>(iframe);
    expect(implementation.sandboxingFlagSet.size).toBe(0);
    iframe.setAttribute('sandbox', '');
    expect(implementation.sandboxingFlagSet).toEqual(SandboxingFlagSet.parse(''));
    iframe.setAttribute('sandbox', 'allow-scripts');
    expect(implementation.sandboxingFlagSet.has('sandboxed-scripts')).toBe(false);
    iframe.getAttributeNode('sandbox')!.value = 'allow-same-origin';
    expect(implementation.sandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(implementation.sandboxingFlagSet.has('sandboxed-origin')).toBe(false);
    iframe.removeAttribute('sandbox');
    expect(implementation.sandboxingFlagSet.size).toBe(0);
  });

  it('ignores namespaced sandbox attributes and preserves parsed restrictions when cloning', () => {
    const browser = new Browlet({ route: () => '' });
    const iframe = browser.document.createElement('iframe');
    iframe.setAttributeNS('urn:other', 'x:sandbox', '');
    expect(unwrap<HTMLIFrameElementImpl>(iframe).sandboxingFlagSet.size).toBe(0);
    iframe.setAttribute('sandbox', 'allow-scripts');
    const cloned = unwrap<HTMLIFrameElementImpl>(iframe.cloneNode());
    expect(cloned.sandboxingFlagSet).toEqual(SandboxingFlagSet.parse('allow-scripts'));
    expect(cloned.sandboxingFlagSet).not.toBe(unwrap<HTMLIFrameElementImpl>(iframe).sandboxingFlagSet);
  });

  it('copies popup flags when there is no embedder', () => {
    const context = new BrowsingContext();
    expect(context.onePermittedSandboxedNavigator).toBeNull();
    expect(context.determineCreationSandboxingFlags(null).size).toBe(0);
    context.popupSandboxingFlagSet.add('sandboxed-forms');
    const flags = context.determineCreationSandboxingFlags(null);
    expect([...flags]).toEqual(['sandboxed-forms']);
    flags.clear();
    expect(context.popupSandboxingFlagSet.has('sandboxed-forms')).toBe(true);
  });

  it('unions iframe and current node-document restrictions without the context popup flags', () => {
    const original = new Browlet({ route: () => '' });
    const target = new Browlet({ route: () => '' });
    const originalDocument = unwrap<DocumentImpl>(original.document);
    originalDocument.setActiveSandboxingFlagSet(new SandboxingFlagSet(['sandboxed-downloads']));
    const targetDocument = unwrap<DocumentImpl>(target.document);
    targetDocument.setActiveSandboxingFlagSet(new SandboxingFlagSet(['sandboxed-scripts']));
    const iframe = original.document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-downloads');
    target.document.adoptNode(iframe);
    const implementation = unwrap<HTMLIFrameElementImpl>(iframe);
    const context = new BrowsingContext();
    context.popupSandboxingFlagSet.add('sandboxed-downloads');
    const flags = context.determineCreationSandboxingFlags(implementation);
    expect(flags.has('sandboxed-scripts')).toBe(true);
    expect(flags.has('sandboxed-automatic-features')).toBe(false);
    expect(flags.has('sandboxed-downloads')).toBe(false);
    expect(flags.has('sandboxed-origin')).toBe(true);
    flags.clear();
    expect(targetDocument.activeSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(implementation.sandboxingFlagSet.has('sandboxed-origin')).toBe(true);
  });

  it('keeps a document snapshot independent of later iframe attribute changes', () => {
    const browser = new Browlet({ route: () => '' });
    const iframe = browser.document.createElement('iframe');
    iframe.setAttribute('sandbox', '');
    const context = new BrowsingContext();
    const flags = context.determineCreationSandboxingFlags(unwrap<HTMLIFrameElementImpl>(iframe));
    const document = unwrap<DocumentImpl>(browser.document);
    document.setActiveSandboxingFlagSet(flags);
    iframe.removeAttribute('sandbox');
    flags.clear();
    expect(document.activeSandboxingFlagSet).toEqual(SandboxingFlagSet.parse(''));
  });

  it('captures iframe referrer policy and combines response, iframe, and ancestor sandbox restrictions', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const parent = document.getNodeNavigable()!;
    document.setActiveSandboxingFlagSet(new SandboxingFlagSet(['sandboxed-forms']));
    const [, childDocument] = BrowsingContext.create(null, null, parent.activeBrowsingContext!.group!);
    const child = new Navigable(createDocumentState(childDocument), parent);
    const iframe = browser.document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts allow-forms');
    iframe.setAttribute('referrerpolicy', 'NO-REFERRER');
    unwrap<HTMLIFrameElementImpl>(iframe).contentNavigable = child;
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://child.test/').url!);
    response.headerList.append('Content-Security-Policy', 'sandbox allow-same-origin allow-forms');
    const params = child.createNavigationParams(response);
    expect(params.finalSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-forms')).toBe(true);
    expect(params.finalSandboxingFlagSet.has('sandboxed-scripts')).toBe(true);
    expect(params.iframeReferrerPolicy).toBe('no-referrer');
    iframe.removeAttribute('sandbox');
    iframe.setAttribute('referrerpolicy', 'unsafe-url');
    expect(params.finalSandboxingFlagSet.has('sandboxed-origin')).toBe(true);
    expect(params.iframeReferrerPolicy).toBe('no-referrer');
  });

  it.each(['object', 'frame'] as const)('does not treat the %s container as an absent embedder', (tag) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const [, childDocument] = BrowsingContext.createTopLevel(document.env.userAgent);
    const child = new Navigable(createDocumentState(childDocument), document.getNodeNavigable());
    const container = document.createElement(tag) as HTMLObjectElementImpl | HTMLFrameElementImpl;
    container.contentNavigable = child;
    const response = new FetchResponse();
    response.urlList.push(parseURL('https://child.test/').url!);
    expect(() => child.createNavigationParams(response)).toThrow('Object and frame navigation sandboxing is not implemented');
  });
});
