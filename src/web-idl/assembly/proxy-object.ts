import type { ProxyObjectDefinition, Definition } from '../core/index';

/** A proxy type's handle conversion and receiver-resolution hooks. */
export class AssembledProxyObject {
  /** Original declaration supplying handle conversion and current-receiver hooks. */
  primary: ProxyObjectDefinition;

  constructor(primary: ProxyObjectDefinition) {
    this.primary = primary;
  }

  /** Recognize the public proxy during union and overload selection. */
  is(value: unknown): boolean {
    return this.primary.getHandle(value) !== undefined;
  }

  /** Select a recognized proxy's current platform receiver. */
  resolveReceiver(value: unknown): object | undefined {
    const handle = this.primary.getHandle(value);
    return handle === undefined ? undefined : this.primary.resolveReceiver?.(handle);
  }
}

/** Search proxy declarations whose recognition depends on the supplied value. */
export class AssembledProxyObjects extends Map<string, AssembledProxyObject> {
  constructor(definitions: Definition[]) {
    super();
    for (const definition of definitions) {
      if (definition.kind === 'proxy-object') this.set(definition.name, new AssembledProxyObject(definition));
    }
  }

  /** Whether any declared proxy type recognizes this value. */
  is(value: unknown): boolean {
    for (const assembled of this.values()) {
      if (assembled.is(value)) return true;
    }
    return false;
  }

  /** Visit live receiver candidates; the binding checks their platform identity and world. */
  *resolveReceivers(value: unknown): IterableIterator<object> {
    for (const assembled of this.values()) {
      const receiver = assembled.resolveReceiver(value);
      if (receiver !== undefined) yield receiver;
    }
  }
}
