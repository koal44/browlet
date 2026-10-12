import { describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { BlobImpl } from '../../../src/file/index';
import { parseURL, serializeURL } from '../../../src/url/index';
import { getRelevantRealm } from '../../support/browlet-binding';
import { createTestDocument } from '../../support/dom';

describe.each(['Document', 'Window settings'] as const)('HTML URL parsing against %s', (kind) => {
  function createOwner() {
    const fixture = createWindowDocument();
    return { ...fixture, owner: kind === 'Document' ? fixture.document : fixture.env };
  }

  it('resolves against the current base rather than the document or creation URL', () => {
    const { document, owner } = createOwner();
    expect(serializeURL(owner.parseHTMLURL('target')!)).toBe('https://example.test/dir/target');

    const base = document.createElement('base');
    base.setAttribute('href', 'https://assets.test/first/');
    document.documentElement!.appendChild(base);
    expect(serializeURL(owner.parseHTMLURL('target')!)).toBe('https://assets.test/first/target');

    base.setAttribute('href', '/second/');
    expect(serializeURL(owner.parseHTMLURL('target')!)).toBe('https://example.test/second/target');
  });

  it('uses UTF-8 for ordinary parsing and the document encoding for legacy query parsing', () => {
    const { document, owner } = createOwner();
    document.encoding = 'windows-1252';
    const input = 'café?q=é#é';
    expect(serializeURL(owner.parseHTMLURL(input)!))
      .toBe('https://example.test/dir/caf%C3%A9?q=%C3%A9#%C3%A9');
    expect(serializeURL(owner.encodingParseURL(input)!))
      .toBe('https://example.test/dir/caf%C3%A9?q=%E9#%C3%A9');
    expect(owner.encodingParseAndSerializeURL(input))
      .toBe('https://example.test/dir/caf%C3%A9?q=%E9#%C3%A9');

    document.encoding = 'UTF-8';
    expect(owner.encodingParseAndSerializeURL(input))
      .toBe('https://example.test/dir/caf%C3%A9?q=%C3%A9#%C3%A9');
  });

  it('returns null for parsing failure in all three operations', () => {
    const { owner } = createOwner();
    expect(owner.parseHTMLURL('https://[')).toBeNull();
    expect(owner.encodingParseURL('https://[')).toBeNull();
    expect(owner.encodingParseAndSerializeURL('https://[')).toBeNull();
  });

  it('preserves URL parser recovery instead of requiring valid authoring syntax', () => {
    const { owner } = createOwner();
    expect(serializeURL(owner.parseHTMLURL(' \t../a b\n')!)).toBe('https://example.test/a%20b');
    expect(owner.encodingParseAndSerializeURL(' \t../a b\n')).toBe('https://example.test/a%20b');
  });

  it('uses the inherited base for an iframe srcdoc document', () => {
    const { document, owner } = createOwner();
    document.url = parseURL('about:srcdoc').url!;
    document.isIframeSrcdocDocument = true;
    document.aboutBaseURL = parseURL('https://parent.test/inherited/').url!;
    expect(serializeURL(owner.parseHTMLURL('target')!)).toBe('https://parent.test/inherited/target');
    expect(owner.encodingParseAndSerializeURL('target')).toBe('https://parent.test/inherited/target');
  });

  it('retains the owning user agent\'s Blob URL registration', () => {
    const { env, owner } = createOwner();
    const blob = new BlobImpl([], {}, env);
    const url = env.userAgent.blobURLStore.add(blob, env);
    const entry = env.parseURL(url).url!.blobURLEntry;
    expect(entry).not.toBeNull();
    expect(owner.parseHTMLURL(`${url}#part`)!.blobURLEntry).toBe(entry);
    expect(owner.encodingParseURL(url)!.blobURLEntry).toBe(entry);
    expect(owner.encodingParseAndSerializeURL(url)).toBe(url);
  });
});

describe('HTML URL parsing ownership', () => {
  it('uses a detached Document\'s own base and encoding independently of its Window', () => {
    const { env } = createWindowDocument();
    const detached = createTestDocument(env);
    detached.url = parseURL('https://detached.test/').url!;
    detached.encoding = 'windows-1252';
    expect(serializeURL(detached.parseHTMLURL('?q=é')!)).toBe('https://detached.test/?q=%C3%A9');
    expect(detached.encodingParseAndSerializeURL('?q=é')).toBe('https://detached.test/?q=%E9');
    expect(env.encodingParseAndSerializeURL('?q=é')).toBe('https://example.test/dir/page?q=%C3%A9');
  });

  it('follows a Window\'s replacement Document without changing the old Document\'s parsing', () => {
    const { document, env } = createWindowDocument();
    const replacement = createTestDocument(env);
    replacement.url = parseURL('https://replacement.test/').url!;
    replacement.encoding = 'windows-1252';
    env.window.setAssociatedDocument(replacement);

    expect(serializeURL(env.parseHTMLURL('?q=é')!)).toBe('https://replacement.test/?q=%C3%A9');
    expect(env.encodingParseAndSerializeURL('?q=é')).toBe('https://replacement.test/?q=%E9');
    expect(document.encodingParseAndSerializeURL('?q=é')).toBe('https://example.test/dir/page?q=%C3%A9');
  });

  it('uses UTF-8 in a non-Window realm', () => {
    const { env: windowEnv } = createWindowDocument();
    const env = windowEnv.userAgent.sandbox;
    // Workers are not implemented. Supply only the API base to this real non-Window realm.
    const base = vi.spyOn(env, 'apiBaseURL', 'get')
      .mockReturnValue(parseURL('https://worker.test/').url!);
    try {
      expect(env.realm.getAssociatedDocument()).toBeNull();
      expect(serializeURL(env.parseHTMLURL('?q=é')!)).toBe('https://worker.test/?q=%C3%A9');
      expect(env.encodingParseAndSerializeURL('?q=é')).toBe('https://worker.test/?q=%C3%A9');
    } finally {
      base.mockRestore();
    }
  });

  it('keeps explicit-base parsing separate, including parsing without a base', () => {
    const { env } = createWindowDocument();
    expect(env.parseURL('target').url).toBeNull();
    const base = parseURL('https://explicit.test/').url!;
    expect(serializeURL(env.parseURL('target?q=é', base, 'windows-1252').url!))
      .toBe('https://explicit.test/target?q=%E9');
  });
});

function createWindowDocument() {
  const browlet = new Browlet({ route: () => '' });
  const env = getRelevantRealm(browlet.window).env;
  const document = env.window.getAssociatedDocument();
  document.url = parseURL('https://example.test/dir/page').url!;
  return { document, env };
}
