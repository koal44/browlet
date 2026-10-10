import { describe, expect, it, vi } from 'vitest';
import { Browlet } from '../../../../src/browlet/browlet';
import { getRelevantRealm } from '../../../support/browlet-binding';

describe('MutationObserver', () => {
  it('exposes the interfaces and validates callbacks, receivers, and observation options', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const node = document.createElement('div');
      const observer = new MutationObserver(() => {});
      const invalid = [
        () => { Reflect.construct(MutationObserver, []); },
        () => { Reflect.construct(MutationObserver, [null]); },
        () => { Reflect.construct(MutationRecord, []); },
        () => MutationObserver.prototype.observe.call({}, node, { childList: true }),
        () => observer.observe({} as Node, { childList: true }),
        () => observer.observe(node),
        () => observer.observe(node, {}),
        () => observer.observe(node, { childList: true, attributes: false, attributeOldValue: true }),
        () => observer.observe(node, { childList: true, attributes: false, attributeFilter: [] }),
        () => observer.observe(node, { childList: true, characterData: false, characterDataOldValue: true }),
      ].map((run) => {
        try { run(); return false; } catch (error) { return error instanceof TypeError; }
      });
      return [MutationObserver.length, observer instanceof MutationObserver, invalid, observer.takeRecords()];
    })).toEqual([1, true, Array(10).fill(true), []]);
  });

  it('defaults observation flags from the presence of converted options, even false old-value flags', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const element = document.createElement('div');
      const text = document.createTextNode('old');
      const observer = new MutationObserver(() => {});
      const options = { attributeOldValue: false, attributeFilter: ['id'] };
      observer.observe(element, options);
      observer.observe(text, { characterDataOldValue: false });
      options.attributeFilter[0] = 'class';
      element.setAttribute('id', 'new');
      element.setAttribute('class', 'ignored');
      text.data = 'new';
      const records = observer.takeRecords();
      return [
        records.map((record) => [record.type, record.attributeName, record.oldValue]),
        'attributes' in options,
      ];
    })).toEqual([[['attributes', 'id', null], ['characterData', null, null]], false]);
  });

  it('replaces options without duplicating a registration or discarding queued records', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const target = document.createElement('div');
      const observer = new MutationObserver(() => {});
      observer.observe(target, { attributes: true });
      target.setAttribute('id', 'first');
      observer.observe(target, { attributeFilter: ['class'], attributeOldValue: true });
      target.setAttribute('id', 'ignored');
      target.setAttribute('class', 'one');
      target.setAttribute('class', 'two');
      try { observer.observe(target, { attributes: false }); } catch { /* The old registration remains. */ }
      target.setAttribute('class', 'three');
      return observer.takeRecords().map((record) => [record.attributeName, record.oldValue]);
    })).toEqual([['id', null], ['class', null], ['class', 'one'], ['class', 'two']]);
  });

  it('delivers a batch at the Agent checkpoint with projected arguments and the observer as this', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const log: unknown[] = [];
      const target = document.createElement('div');
      const observer = new MutationObserver(function(this: MutationObserver, records, argument) {
        log.push([
          'callback', this === observer, argument === observer, records instanceof Array,
          records.every((record) => record instanceof MutationRecord),
          records.map((record) => record.attributeName), observer.takeRecords().length,
        ]);
      });
      observer.observe(target, { attributes: true });
      target.setAttribute('id', 'one');
      target.setAttribute('class', 'two');
      log.push('synchronous');
      return log;
    })).toEqual(['synchronous', ['callback', true, true, true, true, ['id', 'class'], 0]]);
  });

  it('drains takeRecords without callbacks for empty batches and disconnects without later delivery', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const log: unknown[] = [];
      const target = document.createElement('div');
      const observer = new MutationObserver((records) => log.push(records.length));
      observer.observe(target, { attributes: true });
      target.setAttribute('id', 'drained');
      const first = observer.takeRecords();
      log.push(first.length, observer.takeRecords().length);
      target.setAttribute('id', 'discarded');
      observer.disconnect();
      target.setAttribute('id', 'unobserved');
      log.push(observer.takeRecords().length, first[0]!.target === target);
      queueMicrotask(() => {
        observer.observe(target, { attributes: true });
        target.setAttribute('id', 'reconnected');
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return log;
    })).toEqual([1, 0, 0, true, 1]);
  });

  it('uses creation order even when observers become pending in the opposite order', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const order: string[] = [];
      const first = new MutationObserver(() => order.push('first'));
      const second = new MutationObserver(() => order.push('second'));
      const a = document.createElement('div');
      const b = document.createElement('div');
      first.observe(a, { attributes: true });
      second.observe(b, { attributes: true });
      b.setAttribute('id', 'b');
      a.setAttribute('id', 'a');
      return order;
    })).toEqual(['first', 'second']);
  });

  it('snapshots pending observers but drains each record queue immediately before its callback', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const log: unknown[] = [];
      const target = document.createElement('div');
      let changed = false;
      const first = new MutationObserver((records) => {
        log.push(['first', records.map((record) => record.attributeName)]);
        if (!changed) {
          changed = true;
          target.setAttribute('class', 'nested');
        }
      });
      const second = new MutationObserver((records) => {
        log.push(['second', records.map((record) => record.attributeName)]);
      });
      first.observe(target, { attributes: true });
      second.observe(target, { attributes: true });
      target.setAttribute('id', 'initial');
      queueMicrotask(() => log.push('queued-between-batches'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return log;
    })).toEqual([
      ['first', ['id']], ['second', ['id', 'class']], 'queued-between-batches', ['first', ['class']],
    ]);
  });

  it('allows an earlier callback to disconnect a later observer in the same notification', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const log: string[] = [];
      const target = document.createElement('div');
      const first = new MutationObserver(() => { log.push('first'); second.disconnect(); });
      const second = new MutationObserver(() => log.push('second'));
      first.observe(target, { attributes: true });
      second.observe(target, { attributes: true });
      target.setAttribute('id', 'change');
      return log;
    })).toEqual(['first']);
  });

  it('does not let an unobserved mutation move later observer delivery ahead of queued microtasks', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const log: string[] = [];
      const target = document.createElement('div');
      target.append('unobserved');
      queueMicrotask(() => log.push('microtask'));
      void Promise.resolve().then(() => log.push('promise'));
      const observer = new MutationObserver(() => log.push('observer'));
      observer.observe(target, { attributes: true });
      target.setAttribute('id', 'observed');
      return log;
    })).toEqual(['microtask', 'promise', 'observer']);
  });

  it('keeps removed subtrees observable until notification, including nested removals', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const batches: unknown[] = [];
      const parent = document.createElement('div');
      const child = document.createElement('span');
      const descendant = document.createElement('b');
      parent.append(child);
      child.append(descendant);
      const observer = new MutationObserver((records) => batches.push(records.map((record) => record.type)));
      observer.observe(parent, { subtree: true, childList: true, attributes: true });
      child.remove();
      descendant.remove();
      descendant.setAttribute('id', 'before');
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      child.setAttribute('id', 'after');
      descendant.setAttribute('id', 'after');
      return batches;
    })).toEqual([['childList', 'childList', 'attributes']]);
  });

  it('cleans transient observation even when removal queues no matching record', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const batches: number[] = [];
      const parent = document.createElement('div');
      const child = document.createElement('span');
      parent.append(child);
      const observer = new MutationObserver((records) => batches.push(records.length));
      observer.observe(parent, { subtree: true, attributes: true });
      child.remove();
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      child.setAttribute('id', 'after');
      return batches;
    })).toEqual([]);
  });

  it('preserves transient observation through takeRecords but removes it when observe replaces its source', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const child = document.createElement('span');
      parent.append(child);
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { subtree: true, childList: true, attributes: true });
      child.remove();
      const removed = observer.takeRecords().map((record) => record.type);
      child.setAttribute('id', 'still-observed');
      const before = observer.takeRecords().map((record) => record.type);
      observer.observe(parent, { subtree: true, childList: true, attributes: true });
      child.setAttribute('id', 'unobserved');
      return [removed, before, observer.takeRecords().length];
    })).toEqual([['childList'], ['attributes'], 0]);
  });

  it('can explicitly observe a detached transient target and retain that registration', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const batches: unknown[] = [];
      const parent = document.createElement('div');
      const child = document.createElement('span');
      parent.append(child);
      const observer = new MutationObserver((records) => batches.push(records.map((record) => record.attributeName)));
      observer.observe(parent, { subtree: true, attributes: true });
      child.remove();
      observer.observe(child, { attributeFilter: ['id'] });
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      child.setAttribute('id', 'observed');
      child.setAttribute('class', 'filtered');
      return batches;
    })).toEqual([['id']]);
  });

  it('clears nested transient registrations when the original observation is replaced', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const parent = document.createElement('div');
      const child = document.createElement('span');
      const descendant = document.createElement('b');
      parent.append(child);
      child.append(descendant);
      const observer = new MutationObserver(() => {});
      observer.observe(parent, { subtree: true, attributes: true });
      child.remove();
      descendant.remove();
      descendant.setAttribute('id', 'before');
      const before = observer.takeRecords().length;
      observer.observe(parent, { subtree: true, attributes: true });
      descendant.setAttribute('id', 'after');
      return [before, observer.takeRecords().length];
    })).toEqual([1, 0]);
  });

  it('reports an exception in the callback realm and continues delivering other observers', async () => {
    const browser = new Browlet({ route: () => '' });
    const realm = getRelevantRealm(browser.window);
    const report = vi.spyOn(realm, 'reportException').mockImplementation(() => {});
    try {
      expect(await browser.evaluate(() => {
        const log: string[] = [];
        const target = document.createElement('div');
        const first = new MutationObserver(() => { throw new Error('observer failed'); });
        const second = new MutationObserver(() => log.push('second'));
        first.observe(target, { attributes: true });
        second.observe(target, { attributes: true });
        target.setAttribute('id', 'change');
        return log;
      })).toEqual(['second']);
      expect(report).toHaveBeenCalledOnce();
      expect(report.mock.calls[0]![0]).toHaveProperty('message', 'observer failed');
    } finally {
      report.mockRestore();
    }
  });
});
