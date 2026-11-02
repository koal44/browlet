import { afterEach, describe, expect, it, vi } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { SourceSnapshotParams } from '../../../src/browlet/browsing/navigation/state/index';
import { unwrap } from '../../support/browlet-binding';

afterEach(() => { vi.restoreAllMocks(); });

describe('navigation source snapshots', () => {
  it('creates independent unrestricted snapshots for a browser-UI source', () => {
    const first = new SourceSnapshotParams(null);
    const second = new SourceSnapshotParams(null);
    expect(first.hasTransientActivation).toBe(true);
    expect(first.sandboxingFlags.size).toBe(0);
    expect(first.allowsDownloading).toBe(true);
    expect(first.fetchClient).toBeNull();
    expect(first.sourcePolicyContainer).not.toBe(second.sourcePolicyContainer);
    expect(first.sandboxingFlags).not.toBe(second.sandboxingFlags);
  });

  it.each([false, true])('captures transient activation %s and independently clones source policies', (active) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const activation = vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(active);
    document.policyContainer.referrerPolicy = 'no-referrer';
    document.policyContainer.embedderPolicy.value = 'require-corp';
    const snapshot = new SourceSnapshotParams(document);
    document.policyContainer.referrerPolicy = 'origin';
    document.policyContainer.embedderPolicy.value = 'unsafe-none';
    activation.mockReturnValue(!active);
    expect(snapshot.hasTransientActivation).toBe(active);
    expect(snapshot.fetchClient).toBe(document.env);
    expect(snapshot.sandboxingFlags).toBe(document.activeSandboxingFlagSet);
    expect(snapshot.sourcePolicyContainer).not.toBe(document.policyContainer);
    expect(snapshot.sourcePolicyContainer.referrerPolicy).toBe('no-referrer');
    expect(snapshot.sourcePolicyContainer.embedderPolicy.value).toBe('require-corp');
  });

  it.each([false, true])('derives download permission from the sandboxed-downloads flag (%s)', (blocked) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    vi.spyOn(document.getRelevantGlobalObject()!, 'hasTransientActivation').mockReturnValue(false);
    document.activeSandboxingFlagSet.add('sandboxed-navigation');
    if (blocked) document.activeSandboxingFlagSet.add('sandboxed-downloads');
    expect(new SourceSnapshotParams(document).allowsDownloading).toBe(!blocked);
  });

  it('keeps the missing transient-activation producer explicit', () => {
    const browser = new Browlet({ route: () => '' });
    expect(() => new SourceSnapshotParams(unwrap<DocumentImpl>(browser.document)))
      .toThrow('Window transient activation is not implemented');
  });
});
