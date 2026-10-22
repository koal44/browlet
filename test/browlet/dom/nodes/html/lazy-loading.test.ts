import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../../src/browlet/browlet';
import type { IntersectionObserverImpl, IntersectionObserverEntryImpl } from '../../../../../src/browlet/dom/intersection-observer/index';
import type { DocumentImpl } from '../../../../../src/browlet/dom/nodes/document';
import type { ElementImpl } from '../../../../../src/browlet/dom/nodes/element';
import {
  HTMLImageElementImpl, HTMLIFrameElementImpl, HTMLMediaElementImpl, HTMLVideoElementImpl,
} from '../../../../../src/browlet/dom/nodes/html/embedded/index';
import type { HTMLImageElement, HTMLIFrameElement, HTMLMediaElement, Window } from '../../../../../src/browlet/platform';
import { LengthLiteral, PercentageLiteral } from '../../../../../src/stylelet/index';
import { unwrap } from '../../../../support/browlet-binding';

// Use Browlet's generated surface for media.loading, which TypeScript's ambient DOM lacks.
declare const window: Window;

const tags = ['img', 'iframe', 'audio', 'video'] as const;

describe.each(tags)('%s loading policy', (tag) => {
  it('reflects canonical keywords while retaining the supplied attribute text', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((localName) => {
      const element = window.document.createElement(localName) as HTMLImageElement | HTMLIFrameElement | HTMLMediaElement;
      return [null, '', 'lazy', 'LaZy', 'EAGER', 'auto', ' lazy ', 'lazy,eager'].map((value) => {
        if (value === null) element.removeAttribute('loading');
        else element.setAttribute('loading', value);
        return [element.loading, element.getAttribute('loading')];
      });
    }, tag)).toEqual([
      ['eager', null], ['eager', ''], ['lazy', 'lazy'], ['lazy', 'LaZy'],
      ['eager', 'EAGER'], ['eager', 'auto'], ['eager', ' lazy '], ['eager', 'lazy,eager'],
    ]);
  });

  it('uses DOMString conversion, DOM mutations, and only null-namespace loading attributes', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate((localName) => {
      const element = window.document.createElement(localName) as HTMLImageElement | HTMLIFrameElement | HTMLMediaElement;
      element.setAttributeNS('urn:other', 'x:loading', 'lazy');
      const initial = element.loading;
      const observer = new window.MutationObserver(() => {});
      observer.observe(element, { attributes: true, attributeOldValue: true });
      Reflect.set(element, 'loading', { toString: () => 'LAZY' });
      element.loading = 'LAZY';
      element.getAttributeNode('loading')!.value = 'eager';
      Reflect.set(element, 'loading', null);
      const records = observer.takeRecords().map((record) => [record.attributeName, record.oldValue]);
      return [initial, element.loading, element.getAttribute('loading'), records];
    }, tag)).toEqual([
      'eager', 'eager', 'null',
      [['loading', null], ['loading', 'LAZY'], ['loading', 'LAZY'], ['loading', 'eager']],
    ]);
  });

  it('requires scripting and a node document with a browsing context', () => {
    const { element, document, automation } = createElement(tag);
    expect(element.willLazyLoad()).toBe(false);
    element.setAttributeValue('loading', 'lazy');
    expect(element.willLazyLoad()).toBe(true);
    expect(automation).toHaveBeenLastCalledWith(element.env);

    document.env.userAgent.scriptingEnabled = false;
    expect(element.willLazyLoad()).toBe(false);
    document.env.userAgent.scriptingEnabled = true;
    document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(element.willLazyLoad()).toBe(false);
    document.activeSandboxingFlagSet.clear();
    automation.mockReturnValue(false);
    expect(element.willLazyLoad()).toBe(false);
    automation.mockReturnValue(true);

    const detached = document.implementation.createHTMLDocument('detached');
    detached.adoptNode(element);
    expect(element.nodeDocument).toBe(detached);
    expect(element.willLazyLoad()).toBe(false);
  });

  it('keeps the original realm settings after adoption into a different active document', () => {
    const source = createElement(tag);
    const destination = createElement(tag);
    source.element.setAttributeValue('loading', 'lazy');
    destination.document.adoptNode(source.element);
    destination.document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(source.element.willLazyLoad()).toBe(true);
    source.document.activeSandboxingFlagSet.add('sandboxed-scripts');
    expect(source.element.willLazyLoad()).toBe(false);
  });

  it.each(['eager', '', 'invalid', null])('resumes once when lazy becomes %j', (value) => {
    const { element } = createElement(tag);
    element.setAttributeValue('loading', 'lazy');
    const steps = vi.fn(() => expect(element.lazyLoadResumptionSteps).toBeNull());
    element.lazyLoadResumptionSteps = steps;
    if (value === null) element.removeAttribute('loading');
    else element.setAttributeValue('loading', value);
    expect(steps).toHaveBeenCalledTimes(1);
    element.setAttributeValue('loading', 'eager');
    expect(steps).toHaveBeenCalledTimes(1);
  });

  it('does not resume when spelling changes without a state transition', () => {
    const { element } = createElement(tag);
    element.setAttributeValue('loading', 'lazy');
    const steps = vi.fn();
    element.lazyLoadResumptionSteps = steps;
    element.setAttributeValue('loading', 'LAZY');
    element.setAttributeNS('urn:other', 'x:loading', 'eager');
    expect(steps).not.toHaveBeenCalled();
    expect(element.lazyLoadResumptionSteps).toBe(steps);
  });
});

describe('video poster continuation', () => {
  it('captures both continuations before invoking media loading and clears each immediately before invocation', () => {
    const { element } = createElement('video');
    if (!HTMLVideoElementImpl.is(element)) throw new Error('Expected video implementation');
    element.setAttributeValue('loading', 'lazy');
    const calls: string[] = [];
    const poster = () => {
      expect(element.posterLazyLoadResumptionSteps).toBeNull();
      calls.push('poster');
    };
    const replacement = vi.fn();
    element.posterLazyLoadResumptionSteps = poster;
    element.lazyLoadResumptionSteps = () => {
      expect(element.lazyLoadResumptionSteps).toBeNull();
      expect(element.posterLazyLoadResumptionSteps).toBe(poster);
      element.posterLazyLoadResumptionSteps = replacement;
      calls.push('media');
    };
    element.setAttributeValue('loading', 'eager');
    expect(calls).toEqual(['media', 'poster']);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('can resume only the poster without a media continuation', () => {
    const { element } = createElement('video');
    if (!HTMLVideoElementImpl.is(element)) throw new Error('Expected video implementation');
    element.setAttributeValue('loading', 'lazy');
    const poster = vi.fn();
    element.posterLazyLoadResumptionSteps = poster;
    element.setAttributeValue('loading', 'eager');
    expect(poster).toHaveBeenCalledOnce();
    expect(element.posterLazyLoadResumptionSteps).toBeNull();
  });
});

describe('document lazy-loading observer', () => {
  it('creates one observer per document in that document’s environment with the selected margin', () => {
    const first = createElement('img');
    const second = createElement('iframe');
    first.document.env.userAgent.lazyLoadScrollMargin = [
      new LengthLiteral(250, 'px'), new PercentageLiteral(10), new LengthLiteral(400, 'px'), new PercentageLiteral(20),
    ];
    first.document.startObservingLazyLoadingElement(first.element);
    first.document.startObservingLazyLoadingElement(first.element);
    const other = first.document.createElement('img');
    if (!HTMLImageElementImpl.is(other)) throw new Error('Expected image implementation');
    first.document.startObservingLazyLoadingElement(other);
    second.document.startObservingLazyLoadingElement(second.element);
    const observer = getObserver(first.element);
    expect(getObserver(other)).toBe(observer);
    expect(getObserver(second.element)).not.toBe(observer);
    expect(observer.env).toBe(first.document.env);
    expect(getObserver(second.element).env).toBe(second.document.env);
    first.document.env.userAgent.lazyLoadScrollMargin[0].value = 999;
    expect(observer.options).toEqual({
      root: null,
      rootMargin: [new LengthLiteral(0, 'px'), new LengthLiteral(0, 'px'), new LengthLiteral(0, 'px'), new LengthLiteral(0, 'px')],
      scrollMargin: [new LengthLiteral(250, 'px'), new PercentageLiteral(10), new LengthLiteral(400, 'px'), new PercentageLiteral(20)],
      threshold: 0, delay: 0, trackVisibility: false,
    });
    expect(getObserver(second.element).options.scrollMargin).toEqual([
      new PercentageLiteral(100), new PercentageLiteral(100), new PercentageLiteral(100), new PercentageLiteral(100),
    ]);
    expect(first.element.registeredIntersectionObservers).toHaveLength(1);
  });

  it('continues past a non-intersecting entry and an intersecting entry with no pending work', () => {
    const { document, element } = createElement('img');
    const other = document.createElement('img');
    if (!HTMLImageElementImpl.is(other)) throw new Error('Expected image implementation');
    const steps = vi.fn();
    element.lazyLoadResumptionSteps = steps;
    document.startObservingLazyLoadingElement(other);
    document.startObservingLazyLoadingElement(element);
    const observer = getObserver(element);
    deliver(observer, [
      { target: element, isIntersecting: false },
      { target: other, isIntersecting: true },
      { target: element, isIntersecting: true },
    ]);
    expect(steps).toHaveBeenCalledOnce();
    expect(element.lazyLoadResumptionSteps).toBeNull();
    expect(element.registeredIntersectionObservers).toHaveLength(0);
    expect(getObserver(other)).toBe(observer);
  });

  it('unobserves before resuming and ignores later entries after the work is consumed', () => {
    const { document, element } = createElement('iframe');
    document.startObservingLazyLoadingElement(element);
    const observer = getObserver(element);
    const unobserve = vi.spyOn(observer, 'unobserve');
    const steps = vi.fn(() => {
      expect(element.lazyLoadResumptionSteps).toBeNull();
      expect(element.registeredIntersectionObservers).toHaveLength(0);
    });
    element.lazyLoadResumptionSteps = steps;
    deliver(observer, [
      { target: element, isIntersecting: true },
      { target: element, isIntersecting: true },
    ]);
    expect(steps).toHaveBeenCalledOnce();
    expect(unobserve).toHaveBeenCalledExactlyOnceWith(element);
  });

  it('captures media and poster continuations before either runs', () => {
    const { document, element } = createElement('video');
    if (!HTMLVideoElementImpl.is(element)) throw new Error('Expected video implementation');
    document.startObservingLazyLoadingElement(element);
    const observer = getObserver(element);
    const calls: string[] = [];
    const replacement = vi.fn();
    const poster = () => {
      expect(element.posterLazyLoadResumptionSteps).toBeNull();
      calls.push('poster');
    };
    element.posterLazyLoadResumptionSteps = poster;
    element.lazyLoadResumptionSteps = () => {
      expect(element.registeredIntersectionObservers).toHaveLength(0);
      expect(element.lazyLoadResumptionSteps).toBeNull();
      expect(element.posterLazyLoadResumptionSteps).toBe(poster);
      element.posterLazyLoadResumptionSteps = replacement;
      calls.push('media');
    };
    deliver(observer, [{ target: element, isIntersecting: true }]);
    expect(calls).toEqual(['media', 'poster']);
    expect(replacement).not.toHaveBeenCalled();
  });

  it('resumes a poster without a media continuation', () => {
    const { document, element } = createElement('video');
    if (!HTMLVideoElementImpl.is(element)) throw new Error('Expected video implementation');
    const poster = vi.fn();
    element.posterLazyLoadResumptionSteps = poster;
    document.startObservingLazyLoadingElement(element);
    const observer = getObserver(element);
    deliver(observer, [{ target: element, isIntersecting: true }]);
    expect(poster).toHaveBeenCalledOnce();
    expect(element.posterLazyLoadResumptionSteps).toBeNull();
    expect(element.registeredIntersectionObservers).toHaveLength(0);
  });

  it('does not invoke author iterator hooks on the internal entry list', () => {
    const { document, element } = createElement('img');
    const steps = vi.fn();
    element.lazyLoadResumptionSteps = steps;
    document.startObservingLazyLoadingElement(element);
    const entries = [{ target: element, isIntersecting: true }];
    entries[Symbol.iterator] = () => { throw new Error('Iterator must not run'); };
    const observer = getObserver(element);
    // Supply the notification batch directly so the consumer sees the hostile iterator.
    vi.spyOn(observer, 'takeRecords').mockReturnValueOnce(entries);
    observer.notify();
    expect(steps).toHaveBeenCalledOnce();
  });
});

function getObserver(element: ElementImpl): IntersectionObserverImpl {
  return element.registeredIntersectionObservers[0]!.observer;
}

/** Supply rendering results explicitly; this does not exercise geometry or task scheduling. */
function deliver(observer: IntersectionObserverImpl, entries: IntersectionObserverEntryImpl[]): void {
  for (const entry of entries) observer.enqueueEntry(entry);
  observer.notify();
}

function createElement(tag: typeof tags[number]) {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  // Use the actual no-session result unless a test selects an automation override.
  const automation = vi.spyOn(document.env.userAgent, 'webDriverBiDiScriptingIsEnabled');
  const element = document.createElement(tag);
  if (!HTMLImageElementImpl.is(element) && !HTMLIFrameElementImpl.is(element) && !HTMLMediaElementImpl.is(element)) {
    throw new Error(`Missing ${tag} implementation`);
  }
  return { browser, document, element, automation };
}
