'use strict';
/* global __filename, process */

const { pathToFileURL } = require('node:url');
const { threadId } = require('node:worker_threads');

// Abrupt native termination must not interrupt tsx disk-cache writes.
process.env.TSX_DISABLE_CACHE = '1';
const { requireTypeScript } = require('../../support/typescript.cjs');
const { JSMessagePort, JSThread, JSThreadEndpoint } = requireTypeScript('../../../src/js-engine/index.ts', __filename);

JSThread.initialize(pathToFileURL(__filename).href, () => {
  const endpoint = new JSThreadEndpoint();
  let port = null;
  let stopListening = null;

  function adopt(handle) {
    port = new JSMessagePort(handle);
    stopListening = port.listen({
      onMessage(message) {
        if (endpoint.data.role === 'relay') {
          endpoint.send({ type: 'received', message }, transfers(message));
        } else {
          port.send({ ...message, threadId }, transfers(message));
        }
      },
      onClose() { endpoint.send({ type: 'closed' }); },
      onMessageError(error) { throw error; },
    });
  }

  if (endpoint.data.port !== undefined) adopt(endpoint.data.port);
  endpoint.listen((message) => {
    switch (message.type) {
      case 'return-port':
        endpoint.send({ type: 'port', port: message.port }, [message.port]);
        break;
      case 'release':
        stopListening();
        endpoint.send({ type: 'port', port: port.handle }, [port.handle]);
        port = null;
        break;
      case 'send':
        port.send(message.message, transfers(message.message));
        break;
      case 'close':
        port.close();
        break;
      case 'send-and-close':
        port.send(message.message, transfers(message.message));
        port.close();
        break;
      default:
        throw new Error(`Unknown channel fixture command: ${message.type}`);
    }
  });
  endpoint.send({ type: 'ready', threadId });
});

function transfers(message) {
  const result = [];
  if (message.port !== undefined) result.push(message.port);
  if (message.buffer !== undefined) result.push(message.buffer);
  return result;
}
