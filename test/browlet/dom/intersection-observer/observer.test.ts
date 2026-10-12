import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import {
  IntersectionObserverImpl, type IntersectionObserverCallback, type IntersectionObserverOptions,
} from '../../../../src/browlet/dom/intersection-observer/index';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { lengthLiteral, percentageLiteral } from '../../../../src/stylelet/index';
import { unwrap } from '../../../support/browlet-binding';

describe('Intersection Observer scaffold', () => {
  it('captures the owning environment and snapshots mutable margins and thresholds', () => {
    const { observer, options, document } = createObserver();
    expect(observer.env).toBe(document.env);
    expect(observer.options).toEqual(options);
    expect(observer.options).not.toBe(options);
    expect(observer.options.threshold).not.toBe(options.threshold);
    options.rootMargin[2].value = 20;
    options.scrollMargin[0].value = 200;
    options.scrollMargin[1] = percentageLiteral(10);
    options.threshold.push(1);
    expect(observer.options.rootMargin).toEqual([
      lengthLiteral(0), lengthLiteral(0), lengthLiteral(0), lengthLiteral(0),
    ]);
    expect(observer.options.scrollMargin).toEqual([
      lengthLiteral(50), percentageLiteral(100), lengthLiteral(75), percentageLiteral(50),
    ]);
    expect(observer.options.threshold).toEqual([0, 0.5]);
  });

  it('registers each target once and preserves its previous state on duplicate observe()', () => {
    const { observer, document, callback } = createObserver();
    const target = document.createElement('div');
    observer.observe(target);
    const registration = target.registeredIntersectionObservers[0]!;
    expect(registration).toEqual({
      observer, previousThresholdIndex: -1, previousIsIntersecting: false, previousIsVisible: false,
    });
    registration.previousThresholdIndex = 1;
    registration.previousIsIntersecting = true;
    observer.observe(target);
    expect(target.registeredIntersectionObservers).toEqual([registration]);
    expect(registration.previousThresholdIndex).toBe(1);
    expect(registration.previousIsIntersecting).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(observer.takeRecords()).toEqual([]);
  });

  it('unobserves independently, tolerates repeated removal, and resets history when reobserved', () => {
    const { observer, document, options } = createObserver();
    const other = new IntersectionObserverImpl(vi.fn(), options, document.env);
    const target = document.createElement('div');
    observer.observe(target);
    other.observe(target);
    const original = target.registeredIntersectionObservers[0]!;
    const remaining = target.registeredIntersectionObservers[1]!;
    observer.unobserve(target);
    observer.unobserve(target);
    expect(target.registeredIntersectionObservers).toEqual([remaining]);
    observer.observe(target);
    expect(target.registeredIntersectionObservers[1]).not.toBe(original);
    expect(target.registeredIntersectionObservers[1]!.previousThresholdIndex).toBe(-1);
  });

  it('disconnects all targets without clearing another observer or already queued entries', () => {
    const { observer, document, options } = createObserver();
    const other = new IntersectionObserverImpl(vi.fn(), options, document.env);
    const first = document.createElement('div');
    const second = document.createElement('span');
    observer.observe(first);
    observer.observe(second);
    other.observe(first);
    const entry = { target: first, isIntersecting: true };
    observer.enqueueEntry(entry);
    observer.disconnect();
    observer.disconnect();
    expect(first.registeredIntersectionObservers.map((record) => record.observer)).toEqual([other]);
    expect(second.registeredIntersectionObservers).toEqual([]);
    expect(observer.takeRecords()).toEqual([entry]);
  });

  it('drains entries in order, preserving registrations and separating subsequent batches', () => {
    const { observer, document, callback } = createObserver();
    const target = document.createElement('div');
    observer.observe(target);
    const first = { target, isIntersecting: false };
    const second = { target, isIntersecting: true };
    observer.enqueueEntry(first);
    observer.enqueueEntry(second);
    const records = observer.takeRecords();
    expect(records).toEqual([first, second]);
    expect(observer.takeRecords()).toEqual([]);
    expect(target.registeredIntersectionObservers).toHaveLength(1);
    observer.enqueueEntry(first);
    records.length = 0;
    expect(observer.takeRecords()).toEqual([first]);
    observer.notify();
    expect(callback).not.toHaveBeenCalled();
  });

  it('clears the delivered batch before callback entry and leaves new entries for the next notification', () => {
    const { observer, document, callback } = createObserver();
    const target = document.createElement('div');
    const first = { target, isIntersecting: true };
    const next = { target, isIntersecting: false };
    callback.mockImplementationOnce(function(this: IntersectionObserverImpl, entries, source) {
      expect(this).toBe(observer);
      expect(source).toBe(observer);
      expect(entries).toEqual([first]);
      expect(observer.takeRecords()).toEqual([]);
      observer.enqueueEntry(next);
    });
    observer.enqueueEntry(first);
    expect(callback).not.toHaveBeenCalled();
    observer.notify();
    expect(callback).toHaveBeenCalledTimes(1);
    observer.notify();
    expect(callback).toHaveBeenLastCalledWith([next], observer);
    observer.notify();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('retains registrations on adopted targets and can still disconnect them', () => {
    const { observer, document } = createObserver();
    const target = document.createElement('div');
    const destination = document.implementation.createHTMLDocument('destination');
    observer.observe(target);
    const registration = target.registeredIntersectionObservers[0]!;
    destination.adoptNode(target);
    expect(target.registeredIntersectionObservers).toEqual([registration]);
    expect(observer.env).toBe(document.env);
    observer.disconnect();
    expect(target.registeredIntersectionObservers).toEqual([]);
  });
});

function createObserver() {
  const browser = new Browlet({ route: () => '' });
  const document = unwrap<DocumentImpl>(browser.document);
  const callback = vi.fn<IntersectionObserverCallback>();
  const options = {
    root: null,
    rootMargin: [lengthLiteral(0), lengthLiteral(0), lengthLiteral(0), lengthLiteral(0)],
    scrollMargin: [lengthLiteral(50), percentageLiteral(100), lengthLiteral(75), percentageLiteral(50)],
    threshold: [0, 0.5],
    delay: 0,
    trackVisibility: false,
  } satisfies IntersectionObserverOptions;
  return { document, callback, options, observer: new IntersectionObserverImpl(callback, options, document.env) };
}
