import { describe, expect, it } from 'vitest';

import { Browlet } from '../../../src/browlet/browlet';
import { createSandboxEnvironment } from '../../../src/browlet/bindings';
import type { DocumentImpl } from '../../../src/browlet/dom/nodes/document';
import { WorkerGlobalScopeImpl } from '../../../src/browlet/workers/worker-global-scope';
import { FetchResponse } from '../../../src/fetch/response';
import { BlobImpl } from '../../../src/file/blob';
import { parseURL } from '../../../src/url/url';
import { unwrap } from '../../support/browlet-binding';

describe('Worker policy-container initialization', () => {
  it.each(['about:blank', 'data:text/javascript,'])('clones the document owner for %s', (url) => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    document.policyContainer.referrerPolicy = 'no-referrer';
    const worker = new TestWorker(createSandboxEnvironment());
    worker.url = parseURL(url).url!;
    worker.ownerSet.add(document);
    worker.initializePolicyContainer(makeResponse('unsafe-url'), document.env);
    expect(worker.policyContainer).toEqual(document.policyContainer);
    expect(worker.policyContainer).not.toBe(document.policyContainer);
    worker.policyContainer.referrerPolicy = 'origin';
    expect(document.policyContainer.referrerPolicy).toBe('no-referrer');
  });

  it('inherits from a worker owner without consulting its unrelated construction environment', () => {
    const browser = new Browlet({ route: () => '' });
    const env = unwrap<DocumentImpl>(browser.document).env;
    const owner = new TestWorker(createSandboxEnvironment());
    owner.policyContainer.referrerPolicy = 'same-origin';
    const worker = new TestWorker(createSandboxEnvironment());
    worker.url = parseURL('data:text/javascript,').url!;
    worker.ownerSet.add(owner);
    worker.initializePolicyContainer(makeResponse('unsafe-url'), env);
    expect(worker.policyContainer).toEqual(owner.policyContainer);
    expect(worker.policyContainer).not.toBe(owner.policyContainer);
  });

  it('requires exactly one owner for local non-Blob workers', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    const worker = new TestWorker(createSandboxEnvironment());
    worker.url = parseURL('data:text/javascript,').url!;
    expect(() => worker.initializePolicyContainer(makeResponse(), document.env)).toThrow('exactly one owner');
    worker.ownerSet.add(document);
    worker.ownerSet.add(new TestWorker(createSandboxEnvironment()));
    expect(() => worker.initializePolicyContainer(makeResponse(), document.env)).toThrow('exactly one owner');
  });

  it('uses response policies for a non-local worker even when it has an owner', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    document.policyContainer.referrerPolicy = 'no-referrer';
    const worker = new TestWorker(createSandboxEnvironment());
    worker.ownerSet.add(document);
    worker.initializePolicyContainer(makeResponse('origin'), document.env);
    expect(worker.policyContainer.referrerPolicy).toBe('origin');
  });

  it('inherits Blob creator policies independently of the worker owner', () => {
    const browser = new Browlet({ route: () => '' });
    const document = unwrap<DocumentImpl>(browser.document);
    document.policyContainer.referrerPolicy = 'no-referrer';
    const { env } = document;
    const blobURL = env.userAgent.blobURLStore.add(new BlobImpl(['body'], {}, env), env);
    const owner = new TestWorker(createSandboxEnvironment());
    owner.policyContainer.referrerPolicy = 'unsafe-url';
    const worker = new TestWorker(createSandboxEnvironment());
    worker.url = env.parseURL(blobURL)!;
    worker.ownerSet.add(owner);
    const response = new FetchResponse();
    response.urlList.push(worker.url);
    worker.initializePolicyContainer(response, env);
    expect(worker.policyContainer.referrerPolicy).toBe('no-referrer');
    expect(worker.policyContainer).not.toBe(document.policyContainer);
  });
});

class TestWorker extends WorkerGlobalScopeImpl {
  url = parseURL('https://worker.test/main.js').url!;
}

function makeResponse(policy = 'origin'): FetchResponse {
  const response = new FetchResponse();
  response.urlList.push(parseURL('https://worker.test/main.js').url!);
  response.headerList.append('Referrer-Policy', policy);
  return response;
}
