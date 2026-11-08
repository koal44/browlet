import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

import { Browlet } from '../../src/browlet/browlet';
import type { BrowletEnvironment } from '../../src/browlet/environment/environment';
import { ClassicScript } from '../../src/browlet/scripting/script';
import { ScriptFetchOptions } from '../../src/browlet/scripting/script-fetch-options';
import { decode } from '../../src/encoding/index';
import {
  fetch, isFilteredResponse, isOkStatus, legacyExtractEncoding,
  type FetchController, type FetchRequest, type FetchResponse,
} from '../../src/fetch/index';
import { internalType, type InternalPromise } from '../../src/infra/index';
import type { URLRecord } from '../../src/url/index';
import { getRelevantRealm } from '../support/browlet-binding';

/**
 * Compare actual Fetch/body/parser work without network latency or per-chunk promise changes.
 * Run with the selected runtime and test/support/register-typescript.cjs.
 * Callback baseline is the classic loader at 4e034bcb; lower-promise candidates
 * stay here until measurements justify changing Fetch's production contract.
 */
async function main(): Promise<void> {
  const iterations = Number(process.argv[2] ?? 200);
  const rounds = Number(process.argv[3] ?? 7);
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://completion.test/');
  const env = getRelevantRealm(browser.window).env;
  const options = new ScriptFetchOptions();
  const url = env.parseURL('data:text/javascript,42')!;
  const loaders: Loader[] = [
    {
      name: 'callback', start: (done, failed) => {
        try { callbackLoader(url, options, env, done); } catch (error) { failed(error); }
      },
    },
    {
      name: 'loader-promise', start: (done, failed) => {
        promiseLoader(url, options, env).observe(done, failed);
      },
    },
    {
      name: 'body-promise-then', start: (done, failed) => {
        lowerPromiseLoader(url, options, env).observe(done, failed);
      },
    },
    {
      name: 'headers-body-script-chain', start: (done, failed) => {
        fullPromiseLoader(url, options, env).observe(done, failed);
      },
    },
    {
      name: 'body-promise-convert', start: (done, failed) => {
        const operation = fetchConvertedBody(makeRequest(url, options, env),
          (response, bodyBytes) => createScript(response, bodyBytes, url, options, env), env);
        operation.promise.observe(done, failed);
      },
    },
  ];

  for (const loader of loaders) await batch(loader, 50);
  const samples = new Map<string, number[]>(loaders.map((loader) => [loader.name, []]));
  for (let round = 0; round < rounds; ++round) {
    const elapsed = new Map(loaders.map((loader) => [loader.name, 0]));
    // Interleave individual requests: long-lived fixture costs drift over time,
    // so separate blocks can attribute that drift to the completion strategy.
    for (let iteration = 0; iteration < iterations; ++iteration) {
      for (let index = 0; index < loaders.length; ++index) {
        const loader = loaders[(index + iteration + round) % loaders.length]!;
        const started = performance.now();
        await batch(loader, 1);
        elapsed.set(loader.name, elapsed.get(loader.name)! + performance.now() - started);
      }
    }
    for (const loader of loaders) {
      samples.get(loader.name)!.push(elapsed.get(loader.name)! / iterations);
    }
  }

  const metrics = [];
  for (const loader of loaders) {
    // Allocation instrumentation is a separate pass; it does not affect timing samples.
    let nativePromises = 0;
    let promiseJobs = 0;
    const promiseIDs = new Set<number>();
    const hook = createHook({
      init(id, type) { if (type === 'PROMISE') { ++nativePromises; promiseIDs.add(id); } },
      before(id) { if (promiseIDs.has(id)) ++promiseJobs; },
    });
    hook.enable();
    await batch(loader, 50);
    hook.disable();
    const values = samples.get(loader.name)!;
    const sorted = [...values].sort((a, b) => a - b);
    metrics.push({
      name: loader.name,
      medianMilliseconds: sorted[Math.floor(sorted.length / 2)],
      minimumMilliseconds: sorted[0],
      maximumMilliseconds: sorted.at(-1),
      nativePromisesPerFetch: nativePromises / 50,
      promiseJobsPerFetch: promiseJobs / 50,
      samples: values,
    });
  }
  process.stdout.write(`${JSON.stringify({ node: process.version, runtime: process.env.NODE_RUNTIME, iterations, rounds, metrics }, null, 2)}\n`);
}

/** One completion consumer, identical for every candidate. */
type Loader = {
  name: string;
  start(done: (script: ClassicScript | null) => void, failed: (error: unknown) => void): void;
};

/** Run sequential requests so each measured operation includes its completion delivery. */
async function batch(loader: Loader, count: number): Promise<void> {
  for (let index = 0; index < count; ++index) {
    const script = await new Promise<ClassicScript | null>((resolve, reject) => loader.start(resolve, reject));
    assert.notEqual(script?.record, null);
    assert.equal(script?.parseError, null);
  }
}

/** The pre-change completion path, using the same Fetch and parser as the candidate. */
function callbackLoader(url: URLRecord, options: ScriptFetchOptions, env: BrowletEnvironment,
  complete: (script: ClassicScript | null) => void): void
{
  fetch(makeRequest(url, options, env), {
    processResponseConsumeBody: (response, bodyBytes) => complete(createScript(response, bodyBytes, url, options, env)),
  }, env);
}

/** Archived loader trial; kept here after restoring the production callback contract. */
function promiseLoader(url: URLRecord, options: ScriptFetchOptions, env: BrowletEnvironment): InternalPromise<ClassicScript | null> {
  return env.InternalPromise.try(() => {
    const request = makeRequest(url, options, env);
    const completion = env.InternalPromise.withResolvers(internalType<ClassicScript | null>());
    fetch(request, {
      processResponseConsumeBody: (response, bodyBytes) => {
        try { completion.resolve(createScript(response, bodyBytes, url, options, env)); }
        catch (error) { completion.reject(error); }
      },
    }, env);
    return completion.promise;
  }, internalType<ClassicScript | null>());
}

/** Candidate with a body-result promise owned by Fetch and a normal conversion chain. */
function lowerPromiseLoader(url: URLRecord, options: ScriptFetchOptions, env: BrowletEnvironment): InternalPromise<ClassicScript | null> {
  return env.InternalPromise.try(() => {
    const operation = fetchBody(makeRequest(url, options, env), env);
    return operation.promise.then(({ response, bodyBytes }) => createScript(response, bodyBytes, url, options, env),
      undefined, internalType<ClassicScript | null>());
  }, internalType<ClassicScript | null>());
}

/** Carry results through the independent response, body-read, and script-conversion stages. */
function fullPromiseLoader(url: URLRecord, options: ScriptFetchOptions, env: BrowletEnvironment): InternalPromise<ClassicScript | null> {
  const response = env.InternalPromise.withResolvers(internalType<FetchResponse>());
  fetch(makeRequest(url, options, env), { processResponse: response.resolve }, env);
  return response.promise.then((response) => {
    const body = (isFilteredResponse(response) ? response.internalResponse : response).body;
    const result = env.InternalPromise.withResolvers(internalType<Uint8Array | null | 'failure'>());
    if (body === null) result.resolve(null);
    else body.readAll(result.resolve, () => result.resolve('failure'), env.realm.globalObject);
    return result.promise.then((bytes) => createScript(response, bytes, url, options, env),
      undefined, internalType<ClassicScript | null>());
  }, undefined, internalType<ClassicScript | null>());
}

/** A complete response body; null and failure retain Fetch's existing distinctions. */
type ConsumedResponse = { response: FetchResponse; bodyBytes: Uint8Array | null | 'failure'; };

/** Proposed full-body operation, retaining immediate access to cancellation. */
function fetchBody(request: FetchRequest, env: BrowletEnvironment): { controller: FetchController; promise: InternalPromise<ConsumedResponse>; } {
  const result = env.InternalPromise.withResolvers(internalType<ConsumedResponse>());
  const controller = fetch(request, {
    processResponseConsumeBody: (response, bodyBytes) => result.resolve({ response, bodyBytes }),
  }, env);
  return { controller, promise: result.promise };
}

/** Convert at body completion before settling one result; avoids a second result promise. */
function fetchConvertedBody(request: FetchRequest,
  convert: (response: FetchResponse, bytes: Uint8Array | null | 'failure') => ClassicScript | null,
  env: BrowletEnvironment): { controller: FetchController; promise: InternalPromise<ClassicScript | null>; }
{
  const result = env.InternalPromise.withResolvers(internalType<ClassicScript | null>());
  const controller = fetch(request, {
    processResponseConsumeBody: (response, bodyBytes) => {
      try { result.resolve(convert(response, bodyBytes)); }
      catch (error) { result.reject(error); }
    },
  }, env);
  return { controller, promise: result.promise };
}

/** Shared request construction keeps the experimental candidates equivalent. */
function makeRequest(url: URLRecord, options: ScriptFetchOptions, env: BrowletEnvironment): FetchRequest {
  const request = env.userAgent.createPotentialCORSRequest(url, 'script', 'no-cors');
  request.client = env;
  request.initiatorType = 'script';
  options.setUpClassicRequest(request);
  return request;
}

/** Shared post-body conversion from the original classic-script loader. */
function createScript(response: FetchResponse, bodyBytes: Uint8Array | null | 'failure', url: URLRecord,
  options: ScriptFetchOptions, env: BrowletEnvironment): ClassicScript | null
{
  const mutedErrors = response.type === 'opaque' || response.type === 'opaqueredirect';
  if (isFilteredResponse(response)) response = response.internalResponse;
  if (bodyBytes === null || bodyBytes === 'failure' || !isOkStatus(response.status)) return null;
  const mimeType = response.headerList.extractMIMEType();
  const sourceText = decode(bodyBytes, legacyExtractEncoding(mimeType, 'UTF-8'));
  return new ClassicScript(sourceText, env, response.url!, options, mutedErrors, url);
}

void main().catch((error: unknown) => { process.stderr.write(`${String(error)}\n`); process.exitCode = 1; });
