import { assert, describe, expect, it } from 'vitest';

import { parseURL } from '../../../src/url/index';
import { Browlet } from '../../../src/browlet/browlet';
import { MessagePortImpl } from '../../../src/browlet/communication/index';
import { createWorkerEnvironment } from '../../../src/browlet/integration/web-idl/index';
import {
  ClassicScript, DedicatedWorkerAgent, SharedWorkerAgent, ScriptFetchOptions,
  type EventLoop,
} from '../../../src/browlet/scripting/index';
import { DedicatedWorkerGlobalImpl, type WorkerType } from '../../../src/browlet/workers/index';
import type { MessageEvent, MessagePort } from '../../../src/browlet/platform';
import { getRelevantRealm } from '../../support/browlet-binding';
import { runInHostTask } from '../../support/tasks';

// Fetch failures and script loading are covered through WorkerThreadRuntime in thread.test.ts.
describe('Worker initial script port activation (HTML §10.2.4)', () => {
  it('reuses the dedicated inside port and entangles it before running the initial script', async () => {
    const { env, outsideEnv, outsidePort, outside } = await createStartup();
    await runInHostTask(() => {
      const global = env.globalImplementation;
      assert(global instanceof DedicatedWorkerGlobalImpl);
      const originalInsidePort = global.insidePort;
      const messages: unknown[] = [];
      outside.addEventListener('message', (event) => { messages.push((event as MessageEvent).data); });
      const script = new ClassicScript(`
        onmessage = event => postMessage(event.data);
        postMessage('initial');
      `, env, env.apiBaseURL, new ScriptFetchOptions());
      env.queueTask('network', {
        run: () => {
          const insidePort = global.connectPort(outsidePort);
          global.runScript(script, insidePort, () => { outsidePort.start(); });
        },
      });
      env.responsibleEventLoop.runTaskTurn();
      expect(global.insidePort).toBe(originalInsidePort);
      expect(global.ports).toEqual([originalInsidePort]);
      expect(env.executionReady).toBe(true);
      expect(env.discarded).toBe(false);
      drain(outsideEnv.responsibleEventLoop);
      expect(messages).toEqual(['initial']);
      outside.postMessage('echo');
      drain(env.responsibleEventLoop);
      drain(outsideEnv.responsibleEventLoop);
      expect(messages).toEqual(['initial', 'echo']);
    });
  });

  it('creates a shared connection port and delivers it after the initial script', async () => {
    const { env, outsideEnv, outsidePort, outside } = await createStartup(true);
    await runInHostTask(() => {
      const messages: unknown[] = [];
      outside.addEventListener('message', (event) => { messages.push((event as MessageEvent).data); });
      expect(env.globalImplementation.ports).toEqual([]);
      const script = new ClassicScript(`
        onconnect = event => {
          const port = event.ports[0];
          port.onmessage = message => port.postMessage(message.data);
          port.postMessage('connected');
        };
      `, env, env.apiBaseURL, new ScriptFetchOptions());
      env.queueTask('network', {
        run: () => {
          const global = env.globalImplementation;
          const insidePort = global.connectPort(outsidePort);
          global.runScript(script, insidePort, () => { outsidePort.start(); });
        },
      });
      env.responsibleEventLoop.runTaskTurn();
      expect(env.globalImplementation.ports).toHaveLength(1);
      expect(messages).toEqual([]);
      outside.postMessage('waiting for connect');
      drain(env.responsibleEventLoop);
      drain(outsideEnv.responsibleEventLoop);
      expect(messages).toEqual(['connected', 'waiting for connect']);
    });
  });
});

/** Compose local agents to inspect port activation; isolate startup uses the production runtime tests. */
async function createStartup(shared = false, type: WorkerType = 'classic') {
  const browser = new Browlet({ route: () => '', reporting: false });
  await browser.navigate('https://worker.test/page');
  const outsideEnv = getRelevantRealm(browser.window).env;
  const agent = outsideEnv.userAgent.obtainDedicatedOrSharedWorkerAgent(outsideEnv, shared);
  assert(agent instanceof DedicatedWorkerAgent || agent instanceof SharedWorkerAgent);
  const env = createWorkerEnvironment({
    agent, outsideEnv, url: parseURL('https://worker.test/worker.js').url!, unsafeWorkerCreationTime: 1234,
    type, name: 'completion test', credentials: 'same-origin', extendedLifetime: false,
  });
  const outsidePort = new MessagePortImpl(outsideEnv);
  const outside = outsideEnv.project(outsidePort) as MessagePort;
  return { browser, env, outsideEnv, outsidePort, outside };
}

function drain(loop: EventLoop): void {
  while (loop.runTaskTurn()) { /* Drain runnable messages and completion tasks. */ }
}
