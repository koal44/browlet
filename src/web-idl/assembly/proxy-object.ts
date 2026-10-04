import type { ProxyObjectDefinition, Definition } from '../core/index';

/** A proxy type's recognition and receiver-resolution hooks. */
export class AssembledProxyObject {
  /** Original declaration supplying recognition and current-receiver hooks. */
  primary: ProxyObjectDefinition;

  constructor(primary: ProxyObjectDefinition) {
    this.primary = primary;
  }

  /** Recognize a proxy without replacing its identity during conversion. */
  is(value: unknown): boolean {
    return this.primary.is(value);
  }

  /** Select a recognized proxy's current platform receiver. */
  resolveReceiver(value: unknown): object | undefined {
    return this.is(value) ? this.primary.resolveReceiver?.(value) : undefined;
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
