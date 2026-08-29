import type { BindingContext } from '../web-idl/projection';
import type {
  WritableStreamDefaultControllerImpl,
  WritableStreamDefaultControllerState,
} from './writable-stream-default-controller';
import type {
  WritableStreamDefaultWriterImpl,
  WritableStreamDefaultWriterState,
} from './writable-stream-default-writer';
import type { WritableStreamImpl, WritableStreamState } from './writable-stream';

type WritableStreamSlots = {
  readonly context: BindingContext;
  readonly state: WritableStreamState;
};

type WritableStreamDefaultControllerSlots = {
  state?: WritableStreamDefaultControllerState;
};

type WritableStreamDefaultWriterSlots = {
  readonly context: BindingContext;
  state?: WritableStreamDefaultWriterState;
};

const writableStreamSlots = new WeakMap<object, WritableStreamSlots>();
const writableStreamDefaultControllerSlots =
  new WeakMap<object, WritableStreamDefaultControllerSlots>();
const writableStreamDefaultWriterSlots =
  new WeakMap<object, WritableStreamDefaultWriterSlots>();

export function initializeWritableStreamSlots(
  stream: WritableStreamImpl,
  context: BindingContext,
  state: WritableStreamState,
): void {
  writableStreamSlots.set(stream, { context, state });
}

export function getWritableStreamContext(
  stream: WritableStreamImpl,
): BindingContext {
  return requireSlots(writableStreamSlots, stream, 'WritableStream').context;
}

export function getWritableStreamState(
  stream: WritableStreamImpl,
): WritableStreamState {
  return requireSlots(writableStreamSlots, stream, 'WritableStream').state;
}

export function initializeWritableStreamDefaultControllerSlots(
  controller: WritableStreamDefaultControllerImpl,
): void {
  writableStreamDefaultControllerSlots.set(controller, {});
}

export function getWritableStreamDefaultControllerState(
  controller: WritableStreamDefaultControllerImpl,
): WritableStreamDefaultControllerState {
  const state = requireSlots(
    writableStreamDefaultControllerSlots,
    controller,
    'WritableStreamDefaultController',
  ).state;
  if (!state) throw new Error('WritableStreamDefaultController is not set up');
  return state;
}

export function setWritableStreamDefaultControllerState(
  controller: WritableStreamDefaultControllerImpl,
  state: WritableStreamDefaultControllerState,
): void {
  requireSlots(
    writableStreamDefaultControllerSlots,
    controller,
    'WritableStreamDefaultController',
  ).state = state;
}

export function initializeWritableStreamDefaultWriterSlots(
  writer: WritableStreamDefaultWriterImpl,
  context: BindingContext,
): void {
  writableStreamDefaultWriterSlots.set(writer, { context });
}

export function getWritableStreamDefaultWriterContext(
  writer: WritableStreamDefaultWriterImpl,
): BindingContext {
  return requireSlots(
    writableStreamDefaultWriterSlots,
    writer,
    'WritableStreamDefaultWriter',
  ).context;
}

export function getWritableStreamDefaultWriterState(
  writer: WritableStreamDefaultWriterImpl,
): WritableStreamDefaultWriterState {
  const state = requireSlots(
    writableStreamDefaultWriterSlots,
    writer,
    'WritableStreamDefaultWriter',
  ).state;
  if (!state) throw new Error('WritableStreamDefaultWriter is not set up');
  return state;
}

export function setWritableStreamDefaultWriterState(
  writer: WritableStreamDefaultWriterImpl,
  state: WritableStreamDefaultWriterState,
): void {
  requireSlots(
    writableStreamDefaultWriterSlots,
    writer,
    'WritableStreamDefaultWriter',
  ).state = state;
}

function requireSlots<Slots>(
  slots: WeakMap<object, Slots>,
  value: object,
  name: string,
): Slots {
  const result = slots.get(value);
  if (!result) throw new TypeError(`${name} internal slots are not initialized`);
  return result;
}
