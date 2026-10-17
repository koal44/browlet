import { idlType } from '../../../../src/web-idl/core/index';
import { describe, expect, it } from 'vitest';
import type { InternalPromise } from '../../../../src/infra/promises';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { getBindingContext, getRelevantRealm } from '../../../support/browlet-binding';
import { createManualUserAgent } from '../../../support/browlet-agent';
import { TopLevelTraversable } from '../../../../src/browlet/browsing/navigation/navigable';
import { networkingTaskSource } from '../../../../src/browlet/scripting/tasks';
import { FetchBody } from '../../../../src/fetch/body';
import { FetchHeaders } from '../../../../src/fetch/headers';
import { FetchResponse } from '../../../../src/fetch/response';
import { ResourceReader } from '../../../../src/browlet/loader/resource-reader';
import { utf8Encode } from '../../../../src/encoding/codecs/utf-8';
import { ReadableStreamImpl } from '../../../../src/streams/index';

import {
  HTMLDocumentParser,
} from '../../../../src/browlet/html/parser/html-document-parser';
import { HTMLLinkElementImpl } from '../../../../src/browlet/dom/nodes/html/metadata/link';
import { HTMLStyleElementImpl } from '../../../../src/browlet/dom/nodes/html/metadata/style';
import type { ElementImpl } from '../../../../src/browlet/dom/nodes/element';

describe('HTMLDocumentParser', () => {
  it('resumes through HTML tasks when a stylesheet blocker is released', async () => {
    const { document, realm, drain } = createParserDocument();
    const blocker = document.createElement('style');
    document.addScriptBlockingStyleSheet(blocker);
    let scripts = 0;
    let complete = false;
    const errors: unknown[] = [];
    const parser = new HTMLDocumentParser(document, () => { scripts++; });
    void parser.parse('<script></script><main id="after"></main>').then(
      () => { complete = true; },
      (error) => { errors.push(error); },
    );
    await inNodeTask(drain);
    expect(scripts).toBe(0);
    expect(document.getElementById('after')).toBeNull();

    realm.queueGlobalTask(networkingTaskSource, () => {
      document.removeScriptBlockingStyleSheet(blocker);
    });
    try {
      await inNodeTask(() => {
        drain();
        expect(scripts).toBe(1);
        expect(document.getElementById('after')).not.toBeNull();
      });
    } finally {
      // Node completes the parser stream; HTML finishes the document.
      await inNodeTask(drain);
    }
    expect(complete).toBe(true);
    expect(errors).toEqual([]);
  });

  it('waits for script-blocking style sheets before executing a script', async () => {
    const scripts: ElementImpl[] = [];
    const { document, realm, drain } = createParserDocument();
    const parser = new HTMLDocumentParser(
      document,
      (script) => {
        scripts.push(script);
      },
    );
    expect(parser.document).toBe(document);
    const first = parser.document.createElement('style');
    const second = parser.document.createElement('link');
    if (!HTMLStyleElementImpl.is(first) || !HTMLLinkElementImpl.is(second)) {
      throw new Error('Expected stylesheet owner elements');
    }

    parser.document.addScriptBlockingStyleSheet(first);
    parser.document.addScriptBlockingStyleSheet(second);
    parser.document.addScriptBlockingStyleSheet(first);

    let complete = false;
    const errors: unknown[] = [];
    parser.parse('<script></script>').observe(
      () => { complete = true; },
      (error) => { errors.push(error); },
    );
    try {
      await inNodeTask(drain);

      expect(scripts).toHaveLength(0);

      realm.queueGlobalTask(networkingTaskSource, () => {
        document.removeScriptBlockingStyleSheet(first);
      });
      await inNodeTask(drain);

      expect(scripts).toHaveLength(0);
    } finally {
      realm.queueGlobalTask(networkingTaskSource, () => {
        document.removeScriptBlockingStyleSheet(first);
        document.removeScriptBlockingStyleSheet(second);
      });
      await inNodeTask(drain);
      await inNodeTask(drain);
    }
    expect(scripts).toHaveLength(1);
    expect(complete).toBe(true);
    expect(errors).toEqual([]);
  });

  it.each([false, true])('rechecks a new stylesheet blocker (later task: %s)', async (laterTask) => {
    const { document, realm, drain } = createParserDocument();
    const first = document.createElement('style');
    const second = document.createElement('style');
    document.addScriptBlockingStyleSheet(first);
    let scripts = 0;
    const errors: unknown[] = [];
    new HTMLDocumentParser(document, () => { scripts++; })
      .parse('<script></script>').observe(() => {}, (error) => { errors.push(error); });
    await inNodeTask(drain);

    realm.queueGlobalTask(networkingTaskSource, () => {
      document.removeScriptBlockingStyleSheet(first);
      if (!laterTask) document.addScriptBlockingStyleSheet(second);
    });
    if (laterTask) {
      realm.queueGlobalTask(networkingTaskSource, () => {
        document.addScriptBlockingStyleSheet(second);
      });
    }
    await inNodeTask(drain);
    expect(scripts).toBe(0);

    realm.queueGlobalTask(networkingTaskSource, () => {
      document.removeScriptBlockingStyleSheet(second);
    });
    await inNodeTask(drain);
    await inNodeTask(drain);
    expect(scripts).toBe(1);
    expect(errors).toEqual([]);
  });

  it('checkpoints pending microtasks before running a parser script', async () => {
    const { document, env, drain } = createParserDocument();
    const order: string[] = [];
    env.exec.queueMicrotask(() => { order.push('microtask'); });
    new HTMLDocumentParser(document, () => { order.push('script'); })
      .parse('<script></script>').observe(
        () => { order.push('complete'); },
        () => { order.push('error'); },
      );
    await inNodeTask(drain);
    await inNodeTask(drain);
    expect(order).toEqual(['microtask', 'script', 'complete']);
  });

  it.each([false, true])('waits for an internal script result (rejection: %s)', async (reject) => {
    const { document, realm, env, drain } = createParserDocument();
    const ready = env.exec.Promise.withResolvers(idlType.undefined);
    const failure = new Error('script preparation failed');
    let complete = false;
    const errors: unknown[] = [];
    new HTMLDocumentParser(document, () => ready.promise)
      .parse('<script></script><main id="after"></main>').observe(
        () => { complete = true; },
        (error) => { errors.push(error); },
      );
    await inNodeTask(drain);
    expect(document.getElementById('after')).toBeNull();

    realm.queueGlobalTask(networkingTaskSource, () => {
      if (reject) ready.reject(failure);
      else ready.resolve(undefined);
    });
    await inNodeTask(drain);
    await inNodeTask(drain);
    expect(complete).toBe(!reject);
    expect(document.getElementById('after') !== null).toBe(!reject);
    expect(errors).toEqual(reject ? [failure] : []);
  });

  it('does not resume readiness changes when aborted after EOF queues completion', async () => {
    const { document, realm, drain } = createParserDocument(createManualUserAgent());
    drain();
    document.currentDocumentReadiness = 'loading';
    const parser = new HTMLDocumentParser(document, () => {});
    const readiness: string[] = [];
    document.addEventListener('readystatechange', () => { readiness.push(document.readyState); });
    let complete = false;
    const errors: unknown[] = [];
    parser.parse('<p id="parsed">done</p>')
      .observe(() => { complete = true; }, (error) => { errors.push(error); });

    await inNodeTask(() => { realm.agent.eventLoop.runTaskTurn(); });
    await expect.poll(() => realm.agent.eventLoop.hasRunnableTasks()).toBe(true);
    expect(document.getElementById('parsed')).not.toBeNull();
    expect(document.readyState).toBe('loading');
    parser.abort();
    await inNodeTask(drain);

    expect(readiness).toEqual(['interactive', 'complete']);
    expect(document.readyState).toBe('complete');
    expect(complete).toBe(false);
    expect(errors).toMatchObject([{ name: 'AbortError' }]);
  });
});

describe('HTMLDocumentParser response bytes', () => {
  it('parses before EOF and retains split BOM and character bytes across input chunks', async () => {
    const { document, realm, env, drain } = createParserDocument();
    const stream = ReadableStreamImpl.createDefault(undefined, undefined, 0, () => 1, env);
    const headers = new FetchHeaders();
    headers.append('Content-Type', 'text/html; charset=windows-1252');
    stream.enqueueChunk(Uint8Array.of(0xef));
    stream.enqueueChunk(Uint8Array.of(0xbb));
    stream.enqueueChunk(Uint8Array.from([0xbf, ...utf8Encode('<p id="first"></p><p id="last">caf'), 0xc3]));
    const parser = new HTMLDocumentParser(document, () => {});
    let firstInputs = 0;
    let complete = false;
    const errors: unknown[] = [];
    const response = new FetchResponse();
    response.body = new FetchBody(stream, env);
    response.headerList = headers;
    const resource = new ResourceReader(response, env.userAgent);
    await observe(resource.determineMIMEType());
    parser.parseBytes(resource, () => {
      expect(realm.agent.eventLoop.currentlyRunningTask).not.toBeNull();
      expect(document.getElementById('first')).not.toBeNull();
      firstInputs++;
    }).observe(() => { complete = true; }, (error) => { errors.push(error); });
    await expect.poll(async () => { await inNodeTask(drain); return firstInputs; }).toBe(1);
    expect(complete).toBe(false);
    expect(document.encoding).toBe('UTF-8');

    realm.queueGlobalTask(networkingTaskSource, () => {
      stream.enqueueChunk(Uint8Array.from([0xa9, ...utf8Encode('</p>')]));
      stream.close();
    });
    await expect.poll(async () => { await inNodeTask(drain); return complete; }).toBe(true);
    const text = document.getElementById('last')?.firstChild;
    expect(text?.isText() ? text.data : undefined).toBe('café');
    expect(firstInputs).toBe(1);
    expect(errors).toEqual([]);
    expect(stream.locked).toBe(false);
  });

  it('cancels response input when aborted before the first parser task', async () => {
    const { document, env, drain } = createParserDocument();
    let canceled = 0;
    const stream = ReadableStreamImpl.createDefault(undefined, () => { canceled++; }, 0, () => 1, env);
    const parser = new HTMLDocumentParser(document, () => {});
    const errors: unknown[] = [];
    const response = new FetchResponse();
    response.body = new FetchBody(stream, env);
    response.headerList.append('Content-Type', 'text/html');
    const resource = new ResourceReader(response, env.userAgent);
    await observe(resource.determineMIMEType());
    parser.parseBytes(resource, () => {})
      .observe(() => {}, (error) => { errors.push(error); });
    parser.abort();
    await expect.poll(async () => { await inNodeTask(drain); return errors.length; }).toBe(1);
    expect(canceled).toBe(1);
    expect(stream.locked).toBe(false);
    expect(document.readyState).toBe('complete');
  });

  it.each(['input', 'script'])('cancels its response reader and stops parsing while waiting for %s', async (waiting) => {
    const { document, realm, env, drain } = createParserDocument();
    const ready = env.exec.Promise.withResolvers(idlType.undefined);
    let canceled = 0;
    const stream = ReadableStreamImpl.createDefault(undefined, () => { canceled++; }, 0, () => 1, env);
    stream.enqueueChunk(utf8Encode(waiting === 'script'
      ? '<script></script><main id="after"></main>' : '<p></p>'));
    const parser = new HTMLDocumentParser(document, () => ready.promise);
    document.currentDocumentReadiness = 'loading';
    const readiness: string[] = [];
    document.addEventListener('readystatechange', () => { readiness.push(document.readyState); });
    let firstInput = false;
    let complete = false;
    const errors: unknown[] = [];
    const response = new FetchResponse();
    response.body = new FetchBody(stream, env);
    response.headerList.append('Content-Type', 'text/html');
    const resource = new ResourceReader(response, env.userAgent);
    await observe(resource.determineMIMEType());
    parser.parseBytes(resource, () => { firstInput = true; })
      .observe(() => { complete = true; }, (error) => { errors.push(error); });
    await expect.poll(async () => { await inNodeTask(drain); return firstInput; }).toBe(true);

    realm.queueGlobalTask(networkingTaskSource, () => {
      document.abort();
      ready.resolve(undefined);
    });
    await expect.poll(async () => { await inNodeTask(drain); return errors.length; }).toBe(1);
    expect(canceled).toBe(1);
    expect(stream.locked).toBe(false);
    expect(complete).toBe(false);
    expect(document.activeParser).toBeNull();
    expect(document.parser).toBeNull();
    expect(readiness).toEqual(['interactive', 'complete']);
    expect(document.readyState).toBe('complete');
    expect(document.getElementById('after')).toBeNull();
  });
});

function observe<T>(promise: InternalPromise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => { promise.observe(resolve, reject); });
}

function inNodeTask(steps: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try { steps(); resolve(); }
      catch (error) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Preserve the original assertion failure from the controlled host task.
        reject(error);
      }
    });
  });
}

function createParserDocument(userAgent = new UserAgent()) {
  const traversable = TopLevelTraversable.create(userAgent, null, '');
  const document = traversable.activeDocument;
  if (document === null) throw new Error('Expected an active document');
  while (document.firstChild) document.removeChild(document.firstChild);
  const realm = getRelevantRealm(document);
  const env = getBindingContext(realm).getEnvironment();
  return {
    document, realm, env,
    drain(this: void) {
      while (realm.agent.eventLoop.runTaskTurn()) { /* Run pending HTML tasks. */ }
    },
  };
}
