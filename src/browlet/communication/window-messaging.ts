import { DOMExceptionImpl, defineDictionary, dictMember, idlType } from '../../web-idl/core/index';
import { areSameOrigin, obtainURLOrigin, parseURL, type Origin } from '../../url/index';

import { createTaskSource } from '../scripting/index';
import type { WindowImpl } from '../browsing/window/index';
import type { BrowletEnvironment, WindowEnvironment } from '../environment';
import type { StructuredSerializeOptions } from '../scripting/structured-data/index';

import { MessageEventImpl } from './message-event';
import { MessagePortImpl } from './message-port';

/** Serialize in the invoking environment and deliver later in the target Window's realm. */
// https://html.spec.whatwg.org/multipage/web-messaging.html#window-post-message-steps
export function windowPostMessage(
  targetWindow: WindowImpl,
  message: unknown,
  options: WindowPostMessageOptions,
  env: BrowletEnvironment,
): void {
  const targetRealm = targetWindow.env.realm;
  // Window references are only available to Window globals. Incumbent lookup
  // belongs to the invoking agent, not necessarily the receiving Window's agent.
  const sourceEnv = env.responsibleEventLoop.getIncumbentEnvironment() as WindowEnvironment;
  let targetOrigin: Origin | '*' = '*';
  if (options.targetOrigin === '/') {
    targetOrigin = sourceEnv.origin;
  } else if (options.targetOrigin !== '*') {
    const { url } = parseURL(options.targetOrigin, null, 'UTF-8', env.userAgent);
    if (url === null) throw new DOMExceptionImpl('Invalid target origin', 'SyntaxError');
    targetOrigin = obtainURLOrigin(url);
  }
  const serialized = env.serializeWithTransfer(message, options.transfer);
  targetRealm.queueGlobalTask(postedMessageTaskSource, () => {
    if (targetOrigin !== '*' && !areSameOrigin(targetWindow.document.origin, targetOrigin)) return;
    const origin = sourceEnv.origin;
    const source = sourceEnv.window.getWindowProxy();
    let received;
    try {
      received = targetWindow.env.deserializeWithTransfer(serialized);
    } catch {
      targetWindow.fireEvent('messageerror', MessageEventImpl, (event) => {
        const message = event as MessageEventImpl;
        message.setOrigin(origin);
        message.source = source;
      });
      return;
    }
    targetWindow.fireEvent('message', MessageEventImpl, (event) => {
      const message = event as MessageEventImpl;
      message.setOrigin(origin);
      message.source = source;
      message.data = received.deserialized;
      message.ports = received.transferredValues.filter((value): value is MessagePortImpl => value instanceof MessagePortImpl);
    });
  });
}

export interface WindowPostMessageOptions extends StructuredSerializeOptions {
  targetOrigin: string;
  transfer: object[];
}

// https://html.spec.whatwg.org/multipage/web-messaging.html#posted-message-task-source
const postedMessageTaskSource = createTaskSource('posted message');

/*
 * dictionary WindowPostMessageOptions : StructuredSerializeOptions {
 *   USVString targetOrigin = "/";
 * };
 */
export const windowPostMessageOptionsIDL = defineDictionary({
  name: 'WindowPostMessageOptions',
  inherits: 'StructuredSerializeOptions',
  members: [dictMember('targetOrigin', idlType.USVString, { default: '/' })],
});
