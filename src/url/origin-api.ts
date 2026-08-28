import {
  arg, ctor, defineInterface, idlType, op, roAttr, reference,
} from '../web-idl/declaration/index';
import { impl, resolveArgs } from '../web-idl/index';
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
    let origin = OriginImpl.extractOrigin(value) ??
      URLImpl.extractOrigin(value);

    if (origin === undefined && typeof value === 'string') {
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

  // -- Friends ----------------------------------------------------------

  static extractOrigin(value: unknown): Origin | undefined {
    return value !== null && typeof value === 'object' && #origin in value
      ? value.#origin
      : undefined;
  }
}

// -- Web IDL ------------------------------------------------------------

export const originIDL = defineInterface({
  name: 'Origin',
  exposed: '*',
  implementation: impl(OriginImpl),
  members: [
    ctor(),
    op('from', reference('Origin'), [
      arg(
        'value',
        idlType.any,
        resolveArgs(OriginImpl, URLImpl),
      ),
    ], {
      static: true,
    }),
    roAttr('opaque', idlType.boolean),
    op('isSameOrigin', idlType.boolean, [
      arg('other', reference('Origin')),
    ]),
    op('isSameSite', idlType.boolean, [
      arg('other', reference('Origin')),
    ]),
  ],
});
