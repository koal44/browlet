import type { TaskHandle } from '../../infra/index';
import { isomorphicDecode } from '../../js-engine/index';
import {
  arg, atArg, constant, ctor, defineDictionary, defineInterface, dictMember,
  DOMExceptionImpl, emptyDictionary, idlType, impl, integer, op, reference, roAttr,
} from '../../web-idl/core/index';
import { TextDecoderImpl, utf8Encode } from '../../encoding/index';
import { obtainURLOrigin, serializeURL, type URLRecord } from '../../url/index';
import { fetch, isFilteredResponse, type FetchController, type FetchRequest, type FetchResponse } from '../../fetch/index';

import {
  createTaskSource, eventHandlerAttr, EventHandlerMap, type EventHandlerCallback,
} from '../scripting/index';
import { EventTargetImpl } from '../dom/events/index';
import type { BrowletEnvironment } from '../environment';

import { MessageEventImpl } from './message-event';

/** Receives a UTF-8 event stream and reconnects until closed or rejected by the server. */
// https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface
export class EventSourceImpl extends EventTargetImpl {
  declare env: BrowletEnvironment;
  withCredentials: boolean;
  readyState = EventSourceState.Connecting;
  #url: URLRecord;
  #request: FetchRequest;
  #controller?: FetchController;
  #reconnectionTime = 3000;
  #lastEventID = '';
  #retryTimer?: TaskHandle;
  #eventHandlers = new EventHandlerMap(this, [
    { name: 'onopen', type: 'open' },
    { name: 'onmessage', type: 'message' },
    { name: 'onerror', type: 'error' },
  ]);

  constructor(url: string, eventSourceInitDict: EventSourceInit, env: BrowletEnvironment) {
    super(env);
    const urlRecord = env.encodingParseURL(url);
    if (urlRecord === null) throw new DOMExceptionImpl('Invalid EventSource URL', 'SyntaxError');
    this.#url = urlRecord;
    this.withCredentials = eventSourceInitDict.withCredentials;
    this.#request = env.userAgent.createPotentialCORSRequest(
      urlRecord, '', this.withCredentials ? 'use-credentials' : 'anonymous',
    );
    this.#request.client = env;
    this.#request.headerList.set('Accept', 'text/event-stream');
    this.#request.cacheMode = 'no-store';
    this.#request.initiatorType = 'other';
    env.getWindowOrWorkerGlobalScopeMixin().eventSources.add(this);
    this.#connect();
  }

  get url(): string { return serializeURL(this.#url); }

  get onopen(): EventHandlerCallback | null { return this.#eventHandlers.get('onopen'); }
  set onopen(callback: EventHandlerCallback | null) { this.#eventHandlers.set('onopen', callback); }

  get onmessage(): EventHandlerCallback | null { return this.#eventHandlers.get('onmessage'); }
  set onmessage(callback: EventHandlerCallback | null) { this.#eventHandlers.set('onmessage', callback); }

  get onerror(): EventHandlerCallback | null { return this.#eventHandlers.get('onerror'); }
  set onerror(callback: EventHandlerCallback | null) { this.#eventHandlers.set('onerror', callback); }

  /** Also used by HTML's forcibly-close steps during permanent document cleanup. */
  // https://html.spec.whatwg.org/multipage/server-sent-events.html#dom-eventsource-close
  close(): void {
    if (this.readyState === EventSourceState.Closed) return;
    this.readyState = EventSourceState.Closed;
    this.#retryTimer?.remove();
    this.#retryTimer = undefined;
    this.#controller?.abort(this.env);
    this.env.getWindowOrWorkerGlobalScopeMixin().eventSources.delete(this);
  }

  #connect(): void {
    this.#request.done = false;
    this.#controller = fetch(this.#request, {
      processResponse: (response) => this.#processResponse(response),
    }, this.env);
  }

  #processResponse(response: FetchResponse): void {
    if (this.readyState === EventSourceState.Closed) return;
    if (response.type === 'error') {
      if (response.aborted) this.#failConnection();
      else this.#reestablishConnection();
      return;
    }
    if (isFilteredResponse(response)) response = response.internalResponse;
    const mimeType = response.headerList.extractMIMEType();
    if (response.status !== 200 || mimeType?.type !== 'text' || mimeType.subtype !== 'event-stream') {
      this.#failConnection();
      return;
    }
    this.env.realm.queueGlobalTask(remoteEventTaskSource, () => {
      if (this.readyState === EventSourceState.Closed) return;
      this.readyState = EventSourceState.Open;
      this.fireEvent('open');
    });
    this.#interpret(response);
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#reestablish-the-connection
  #reestablishConnection(): void {
    if (this.readyState === EventSourceState.Closed) return;
    const { env } = this;
    env.realm.queueGlobalTask(remoteEventTaskSource, () => {
      if (this.readyState === EventSourceState.Closed) return;
      this.readyState = EventSourceState.Connecting;
      this.fireEvent('error');
    });
    const deadline = env.userAgent.unsafeSharedCurrentTime() + this.#reconnectionTime;
    const retry = (): void => {
      if (this.readyState === EventSourceState.Closed) return;
      const remaining = deadline - env.userAgent.unsafeSharedCurrentTime();
      if (remaining > 0) {
        this.#retryTimer = env.userAgent.timerHost.scheduleTimeout(remaining, retry);
        return;
      }
      this.#retryTimer = undefined;
      // The same task source places this after the CONNECTING/error task, even for retry: 0.
      env.realm.queueGlobalTask(remoteEventTaskSource, () => {
        if (this.readyState !== EventSourceState.Connecting) return;
        if (this.#lastEventID !== '') {
          this.#request.headerList.set('Last-Event-ID', isomorphicDecode(utf8Encode(this.#lastEventID)));
        } else {
          // SPEC_CLASH(eventsource-empty-last-event-id): The reconnection steps only set nonempty IDs; the reset example requires removing the previous header.
          this.#request.headerList.delete('Last-Event-ID');
        }
        this.#connect();
      });
    };
    this.#retryTimer = env.userAgent.timerHost.scheduleTimeout(this.#reconnectionTime, retry);
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#fail-the-connection
  #failConnection(): void {
    this.env.realm.queueGlobalTask(remoteEventTaskSource, () => {
      if (this.readyState === EventSourceState.Closed) return;
      this.close();
      this.fireEvent('error');
    });
  }

  // https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
  #interpret(response: FetchResponse): void {
    if (response.body === null) {
      this.#reestablishConnection();
      return;
    }
    const decoder = new TextDecoderImpl('utf-8', { fatal: false, ignoreBOM: false });
    const origin = obtainURLOrigin(response.url!);
    let line = '';
    let skipLF = false;
    let data = '';
    let eventType = '';
    // SPEC_CLASH(eventsource-reconnect-last-event-id): The empty-buffer step conflicts with retaining IDs until changed; carry the ID across streams as Blink does.
    let lastEventID = this.#lastEventID;

    const processLine = (value: string): void => {
      if (value === '') {
        this.#lastEventID = lastEventID;
        if (data !== '') {
          const event = this.createTrustedEvent(MessageEventImpl) as MessageEventImpl;
          event.type = eventType || 'message';
          event.data = data.slice(0, -1);
          event.setOrigin(origin);
          event.lastEventId = lastEventID;
          this.env.realm.queueGlobalTask(remoteEventTaskSource, () => {
            if (this.readyState !== EventSourceState.Closed) this.dispatch(event);
          });
        }
        data = eventType = '';
        return;
      }
      const colon = value.indexOf(':');
      if (colon === 0) return;
      const field = colon < 0 ? value : value.slice(0, colon);
      value = colon < 0 ? '' : value.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      switch (field) {
        case 'event': eventType = value; break;
        case 'data': data += `${value}\n`; break;
        case 'id': if (!value.includes('\0')) lastEventID = value; break;
        case 'retry': if (/^[0-9]+$/.test(value)) this.#reconnectionTime = Number(value); break;
      }
    };
    response.body.incrementallyRead((bytes) => {
      if (this.readyState === EventSourceState.Closed) return;
      const text = decoder.decode(bytes, { stream: true });
      let start = 0;
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (skipLF) {
          skipLF = false;
          if (character === '\n') { start = index + 1; continue; }
        }
        if (character === '\r' || character === '\n') {
          processLine(line + text.slice(start, index));
          line = '';
          start = index + 1;
          skipLF = character === '\r';
        }
      }
      line += text.slice(start);
    }, () => {
      // Discard unterminated lines/events. Finish reading before reconnecting so
      // the last message tasks precede the error task, including at immediate EOF.
      this.#reestablishConnection();
    }, () => this.#reestablishConnection(), this.env.realm.globalObject);
  }
}

export enum EventSourceState { Connecting, Open, Closed }

export interface EventSourceInit {
  withCredentials: boolean;
}

// https://html.spec.whatwg.org/multipage/server-sent-events.html#remote-event-task-source
const remoteEventTaskSource = createTaskSource('remote event');

/*
 * [Exposed=(Window,Worker)]
 * interface EventSource : EventTarget {
 *   constructor(USVString url, optional EventSourceInit eventSourceInitDict = {});
 *   readonly attribute USVString url;
 *   readonly attribute boolean withCredentials;
 *   const unsigned short CONNECTING = 0;
 *   const unsigned short OPEN = 1;
 *   const unsigned short CLOSED = 2;
 *   readonly attribute unsigned short readyState;
 *   attribute EventHandler onopen;
 *   attribute EventHandler onmessage;
 *   attribute EventHandler onerror;
 *   undefined close();
 * };
 * dictionary EventSourceInit { boolean withCredentials = false; };
 */
export const eventSourceIDL = defineInterface<BrowletEnvironment>({
  name: 'EventSource',
  inherits: 'EventTarget',
  exposed: ['Window', 'Worker'],
  implementation: impl(EventSourceImpl, { constructWith: [atArg(2, (env) => env)] }),
  members: [
    ctor([
      arg('url', idlType.USVString),
      arg('eventSourceInitDict', reference('EventSourceInit'), { default: emptyDictionary, optional: true }),
    ]),
    roAttr('url', idlType.USVString),
    roAttr('withCredentials', idlType.boolean),
    constant('CONNECTING', idlType.unsignedShort, integer(EventSourceState.Connecting)),
    constant('OPEN', idlType.unsignedShort, integer(EventSourceState.Open)),
    constant('CLOSED', idlType.unsignedShort, integer(EventSourceState.Closed)),
    roAttr('readyState', idlType.unsignedShort),
    eventHandlerAttr('onopen'), eventHandlerAttr('onmessage'), eventHandlerAttr('onerror'),
    op('close', idlType.undefined),
  ],
});

export const eventSourceInitIDL = defineDictionary({
  name: 'EventSourceInit',
  members: [dictMember('withCredentials', idlType.boolean, { default: false })],
});
