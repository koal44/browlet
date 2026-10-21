import { createServer, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { getRelevantRealm } from '../../support/browlet-binding';
import { closeServer, listen } from '../loader/http-fixture';

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

describe('ProcessingInstruction LinkStyle lifecycle', () => {
  it('projects the associated sheet and clears both sides when data becomes invalid', async () => {
    const { browser } = await fixture();
    await browser.evaluate(() => {
      const pi = document.createProcessingInstruction('xml-stylesheet', 'href="/one.css" title="theme" media="SCREEN"');
      document.insertBefore(pi, document.documentElement);
    });
    await expect.poll(() => browser.document.styleSheets.length).toBe(1);
    expect(await browser.evaluate(() => {
      const pi = document.firstChild!.nextSibling as ProcessingInstruction;
      const sheet = pi.sheet!;
      const before = [sheet instanceof CSSStyleSheet, sheet.ownerNode === pi, sheet === document.styleSheets[0], sheet.title, sheet.media.mediaText];
      pi.appendData(' malformed');
      return { before, after: [pi.sheet, sheet.ownerNode, document.styleSheets.length] };
    })).toEqual({ before: [true, true, true, 'theme', 'screen'], after: [null, null, 0] });
  });

  it('rejects malformed, unsupported, and untitled alternate instructions without fetching', async () => {
    const { browser, requests } = await fixture();
    const malformed = browser.document.createProcessingInstruction('xml-stylesheet', 'href="/malformed-dom-name.css"');
    malformed.setAttribute('1invalid-xml-name', '');
    browser.document.insertBefore(malformed, browser.document.documentElement);
    await browser.evaluate(() => {
      for (const [target, data] of [
        ['XML-stylesheet', 'href="/target.css"'],
        ['xml-stylesheet', 'title="missing href"'],
        ['xml-stylesheet', 'href="/duplicate.css" href="/other.css"'],
        ['xml-stylesheet', 'href="/invalid.css" invalid'],
        ['xml-stylesheet', 'href="/xsl.css" type="text/xsl"'],
        ['xml-stylesheet', 'href="/alternate.css" alternate="yes"'],
      ]) document.insertBefore(document.createProcessingInstruction(target!, data!), document.documentElement);
      const after = document.createProcessingInstruction('xml-stylesheet', 'href="/after.css"');
      document.appendChild(after);
      const good = document.createProcessingInstruction('xml-stylesheet', 'href="/good.css" alternate="YES" type="TEXT/CSS; charset=utf-8"');
      document.insertBefore(good, document.documentElement);
    });
    await expect.poll(() => browser.document.styleSheets.length).toBe(1);
    expect(requests).toEqual(['/good.css']);
  });

  it('updates prolog membership when the root moves across an instruction', async () => {
    const { browser } = await fixture();
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const root = document.documentElement!;
    const pi = document.createProcessingInstruction('xml-stylesheet', 'href="/one.css"');
    document.appendChild(pi);
    expect(pi.sheet).toBeNull();
    root.removeNode();
    document.appendChild(root);
    await expect.poll(() => pi.sheet).not.toBeNull();
    const oldSheet = pi.sheet!;
    root.removeNode();
    document.insertBefore(root, pi);
    expect(pi.sheet).toBeNull();
    expect(oldSheet.ownerNode).toBeNull();
    expect(document.styleSheets.length).toBe(0);
  });

  it('tracks associations when an instruction moves without being removed', async () => {
    const { browser } = await fixture();
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const first = document.createProcessingInstruction('xml-stylesheet', 'href="/one.css"');
    const second = document.createProcessingInstruction('xml-stylesheet', 'href="/two.css"');
    document.insertBefore(first, document.documentElement);
    document.insertBefore(second, document.documentElement);
    await expect.poll(() => document.styleSheets.length).toBe(2);
    const sheet = second.sheet;
    document.moveBefore(second, first);
    expect(second.sheet).toBe(sheet);
    expect([...document.styleSheets].map((style) => style.ownerNode)).toEqual([second, first]);
    document.documentElement!.moveBefore(second, null);
    expect(second.sheet).toBeNull();
    expect(sheet!.ownerNode).toBeNull();
    expect([...document.styleSheets].map((style) => style.ownerNode)).toEqual([first]);
  });

  it.each(['change', 'remove', 'adopt', 'move out of prolog'] as const)('cancels an unfinished fetch on %s', async (action) => {
    let slow: ServerResponse | undefined;
    let closed = false;
    const { browser } = await fixture((request, response) => {
      if (request === '/slow.css') {
        slow = response;
        response.once('close', () => { closed = true; });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }');
    });
    cleanup.push(() => { slow?.destroy(); });
    const document = getRelevantRealm(browser.window).env.realm.getAssociatedDocument();
    const pi = document.createProcessingInstruction('xml-stylesheet', 'href="/slow.css"');
    document.insertBefore(pi, document.documentElement);
    await expect.poll(() => slow !== undefined).toBe(true);
    expect(pi.sheet).toBeNull();
    if (action === 'change') pi.setAttribute('href', '/new.css');
    else if (action === 'remove') pi.remove();
    else if (action === 'move out of prolog') document.documentElement!.moveBefore(pi, null);
    else document.implementation.createDocument(null, 'root', null).adoptNode(pi);
    await expect.poll(() => closed).toBe(true);
    if (action === 'change') {
      await expect.poll(() => pi.sheet?.href?.endsWith('/new.css')).toBe(true);
      expect(document.styleSheets.length).toBe(1);
    } else {
      expect(pi.sheet).toBeNull();
      expect(document.styleSheets.length).toBe(0);
    }
  });
});

/** Supply an active document and a real CSS response, retaining requests for negative assertions. */
async function fixture(respond?: (request: string, response: ServerResponse) => void) {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    if (respond) respond(request.url!, response);
    else response.writeHead(200, { 'Content-Type': 'text/css' }).end('p { opacity: .5 }');
  });
  const origin = await listen(server);
  cleanup.push(() => closeServer(server));
  const browser = new Browlet({ route: () => '<!doctype html><html><head></head><body><p>test</p></body></html>' });
  await browser.navigate(`${origin}/page`);
  cleanup.push(() => getRelevantRealm(browser.window).env.userAgent.httpTransport.close());
  return { browser, requests };
}
