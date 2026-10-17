import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../../src/browlet/dom/nodes/document';
import { DocumentParser } from '../../../../src/browlet/html/parser/document-parser';
import { HTMLDocumentParser } from '../../../../src/browlet/html/parser/html-document-parser';
import type { Event } from '../../../../src/browlet/platform';
import { Duration } from '../../../../src/browlet/timing/clock';
import { unwrap } from '../../../support/browlet-binding';
import { createTestDocument } from '../../../support/dom';

afterEach(() => vi.restoreAllMocks());

describe('Document loading status', () => {
  it('starts complete with independent zeroed loading and previous-unload milestones', () => {
    const browlet = new Browlet({ route: () => '' });
    const initial = unwrap<DocumentImpl>(browlet.document);
    const detached = createTestDocument(initial.env);

    expect(initial.readyState).toBe('complete');
    expect(detached.readyState).toBe('complete');
    expect(detached.parser).toBeNull();
    expect(detached.activeParser).toBeNull();
    expect(detached.wasCreatedViaCrossOriginRedirects).toBe(false);
    expect(detached.loadTimingInfo).toEqual({
      navigationStartTime: 0,
      domInteractiveTime: 0,
      domContentLoadedEventStartTime: 0,
      domContentLoadedEventEndTime: 0,
      domCompleteTime: 0,
      loadEventStartTime: 0,
      loadEventEndTime: 0,
    });
    expect(detached.previousDocumentUnloadTiming).toEqual({ unloadEventStartTime: 0, unloadEventEndTime: 0 });
    expect(detached.loadTimingInfo).not.toBe(initial.loadTimingInfo);
    expect(detached.previousDocumentUnloadTiming).not.toBe(initial.previousDocumentUnloadTiming);
  });

  it('changes readiness before synchronous trusted event delivery and ignores unchanged states', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const changes: { readiness: string; event: Event; currentTarget: unknown; }[] = [];
    browlet.document.addEventListener('readystatechange', (event) => {
      changes.push({ readiness: browlet.document.readyState, event, currentTarget: event.currentTarget });
    });

    document.updateCurrentDocumentReadiness('complete');
    document.updateCurrentDocumentReadiness('loading');
    document.updateCurrentDocumentReadiness('loading');
    document.updateCurrentDocumentReadiness('interactive');
    document.updateCurrentDocumentReadiness('complete');

    expect(changes.map((change) => change.readiness)).toEqual(['loading', 'interactive', 'complete']);
    for (const { event, currentTarget } of changes) {
      expect(event).toBeInstanceOf(browlet.window.Event);
      expect(event.target).toBe(browlet.document);
      expect(currentTarget).toBe(browlet.document);
      expect(event.isTrusted).toBe(true);
      expect(event.bubbles).toBe(false);
      expect(event.cancelable).toBe(false);
    }
    expect(document.loadTimingInfo.domInteractiveTime).toBe(0);
    expect(document.loadTimingInfo.domCompleteTime).toBe(0);
  });

  it('records the first HTML milestones before listeners run, retaining a stopped parser association', () => {
    const document = createTestDocument();
    const parser = new HTMLDocumentParser(document, () => {});
    const times: number[][] = [];
    document.addEventListener('readystatechange', () => {
      times.push([document.loadTimingInfo.domInteractiveTime, document.loadTimingInfo.domCompleteTime]);
    });
    const now = vi.spyOn(document.env.timing, 'currentHighResolutionTime')
      .mockReturnValue(new Duration(12));

    document.updateCurrentDocumentReadiness('complete');
    expect(times).toEqual([]);
    expect(document.loadTimingInfo.domCompleteTime).toBe(0);
    expect(document.activeParser).toBe(parser);

    document.updateCurrentDocumentReadiness('interactive');
    parser.stopped = true;
    now.mockReturnValue(new Duration(25));
    document.updateCurrentDocumentReadiness('complete');
    expect(times).toEqual([[12, 0], [12, 25]]);
    expect(document.activeParser).toBeNull();
    expect(document.parser).toBe(parser);
    now.mockReturnValue(new Duration(50));
    document.updateCurrentDocumentReadiness('loading');
    document.updateCurrentDocumentReadiness('interactive');
    document.updateCurrentDocumentReadiness('complete');
    expect(document.loadTimingInfo.domInteractiveTime).toBe(12);
    expect(document.loadTimingInfo.domCompleteTime).toBe(25);
  });

  it('recognizes XML parser activity without recording HTML parsing milestones', () => {
    const document = createTestDocument();
    // Exercise the Document contract; an XML parser implementation is still missing.
    const parser = new class extends DocumentParser {
      kind = 'xml' as const;
      abort(): void {}
    }(document);

    expect(document.activeParser).toBe(parser);
    document.updateCurrentDocumentReadiness('interactive');
    parser.stopped = true;
    document.updateCurrentDocumentReadiness('complete');

    expect(document.activeParser).toBeNull();
    expect(document.loadTimingInfo.domInteractiveTime).toBe(0);
    expect(document.loadTimingInfo.domCompleteTime).toBe(0);
  });

  it('projects onreadystatechange through the shared event-handler conversion', () => {
    const browlet = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browlet.document);
    const calls: { readiness: string; receiver: unknown; target: unknown; }[] = [];

    expect(browlet.document.onreadystatechange).toBeNull();
    browlet.document.onreadystatechange = function(this: unknown, event) {
      calls.push({ readiness: browlet.document.readyState, receiver: this, target: event.target });
      return false;
    };
    const callback = browlet.document.onreadystatechange;
    document.updateCurrentDocumentReadiness('interactive');
    expect(browlet.document.onreadystatechange).toBe(callback);
    // EventHandler's LegacyTreatNonObjectAsNull clears a non-callable primitive.
    Reflect.set(browlet.document, 'onreadystatechange', 7);
    document.updateCurrentDocumentReadiness('complete');

    expect(browlet.document.onreadystatechange).toBeNull();
    expect(calls).toEqual([{ readiness: 'interactive', receiver: browlet.document, target: browlet.document }]);
  });

  it('preserves LegacyLenientThis for the readiness handler attribute', async () => {
    const browlet = new Browlet({ route: () => '' });

    expect(await browlet.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'onreadystatechange')!;
      return [descriptor.get!.call({}) === undefined, descriptor.set!.call({}, () => {}) === undefined];
    })).toEqual([true, true]);
  });

  it('reports interactive and complete readiness after a navigation starts loading', async () => {
    const browlet = new Browlet({
      route: () => `<script>
        document.documentElement.setAttribute('data-states', document.readyState);
        document.addEventListener('readystatechange', () => {
          const root = document.documentElement;
          root.setAttribute('data-states', root.getAttribute('data-states') + ',' + document.readyState);
        });
      </script>`,
    });

    await browlet.navigate('https://example.test/');

    expect(browlet.document.documentElement!.getAttribute('data-states'))
      .toBe('loading,interactive,complete');
    const document = unwrap<DocumentImpl>(browlet.document);
    expect(document.parser).toBeNull();
    expect(document.activeParser).toBeNull();
    expect(document.loadTimingInfo.domInteractiveTime).toBeGreaterThan(0);
    expect(document.loadTimingInfo.domCompleteTime).toBeGreaterThanOrEqual(document.loadTimingInfo.domInteractiveTime);
  });

  it('delivers DOMContentLoaded between readiness changes and targets the document for Window load', async () => {
    const browlet = new Browlet({
      route: () => `<script>
        const events = [];
        document.onreadystatechange = () => events.push(document.readyState);
        document.addEventListener('DOMContentLoaded', (event) => {
          events.push(event.type, event.bubbles, document.readyState);
        });
        window.addEventListener('load', (event) => {
          events.push(event.type, event.target === document, document.readyState);
          document.documentElement.setAttribute('data-events', events.join(','));
        });
      </script>`,
    });

    await browlet.navigate('https://example.test/');

    expect(browlet.document.documentElement!.getAttribute('data-events'))
      .toBe('interactive,DOMContentLoaded,true,interactive,complete,load,true,complete');
  });
});
