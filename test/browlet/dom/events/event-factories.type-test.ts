import { expectTypeOf } from 'vitest';
import type { DOMEnvironment, EventImplConstructor } from '../../../../src/browlet/dom/environment';
import { EventImpl } from '../../../../src/browlet/dom/events/event';
import type { EventTargetImpl } from '../../../../src/browlet/dom/events/event-target';
import type { BrowletEnvironment } from '../../../../src/browlet/environment/index';
import { KeyboardEventImpl } from '../../../../src/browlet/interaction/events/keyboard-event';

// Compile-only contracts: constructor identity determines the result and initializer types.
export function eventFactoryTypes(
  env: DOMEnvironment, browserEnv: BrowletEnvironment, target: EventTargetImpl,
  eventConstructor?: EventImplConstructor,
): void {
  expectTypeOf(env.createEvent(KeyboardEventImpl)).toEqualTypeOf<KeyboardEventImpl>();
  expectTypeOf(browserEnv.createEvent(KeyboardEventImpl)).toEqualTypeOf<KeyboardEventImpl>();
  expectTypeOf(target.createTrustedEvent(KeyboardEventImpl)).toEqualTypeOf<KeyboardEventImpl>();
  expectTypeOf(env.createEvent()).toEqualTypeOf<EventImpl>();
  expectTypeOf(env.createEvent(undefined)).toEqualTypeOf<EventImpl>();
  expectTypeOf(target.createTrustedEvent()).toEqualTypeOf<EventImpl>();
  expectTypeOf(target.createTrustedEvent(undefined)).toEqualTypeOf<EventImpl>();
  expectTypeOf(env.createEvent(eventConstructor)).toEqualTypeOf<EventImpl>();
  expectTypeOf(target.createTrustedEvent(eventConstructor)).toEqualTypeOf<EventImpl>();
  target.fireEvent('keydown', KeyboardEventImpl, (event) => {
    expectTypeOf(event).toEqualTypeOf<KeyboardEventImpl>();
  });
  target.fireEvent('ready', undefined, (event) => {
    expectTypeOf(event).toEqualTypeOf<EventImpl>();
  });

  // @ts-expect-error The selected constructor must produce an Event implementation.
  env.createEvent(Date);
  // @ts-expect-error The selected constructor must produce an Event implementation.
  target.createTrustedEvent(Date);
  // @ts-expect-error The selected constructor must produce an Event implementation.
  target.fireEvent('ready', Date);
  // @ts-expect-error Omitting the constructor cannot promise a derived event.
  env.createEvent<KeyboardEventImpl>();
  // @ts-expect-error Omitting the constructor cannot promise a derived event.
  target.createTrustedEvent<KeyboardEventImpl>();
  // @ts-expect-error Omitting the constructor cannot promise a derived initializer argument.
  target.fireEvent<KeyboardEventImpl>('keydown');
  // @ts-expect-error The initializer cannot require more than the selected constructor provides.
  target.fireEvent('keydown', EventImpl, (event: KeyboardEventImpl) => { event.key = 'a'; });
  // @ts-expect-error The default Event cannot satisfy a derived initializer.
  target.fireEvent('keydown', undefined, (event: KeyboardEventImpl) => { event.key = 'a'; });
}
