import { afterEach, describe, expect, it, vi } from 'vitest';

import { HTML_NAMESPACE, SVG_NAMESPACE } from '../../../../src/infra/namespaces';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { Duration } from '../../../../src/browlet/timing/clock';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { createTestDocument } from '../../../support/dom';

afterEach(() => vi.restoreAllMocks());

describe('Document render blocking', () => {
  it('starts with an independent empty set and blocks HTML before its body exists', () => {
    const { document } = createHTMLDocument();
    const other = createTestDocument(document.env);

    expect(document.renderBlockingElements.size).toBe(0);
    expect(document.renderBlockingElements).not.toBe(other.renderBlockingElements);
    expect(document.allowsAddingRenderBlockingElements()).toBe(true);
    expect(document.isRenderBlocked()).toBe(true);
    expect(other.allowsAddingRenderBlockingElements()).toBe(false);
    expect(other.isRenderBlocked()).toBe(false);
  });

  it.each(['application/xhtml+xml', 'text/plain', 'TEXT/HTML', 'text/html; charset=utf-8'])(
    'does not admit blockers for content type %s', (contentType) => {
      const { document, head } = createHTMLDocument();
      document.contentType = contentType;
      const script = head.appendChild(document.createElement('script'));
      script.blockRendering();

      expect(document.allowsAddingRenderBlockingElements()).toBe(false);
      expect(document.renderBlockingElements.size).toBe(0);
      expect(document.isRenderBlocked()).toBe(false);
    },
  );

  it.each(['body', 'frameset'])('stops admitting blockers once the %s exists, retaining existing ones', (name) => {
    const { document, html, head } = createHTMLDocument();
    const first = head.appendChild(document.createElement('script'));
    const second = head.appendChild(document.createElement('script'));
    first.blockRendering();
    first.blockRendering();
    html.appendChild(document.createElement(name));
    second.blockRendering();

    expect(document.allowsAddingRenderBlockingElements()).toBe(false);
    expect(document.renderBlockingElements).toEqual(new Set([first]));
    expect(first.isRenderBlocking()).toBe(true);
    expect(second.isRenderBlocking()).toBe(false);
    expect(document.isRenderBlocked()).toBe(true);
    first.unblockRendering();
    first.unblockRendering();
    expect(document.isRenderBlocked()).toBe(false);
  });

  it('uses the document body definition, ignoring nested and foreign body elements', () => {
    const { document, html, head } = createHTMLDocument();
    head.appendChild(document.createElement('body'));
    html.appendChild(document.createElementNS(SVG_NAMESPACE, 'body'));

    expect(document.allowsAddingRenderBlockingElements()).toBe(true);
    html.appendChild(document.createElement('body'));
    expect(document.allowsAddingRenderBlockingElements()).toBe(false);
  });

  it('uses the global time origin and an inclusive cutoff without restarting for later blockers', () => {
    const { document, html, head, now } = createHTMLDocument();
    expect(document.env.userAgent.renderBlockingTimeout).toBe(5000);
    document.env.userAgent.renderBlockingTimeout = 100;
    now.mockReturnValue(new Duration(99));
    const script = head.appendChild(document.createElement('script'));
    script.blockRendering();
    html.appendChild(document.createElement('body'));

    now.mockReturnValue(new Duration(100));
    expect(document.isRenderBlocked()).toBe(true);
    expect(script.isRenderBlocking()).toBe(true);
    now.mockReturnValue(new Duration(101));
    expect(document.isRenderBlocked()).toBe(false);
    expect(script.isRenderBlocking()).toBe(false);
    // Expiration changes the predicate, not the pending resource's membership.
    expect(document.renderBlockingElements.has(script)).toBe(true);
    script.unblockRendering();
    expect(document.renderBlockingElements.size).toBe(0);
    document.body!.remove();
    expect(document.isRenderBlocked()).toBe(false);
  });

  it('does not mistake potential eligibility for an actual loading dependency', () => {
    const { document, head } = createHTMLDocument();
    const script = head.appendChild(document.createElement('script'));
    script.setAttribute('blocking', 'render');

    expect(script.isPotentiallyRenderBlocking()).toBe(true);
    expect(script.isRenderBlocking()).toBe(false);
    expect(document.renderBlockingElements.size).toBe(0);
    // The loading algorithm calls blockRendering after deciding to start eligible work.
    script.blockRendering();
    expect(script.isRenderBlocking()).toBe(true);
    script.unblockRendering();
    expect(document.isRenderBlocked()).toBe(true);
  });

  it.each(['link', 'style', 'script'])('unblocks %s when its blocking attribute loses eligibility', (name) => {
    const { document, html, head } = createHTMLDocument();
    const element = head.appendChild(document.createElement(name));
    element.setAttribute('blocking', 'render');
    element.blockRendering();
    html.appendChild(document.createElement('body'));
    element.setAttributeNS('urn:test', 'blocking', '');
    expect(element.isRenderBlocking()).toBe(true);
    // Preserve the approved ASCII-insensitive token interpretation.
    element.setAttribute('blocking', 'RENDER unknown');
    expect(element.isRenderBlocking()).toBe(true);

    element.removeAttribute('blocking');

    expect(element.isRenderBlocking()).toBe(false);
    expect(document.renderBlockingElements.size).toBe(0);
    expect(document.isRenderBlocked()).toBe(false);
  });

  it('retains an implicitly eligible stylesheet link when its explicit token is removed', () => {
    const { document, head } = createHTMLDocument();
    const link = head.appendChild(document.createElement('link'));
    link.initializeFromParser();
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('blocking', 'render');
    link.blockRendering();

    link.removeAttribute('blocking');

    expect(link.isPotentiallyRenderBlocking()).toBe(true);
    expect(link.isRenderBlocking()).toBe(true);
  });

  it('unblocks removed subtrees, including shadow descendants, without reblocking on reinsertion', () => {
    const { document, head } = createHTMLDocument();
    const host = head.appendChild(document.createElement('div'));
    host.attachShadowRoot('open', false, false, 'named', false, null);
    const light = host.appendChild(document.createElement('script'));
    const shadow = host.shadowRoot!.appendChild(document.createElement('script'));
    light.blockRendering();
    shadow.blockRendering();

    host.remove();

    expect(document.renderBlockingElements.size).toBe(0);
    head.appendChild(host);
    expect(light.isRenderBlocking()).toBe(false);
    expect(shadow.isRenderBlocking()).toBe(false);
  });

  it('unblocks connected elements when the browsing context is cleared directly', () => {
    const document = TopLevelTraversable.create(new UserAgent(), null, '').activeDocument!;
    vi.spyOn(document.env.timing, 'currentHighResolutionTime').mockReturnValue(new Duration(0));
    document.body!.remove();
    const script = document.head!.appendChild(document.createElement('script'));
    script.blockRendering();
    expect(document.browsingContext).not.toBeNull();
    expect(script.isRenderBlocking()).toBe(true);

    document.browsingContext = null;

    expect(script.isConnected).toBe(true);
    expect(document.renderBlockingElements.size).toBe(0);
  });

  it('does not repeat disconnection cleanup on a document without a browsing context', () => {
    const { document, head } = createHTMLDocument();
    const script = head.appendChild(document.createElement('script'));
    script.blockRendering();
    expect(document.browsingContext).toBeNull();

    document.browsingContext = null;

    expect(document.renderBlockingElements.has(script)).toBe(true);
  });

  it('cleans up the original document before adoption changes the element owner', () => {
    const { document, head } = createHTMLDocument();
    const other = createTestDocument(document.env);
    const script = head.appendChild(document.createElement('script'));
    script.blockRendering();

    other.adoptNode(script);

    expect(script.nodeDocument).toBe(other);
    expect(document.renderBlockingElements.size).toBe(0);
    expect(other.renderBlockingElements.size).toBe(0);
  });

  it('preserves blockers across a state-preserving move', () => {
    const { document, head } = createHTMLDocument();
    const parent = head.appendChild(document.createElement('div'));
    const script = head.appendChild(document.createElement('script'));
    script.blockRendering();

    parent.moveBefore(script, null);

    expect(script.isRenderBlocking()).toBe(true);
    expect(document.renderBlockingElements).toEqual(new Set([script]));
  });

  it('keeps script-blocking stylesheet state independent of rendering blockers', () => {
    const { document, head } = createHTMLDocument();
    const link = head.appendChild(document.createElement('link'));
    document.addScriptBlockingStyleSheet(link);
    link.blockRendering();
    link.unblockRendering();

    expect(document.renderBlockingElements.size).toBe(0);
    expect(document.hasScriptBlockingStyleSheets()).toBe(true);
    document.removeScriptBlockingStyleSheet(link);
  });
});

function createHTMLDocument() {
  const document = createTestDocument();
  document.type = 'html';
  document.contentType = 'text/html';
  const html = document.appendChild(document.createElementNS(HTML_NAMESPACE, 'html'));
  const head = html.appendChild(document.createElement('head'));
  const now = vi.spyOn(document.env.timing, 'currentHighResolutionTime').mockReturnValue(new Duration(0));
  return { document, html, head, now };
}
