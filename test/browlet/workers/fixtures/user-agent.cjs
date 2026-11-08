'use strict';
/* global __filename, process, queueMicrotask */

const { parentPort, workerData } = require('node:worker_threads');
process.env.TSX_DISABLE_CACHE = '1';
const { requireTypeScript } = require('../../../support/typescript.cjs');
const { WorkerUserAgent } = requireTypeScript('../../../../src/browlet/workers/user-agent.ts', __filename);
const { serializeURL } = requireTypeScript('../../../../src/url/index.ts', __filename);
const userAgent = new WorkerUserAgent(workerData);
const captures = [];

parentPort.on('message', async (message) => {
  try {
    switch (message.type) {
      case 'parse': {
        let checkpoint = false;
        queueMicrotask(() => { checkpoint = true; });
        const url = userAgent.parseURL(message.url, message.base === undefined ? null : userAgent.parseURL(message.base));
        if (url?.blobURLEntry !== null && url !== null) captures.push(url.blobURLEntry);
        const entry = url?.blobURLEntry ?? null;
        parentPort.postMessage({
          url: url === null ? null : serializeURL(url),
          entry: entry === null ? null : { id: userAgent.getBlobEntryId(entry), env: { origin: entry.env.origin } },
          checkpoint,
        });
        break;
      }
      case 'entry-dependencies': {
        const entry = userAgent.blobURLStore.resolve(userAgent.parseURL(message.url));
        const operations = [
          () => entry.obtainObject('top-level-navigation'),
          () => entry.isSamePartition(entry.env),
          () => entry.env.userAgent,
          () => entry.env.creationURL,
          () => entry.env.policyContainer,
        ];
        const errors = operations.map((operation) => {
          try { operation(); return null; } catch (error) { return error.message; }
        });
        parentPort.postMessage({ entry: { id: userAgent.getBlobEntryId(entry), env: { origin: entry.env.origin } }, errors });
        break;
      }
      case 'revoke': {
        let checkpoint = false;
        queueMicrotask(() => { checkpoint = true; });
        userAgent.revokeObjectURL(message.url);
        parentPort.postMessage({ checkpoint });
        break;
      }
      case 'close':
        userAgent.close();
        parentPort.postMessage({ closed: true });
        break;
      case 'preferences':
        parentPort.postMessage({
          userAgent: userAgent.defaultUserAgentValue, language: userAgent.defaultAcceptLanguage,
          offline: userAgent.assumeNoInternetConnectivity, storageEnabled: userAgent.storageEnabled,
          quota: userAgent.storageQuotaBytes, scriptingEnabled: userAgent.scriptingEnabled,
          trusted: userAgent.isURLPotentiallyTrustworthy(userAgent.parseURL(message.url)),
          hasLoadingNavigable: userAgent.hasLoadingNavigable(),
        });
        break;
      case 'forget': {
        const refs = captures.map((entry) => new WeakRef(entry));
        captures.length = 0;
        const { collectGarbage } = requireTypeScript('../../../support/garbage-collection.ts', __filename);
        await collectGarbage(refs);
        parentPort.postMessage({ collected: refs.every((ref) => ref.deref() === undefined) });
        break;
      }
      default:
        throw new Error('Unknown fixture operation');
    }
  } catch (error) {
    parentPort.postMessage({ error: error.message });
  }
});
parentPort.postMessage('ready');
