import { TypeError } from '../../infra/index';
import {
  arg, ctor, defineInterface, idlType, impl, op, reference, unwrapArg, roAttr, staticOp,
} from '../../web-idl/core/index';
import {
  type Origin, URLImpl, areSameOrigin, areSameSite, createOpaqueOrigin, obtainURLOrigin, parseBasicURL,
} from '../../url/index';

import { HTMLAnchorElementImpl } from '../dom/nodes/html/text/index';
import { HTMLAreaElementImpl } from '../dom/nodes/html/embedded/index';
import { WindowImpl, WindowProxyHandle } from './window/index';
import { MessageEventImpl } from '../communication/index';
import type { BrowletEnvironment } from '../environment';

/** Retains an origin for identity-preserving copies and origin/site comparisons. */
// https://html.spec.whatwg.org/multipage/browsers.html#the-origin-interface
export class OriginImpl {
  #origin: Origin;

  constructor(origin: Origin = createOpaqueOrigin()) {
    this.#origin = origin;
  }

  static is(value: unknown): value is OriginImpl {
    return typeof value === 'object' && value !== null && #origin in value;
  }

  static from(value: unknown, entryEnv: BrowletEnvironment): OriginImpl {
    let origin = entryEnv.extractOrigin(value);
    if (typeof value === 'string') {
      const url = parseBasicURL(value).url;
      if (url !== null) origin = obtainURLOrigin(url);
    }
    if (origin === null) throw new TypeError('Value has no origin');

    return new OriginImpl(origin);
  }

  get opaque(): boolean {
    return this.#origin.kind === 'opaque';
  }

  extractOrigin(): Origin {
    return this.#origin;
  }

  isSameOrigin(other: OriginImpl): boolean {
    return areSameOrigin(this.#origin, other.#origin);
  }

  isSameSite(other: OriginImpl): boolean {
    return areSameSite(this.#origin, other.#origin);
  }
}

/*
 * [Exposed=*]
 * interface Origin {
 *   constructor();
 *
 *   static Origin from(any value);
 *
 *   readonly attribute boolean opaque;
 *
 *   boolean isSameOrigin(Origin other);
 *   boolean isSameSite(Origin other);
 * };
 */
export const originIDL = defineInterface<BrowletEnvironment>({
  name: 'Origin',
  exposed: '*',
  implementation: impl(OriginImpl),
  members: [
    ctor(),
    staticOp('from', reference('Origin'),
      [
        arg('value', idlType.any, unwrapArg(
          OriginImpl, URLImpl, WindowImpl, HTMLAnchorElementImpl, HTMLAreaElementImpl, MessageEventImpl,
        )),
      ],
      {
        invoke(env, value) {
          const handle = WindowProxyHandle.getHandle(value);
          const target = handle === undefined ? value : handle.windowImplementation;
          const eventLoop = env.responsibleEventLoop;
          // Direct host calls have no HTML entry; use the operation's environment there.
          const entryEnv = eventLoop.executionContextStack.length === 0
            ? env : eventLoop.entryExecutionContext.realm.env;
          return OriginImpl.from(target, entryEnv);
        },
      },
    ),
    roAttr('opaque', idlType.boolean),
    op('isSameOrigin', idlType.boolean, [
      arg('other', reference('Origin')),
    ]),
    op('isSameSite', idlType.boolean, [
      arg('other', reference('Origin')),
    ]),
  ],
});
