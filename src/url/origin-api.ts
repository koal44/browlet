import {
  arg, ctor, defineInterface, idlType, impl, op, reference, unwrapArg, roAttr, staticOp,
} from '../web-idl/index';
import { URLImpl } from './api';
import {
  areSameOrigin, areSameSite, createOpaqueOrigin, type Origin,
} from './origin';
import { obtainURLOrigin, parseURL } from './url';

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
export class OriginImpl {
  readonly #origin: Origin;

  constructor(origin: Origin = createOpaqueOrigin()) {
    this.#origin = origin;
  }

  static from(value: unknown): OriginImpl {
    let origin: Origin | undefined;
    if (value !== null && typeof value === 'object' && #origin in value) {
      origin = value.#origin;
    } else if (URLImpl.is(value)) {
      origin = value.getOrigin();
    } else if (typeof value === 'string') {
      const url = parseURL(value).url;
      if (url !== null) origin = obtainURLOrigin(url);
    }
    if (origin === undefined) throw new TypeError('Value has no origin');

    return new OriginImpl(origin);
  }

  get opaque(): boolean {
    return this.#origin.kind === 'opaque';
  }

  isSameOrigin(other: OriginImpl): boolean {
    return areSameOrigin(this.#origin, other.#origin);
  }

  isSameSite(other: OriginImpl): boolean {
    return areSameSite(this.#origin, other.#origin);
  }
}

// -- Web IDL ------------------------------------------------------------

export const originIDL = defineInterface({
  name: 'Origin',
  exposed: '*',
  implementation: impl(OriginImpl),
  members: [
    ctor(),
    staticOp('from', reference('Origin'),
      [
        arg('value', idlType.any, unwrapArg(OriginImpl, URLImpl)),
      ],
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
