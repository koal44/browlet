import { describe, expect, it } from 'vitest';
import { Browlet } from '../../../../../src/browlet/browlet';
import type { HTMLSlotElement as PlatformSlotElement } from '../../../../../src/browlet/platform';
import { getRelevantRealm, unwrap } from '../../../../support/browlet-binding';
import { collectGarbage } from '../../../../support/garbage-collection';

describe('HTMLSlotElement', () => {
  it('assigns only direct element/text children, by exact name and tree order', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const unnamed = document.createElement('slot');
      const named = document.createElement('slot');
      named.name = 'Name';
      const duplicate = document.createElement('slot');
      duplicate.name = 'Name';
      root.append(unnamed, named, duplicate);
      const element = document.createElement('span');
      element.slot = 'Name';
      const unmatched = document.createElement('b');
      unmatched.slot = 'name';
      const text = document.createTextNode('text');
      const nested = element.appendChild(document.createElement('i'));
      host.append(element, text, document.createComment('ignored'), unmatched);
      const saved = named.assignedNodes();
      saved.length = 0;
      return [
        named.name, named.getAttribute('name'), element.getAttribute('slot'),
        named.assignedNodes()[0] === element, named.assignedNodes().length,
        unnamed.assignedNodes()[0] === text, unnamed.assignedElements().length,
        duplicate.assignedNodes().length, element.assignedSlot === named, text.assignedSlot === unnamed,
        nested.assignedSlot, unmatched.assignedSlot,
      ];
    })).toEqual(['Name', 'Name', 'Name', true, 1, true, 0, 0, true, true, null, null]);
  });

  it('reassigns synchronously for names, slot ordering, removal, and fragment replacement', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const first = document.createElement('slot');
      const second = document.createElement('slot');
      first.name = second.name = 'a';
      root.append(first, second);
      const child = document.createElement('span');
      child.slot = 'a';
      host.append(child);
      const result = [child.assignedSlot === first];
      root.insertBefore(second, first);
      result.push(child.assignedSlot === second, first.assignedNodes().length === 0);
      second.name = 'b';
      result.push(child.assignedSlot === first);
      child.slot = 'b';
      result.push(child.assignedSlot === second, first.assignedNodes().length === 0);
      second.remove();
      result.push(child.assignedSlot === null, second.assignedNodes().length === 0);
      const fragment = document.createDocumentFragment();
      fragment.append(second);
      root.replaceChildren(fragment);
      result.push(child.assignedSlot === second);
      host.replaceChildren('replacement');
      result.push(child.assignedSlot === null, second.assignedNodes().length === 0);
      second.removeAttribute('name');
      result.push(second.assignedNodes()[0] === host.firstChild);
      return result;
    })).toEqual(Array(12).fill(true));
  });

  it('ignores namespaced slot/name attributes and hides closed-root assignments', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'closed' });
      const slot = document.createElement('slot');
      slot.setAttributeNS('urn:test', 'name', 'ignored');
      root.append(slot);
      const child = document.createElement('span');
      child.setAttributeNS('urn:test', 'slot', 'ignored');
      const text = document.createTextNode('text');
      host.append(child, text);
      return [child.assignedSlot, text.assignedSlot, host.shadowRoot, slot.name, child.slot,
        slot.assignedNodes().length, slot.assignedElements()[0] === child];
    })).toEqual([null, null, null, '', '', 2, true]);
  });

  it('flattens fallback and nested shadow slots without flattening ordinary light-tree slots', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const outer = document.createElement('slot');
      outer.name = 'outer';
      const inner = document.createElement('slot');
      inner.name = 'inner';
      const fallback = document.createElement('b');
      const text = document.createTextNode('fallback');
      inner.append(fallback, text, document.createComment('ignored'));
      outer.append(inner);
      root.append(outer);
      const log = [outer.assignedNodes().length === 0,
        outer.assignedNodes({ flatten: true })[0] === fallback,
        outer.assignedNodes({ flatten: true })[1] === text,
        outer.assignedElements({ flatten: true }).length === 1];
      const child = document.createElement('i');
      child.slot = 'inner';
      host.append(child);
      log.push(outer.assignedNodes({ flatten: true })[0] === child);
      const lightSlot = document.createElement('slot');
      lightSlot.slot = 'outer';
      lightSlot.append(document.createElement('strong'));
      host.append(lightSlot);
      log.push(outer.assignedNodes({ flatten: true })[0] === lightSlot,
        lightSlot.assignedNodes({ flatten: true }).length === 0);
      return log;
    })).toEqual(Array(7).fill(true));
  });

  it('retains manual order, deduplicates arguments, and transfers assignments between slots', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const a = document.createElement('slot');
      const b = document.createElement('slot');
      root.append(a, b);
      const first = document.createElement('span');
      const second = document.createTextNode('second');
      host.append(first, second);
      const log = [a.assignedNodes().length === 0];
      a.assign(second, first, second);
      log.push(a.assignedNodes().length === 2, a.assignedNodes()[0] === second, a.assignedNodes()[1] === first);
      b.assign(first);
      log.push(a.assignedNodes().length === 1, b.assignedNodes()[0] === first, first.assignedSlot === b);
      a.assign();
      log.push(second.assignedSlot === null, a.assignedNodes().length === 0);
      try { b.assign(document.createComment('invalid') as unknown as Text); } catch { /* Conversion must be atomic. */ }
      log.push(b.assignedNodes()[0] === first);
      return log;
    })).toEqual(Array(10).fill(true));
  });

  it('refreshes a manual assignment when the assigned node enters or returns to the host', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const slot = document.createElement('slot');
      root.append(slot);
      const child = document.createElement('span');
      slot.assign(child);
      const before = slot.assignedNodes().length;
      host.append(child);
      const entered = slot.assignedNodes()[0] === child;
      child.remove();
      const removed = slot.assignedNodes().length;
      host.append(child);
      return [before, entered, removed, slot.assignedNodes()[0] === child];
    })).toEqual([0, true, 0, true]);
  });

  it('does not retain detached manually assigned elements or text after notification', async () => {
    const browser = new Browlet({ route: () => '' });
    const { document } = browser.window;
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
    const slot = document.createElement('slot') as PlatformSlotElement;
    root.append(slot);
    const detached = (() => {
      const element = document.createElement('span');
      const text = document.createTextNode('text');
      host.append(element, text);
      slot.assign(element, text);
      element.remove();
      text.remove();
      return [new WeakRef(element), new WeakRef(unwrap(element)), new WeakRef(text), new WeakRef(unwrap(text))];
    })();
    getRelevantRealm(browser.window).agent.eventLoop.performMicrotaskCheckpoint();
    expect(slot.assignedNodes()).toHaveLength(0);

    await collectGarbage(detached);
    expect(detached.every((reference) => reference.deref() === undefined)).toBe(true);
    // Keep the slot alive through collection, including its weak manual membership.
    expect(slot.assignedNodes()).toHaveLength(0);
  });

  it('does not retain a manual slot through detached elements or text after notification', async () => {
    const browser = new Browlet({ route: () => '' });
    const { document } = browser.window;
    const element = document.createElement('span');
    const text = document.createTextNode('text');
    const detached = (() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const slot = document.createElement('slot') as PlatformSlotElement;
      root.append(slot);
      host.append(element, text);
      slot.assign(element, text);
      element.remove();
      text.remove();
      return [new WeakRef(slot), new WeakRef(unwrap(slot))];
    })();
    getRelevantRealm(browser.window).agent.eventLoop.performMicrotaskCheckpoint();

    await collectGarbage(detached);
    expect(detached.every((reference) => reference.deref() === undefined)).toBe(true);
    // Keep both slottable kinds alive through collection of their former slot.
    expect(element.assignedSlot).toBeNull();
    expect(text.assignedSlot).toBeNull();
  });

  it('updates both trees when a different shadow root takes a manual assignment', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const firstHost = document.createElement('div');
      const secondHost = document.createElement('div');
      const firstRoot = firstHost.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const secondRoot = secondHost.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const firstSlot = firstRoot.appendChild(document.createElement('slot'));
      const secondSlot = secondRoot.appendChild(document.createElement('slot'));
      const child = firstHost.appendChild(document.createElement('span'));
      firstSlot.assign(child);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const events: string[] = [];
      let changes = 0;
      firstSlot.addEventListener('slotchange', () => { changes++; });
      firstSlot.addEventListener('test', () => events.push('obsolete-slot'));
      firstHost.addEventListener('test', () => events.push('host'));
      secondSlot.assign(child);
      child.dispatchEvent(new Event('test', { bubbles: true }));
      const released = [firstSlot.assignedNodes().length, secondSlot.assignedNodes().length, child.assignedSlot];
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      secondHost.append(child);
      return [released, firstSlot.assignedNodes().length, secondSlot.assignedNodes()[0] === child, events, changes];
    })).toEqual([[0, 0, null], 0, true, ['host'], 1]);
  });

  it('updates manual assignments through state-preserving moves between connected hosts', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const firstHost = document.createElement('div');
      const secondHost = document.createElement('div');
      document.body.append(firstHost, secondHost);
      const firstRoot = firstHost.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const secondRoot = secondHost.attachShadow({ mode: 'open', slotAssignment: 'manual' });
      const firstSlot = firstRoot.appendChild(document.createElement('slot'));
      const secondSlot = secondRoot.appendChild(document.createElement('slot'));
      const a = firstHost.appendChild(document.createElement('span'));
      const b = firstHost.appendChild(document.createTextNode('text'));
      firstSlot.assign(b, a);
      firstHost.moveBefore(b, a);
      const sameHost = [firstSlot.assignedNodes()[0] === b, firstSlot.assignedNodes()[1] === a];
      secondHost.moveBefore(a, null);
      const removed = [a.assignedSlot, firstSlot.assignedNodes().length];
      secondSlot.assign(a);
      firstHost.moveBefore(a, null);
      secondHost.moveBefore(a, null);
      return [sameHost, removed, secondSlot.assignedNodes()[0] === a, a.assignedSlot === secondSlot];
    })).toEqual([[true, true], [null, 1], true, true]);
  });

  it('stops event delivery through an old slot after reassignment or detachment', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(() => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const slot = document.createElement('slot');
      root.append(slot);
      const child = document.createElement('span');
      host.append(child);
      const log: string[] = [];
      slot.addEventListener('test', () => log.push('slot'));
      host.addEventListener('test', () => log.push('host'));
      child.dispatchEvent(new Event('test', { bubbles: true }));
      child.slot = 'missing';
      child.dispatchEvent(new Event('test', { bubbles: true }));
      child.remove();
      child.dispatchEvent(new Event('test', { bubbles: true }));
      return log;
    })).toEqual(['slot', 'host', 'host']);
  });

  it('delivers deduplicated trusted slot changes after mutation observers, including the root handler', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const slot = document.createElement('slot');
      root.append(slot);
      const log: (string | boolean[])[] = [];
      const observer = new MutationObserver(() => log.push('observer'));
      observer.observe(host, { childList: true });
      slot.addEventListener('slotchange', (event) => log.push([
        event.isTrusted, event.bubbles, event.composed, event.cancelable, event.target === slot,
      ]));
      root.onslotchange = function(event) { log.push(this === root && event.target === slot ? 'handler' : 'wrong'); };
      host.addEventListener('slotchange', () => log.push('escaped'));
      host.append('one', 'two');
      host.firstChild!.remove();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      root.onslotchange = null;
      observer.disconnect();
      return log;
    })).toEqual(['observer', [true, true, false, false, true], 'handler']);
  });

  it('signals fallback child changes but not text edits or unchanged effective names', async () => {
    const browser = new Browlet({ route: () => '' });
    expect(await browser.evaluate(async () => {
      const host = document.createElement('div');
      const root = host.attachShadow({ mode: 'open' });
      const slot = document.createElement('slot');
      root.append(slot);
      let count = 0;
      slot.addEventListener('slotchange', () => { count++; });
      const text = slot.appendChild(document.createTextNode('fallback'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const initial = count;
      text.data = 'changed';
      slot.name = '';
      slot.removeAttribute('name');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const unchanged = count;
      slot.append(document.createComment('counts as a child mutation'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      return [initial, unchanged, count];
    })).toEqual([1, 1, 2]);
  });
});
