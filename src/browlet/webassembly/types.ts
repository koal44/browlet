/** Converted Memory descriptor, including the threads proposal's existing shared-memory option. */
export interface MemoryDescriptor {
  /** Initial page count; the engine applies AddressValueToU64 after prototype selection. */
  initial: unknown;
  /** Optional maximum page count. */
  maximum?: unknown;
  /** Address representation, defaulting to i32 in the constructor algorithm. */
  address?: 'i32' | 'i64';
  /** Whether the engine allocates shared backing storage. */
  shared: boolean;
}

/** Converted Table descriptor; the engine converts AddressValue sizes and validates stored references. */
export interface TableDescriptor {
  /** Reference type stored in each entry. */
  element: 'externref' | 'anyfunc';
  /** Initial entry count, converted numerically by the engine after prototype selection. */
  initial: unknown;
  /** Optional maximum entry count. */
  maximum?: unknown;
  /** Address representation, defaulting to i32 in the constructor algorithm. */
  address?: 'i32' | 'i64';
}

/** Converted Global descriptor; native construction converts the initializer to this Wasm value type. */
export interface GlobalDescriptor {
  value: ValueType;
  mutable: boolean;
}

/** Converted tag descriptor; a fresh sequence fixes the signature before native allocation. */
export interface TagType {
  parameters: ValueType[];
}

/** Converted exception options; the engine owns optional stack capture and formatting. */
export interface ExceptionOptions {
  traceStack: boolean;
}

/** Value kinds exposed by the JavaScript API, independently of engine-specific extensions. */
export type ValueType = 'i32' | 'i64' | 'f32' | 'f64' | 'v128' | 'externref' | 'anyfunc';
