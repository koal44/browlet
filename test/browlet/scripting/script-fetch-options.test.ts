import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { ScriptFetchOptions } from '../../../src/browlet/scripting/script-fetch-options';
import { FetchRequest } from '../../../src/fetch/request';
import { getRelevantRealm } from '../../support/browlet-binding';

describe('HTML script fetch options', () => {
  it('initializes the default script fetch options', () => {
    expect(new ScriptFetchOptions()).toEqual({
      cryptographicNonce: '', integrityMetadata: '', parserMetadata: 'not-parser-inserted',
      credentialsMode: 'same-origin', referrerPolicy: '', renderBlocking: false, fetchPriority: 'auto',
    });
  });

  it('preserves classic CORS credentials but applies module credentials', () => {
    const env = createEnvironment();
    const options = populatedOptions();
    const request = new FetchRequest(env.parseURL('https://scripts.test/script.js')!, env);
    request.credentialsMode = 'include';

    options.setUpClassicRequest(request);

    expect(request).toMatchObject({
      cryptographicNonceMetadata: 'nonce', integrityMetadata: 'sha256-parent', parserInserted: true,
      credentialsMode: 'include', referrerPolicy: 'no-referrer', renderBlocking: true, priority: 'high',
    });

    options.setUpModuleRequest(request);
    expect(request.credentialsMode).toBe('omit');
    new ScriptFetchOptions().setUpClassicRequest(request);
    expect(request).toMatchObject({
      cryptographicNonceMetadata: '', integrityMetadata: '', parserInserted: false,
      credentialsMode: 'omit', referrerPolicy: '', renderBlocking: false, priority: 'auto',
    });
  });

  it('copies inherited options while selecting descendant integrity and resetting priority', () => {
    const env = createEnvironment();
    const url = env.parseURL('https://scripts.test/child.js')!;
    env.globalImplementation.importMap.integrity.set(url, 'sha256-child');
    const parent = populatedOptions();
    const descendant = parent.getDescendantOptions(url, env);

    expect(descendant).toBeInstanceOf(ScriptFetchOptions);
    expect(descendant).not.toBe(parent);
    expect(descendant).toEqual({ ...parent, integrityMetadata: 'sha256-child', fetchPriority: 'auto' });
    expect(parent.integrityMetadata).toBe('sha256-parent');
    expect(parent.fetchPriority).toBe('high');
    expect(parent.getDescendantOptions(env.parseURL('https://scripts.test/other.js')!, env).integrityMetadata).toBe('');
  });

  it('matches integrity keys by URL value within the selected global', () => {
    const env = createEnvironment();
    const key = env.parseURL('https://scripts.test:443/a/../child.js')!;
    const equalURL = env.parseURL('https://scripts.test/child.js')!;
    env.globalImplementation.importMap.integrity.set(key, 'sha384-child');

    expect(equalURL).not.toBe(key);
    expect(env.resolveModuleIntegrityMetadata(equalURL)).toBe('sha384-child');
    expect(env.resolveModuleIntegrityMetadata(env.parseURL('https://scripts.test/child.js#other')!)).toBe('');
    expect(createEnvironment().resolveModuleIntegrityMetadata(equalURL)).toBe('');
  });
});

function createEnvironment() {
  const browser = new Browlet({ route: () => '', reporting: false });
  return getRelevantRealm(browser.window).env;
}

function populatedOptions() {
  const options = new ScriptFetchOptions();
  options.cryptographicNonce = 'nonce';
  options.integrityMetadata = 'sha256-parent';
  options.parserMetadata = 'parser-inserted';
  options.credentialsMode = 'omit';
  options.referrerPolicy = 'no-referrer';
  options.renderBlocking = true;
  options.fetchPriority = 'high';
  return options;
}
