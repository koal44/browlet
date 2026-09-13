import { describe, expect, it } from 'vitest';
import { getRealmBindings, getRelevantRealm } from '../../../../src/browlet/bindings';
import { createNewTopLevelTraversable } from '../../../../src/browlet/browsing/navigable';
import { unsafeSharedCurrentTime } from '../../../../src/browlet/performance/high-resolution-time';
import { networkingTaskSource, queueGlobalTask } from '../../../../src/browlet/scripting/tasks';
import { UserAgent } from '../../../../src/browlet/user-agent';
import { createMicrotaskQueue } from '../../../../src/js-engine/index';

import {
  BrowletParser,
} from '../../../../src/browlet/html/parser/document-parser';
import {
  isHTMLLinkElement,
} from '../../../../src/browlet/html/elements/metadata/link';
import {
  isHTMLStyleElement,
} from '../../../../src/browlet/html/elements/metadata/style';

describe('BrowletParser', () => {
  it('resumes through HTML tasks when a stylesheet blocker is released', async () => {
    const { document, realm, runtime, drain } = createParserDocument();
    const blocker = document.createElement('style');
    document.addScriptBlockingStyleSheet(blocker);
    let scripts = 0;
    let complete = false;
    const errors: unknown[] = [];
    const parser = new BrowletParser(document, () => { scripts++; }, realm.agent.eventLoop, runtime);
    void parser.parse('<script></script><main id="after"></main>').then(
      () => { complete = true; },
      (error) => { errors.push(error); },
    );
    await inNodeTask(drain);
    expect(scripts).toBe(0);
    expect(document.getElementById('after')).toBeNull();

    queueGlobalTask(networkingTaskSource, realm.global, () => {
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
    const scripts: Element[] = [];
    const { document, realm, runtime, drain } = createParserDocument();
    const parser = new BrowletParser(
      document,
      (script) => {
        scripts.push(script);
      },
      realm.agent.eventLoop,
      runtime,
    );
    expect(parser.document).toBe(document);
    const first = parser.document.createElement('style');
    const second = parser.document.createElement('link');
    if (!isHTMLStyleElement(first) || !isHTMLLinkElement(second)) {
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

      queueGlobalTask(networkingTaskSource, realm.global, () => {
        document.removeScriptBlockingStyleSheet(first);
      });
      await inNodeTask(drain);

      expect(scripts).toHaveLength(0);
    } finally {
      queueGlobalTask(networkingTaskSource, realm.global, () => {
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
    const { document, realm, runtime, drain } = createParserDocument();
    const first = document.createElement('style');
    const second = document.createElement('style');
    document.addScriptBlockingStyleSheet(first);
    let scripts = 0;
    const errors: unknown[] = [];
    new BrowletParser(document, () => { scripts++; }, realm.agent.eventLoop, runtime)
      .parse('<script></script>').observe(() => {}, (error) => { errors.push(error); });
    await inNodeTask(drain);

    queueGlobalTask(networkingTaskSource, realm.global, () => {
      document.removeScriptBlockingStyleSheet(first);
      if (!laterTask) document.addScriptBlockingStyleSheet(second);
    });
    if (laterTask) {
      queueGlobalTask(networkingTaskSource, realm.global, () => {
        document.addScriptBlockingStyleSheet(second);
      });
    }
    await inNodeTask(drain);
    expect(scripts).toBe(0);

    queueGlobalTask(networkingTaskSource, realm.global, () => {
      document.removeScriptBlockingStyleSheet(second);
    });
    await inNodeTask(drain);
    await inNodeTask(drain);
    expect(scripts).toBe(1);
    expect(errors).toEqual([]);
  });

  it('checkpoints pending microtasks before running a parser script', async () => {
    const { document, realm, runtime, drain } = createParserDocument();
    const order: string[] = [];
    runtime.queueMicrotask(() => { order.push('microtask'); });
    new BrowletParser(document, () => { order.push('script'); }, realm.agent.eventLoop, runtime)
      .parse('<script></script>').observe(
        () => { order.push('complete'); },
        () => { order.push('error'); },
      );
    await inNodeTask(drain);
    await inNodeTask(drain);
    expect(order).toEqual(['microtask', 'script', 'complete']);
  });

  it.each([false, true])('waits for an internal script result (rejection: %s)', async (reject) => {
    const { document, realm, runtime, drain } = createParserDocument();
    const ready = runtime.promises.withResolvers<void>();
    const failure = new Error('script preparation failed');
    let complete = false;
    const errors: unknown[] = [];
    new BrowletParser(document, () => ready.promise, realm.agent.eventLoop, runtime)
      .parse('<script></script><main id="after"></main>').observe(
        () => { complete = true; },
        (error) => { errors.push(error); },
      );
    await inNodeTask(drain);
    expect(document.getElementById('after')).toBeNull();

    queueGlobalTask(networkingTaskSource, realm.global, () => {
      if (reject) ready.reject(failure);
      else ready.resolve(undefined);
    });
    await inNodeTask(drain);
    await inNodeTask(drain);
    expect(complete).toBe(!reject);
    expect(document.getElementById('after') !== null).toBe(!reject);
    expect(errors).toEqual(reject ? [failure] : []);
  });
});

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

function createParserDocument() {
  const traversable = createNewTopLevelTraversable(new UserAgent(), null, '');
  const document = traversable.activeDocument;
  if (document === null) throw new Error('Expected an active document');
  while (document.firstChild) document.firstChild.removeFromTree();
  const realm = getRelevantRealm(document);
  const runtime = getRealmBindings(realm).context.getRuntime();
  const options = {
    createMicrotaskQueue,
    requestEventLoopTurn: () => {},
    unsafeSharedCurrentTime,
  };
  return {
    document, realm, runtime,
    drain(this: void) {
      while (realm.agent.eventLoop.runTaskTurn(options)) { /* Run pending HTML tasks. */ }
    },
  };
}
