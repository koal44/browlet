// Project delegate to ECMAScript §7.3.6 CreateDataPropertyOrThrow through Object.defineProperty.
export function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  defineMethod(target, key, value, true);
}

// Project helper using ECMAScript §10.2.8 DefineMethodProperty's public-property descriptor.
export function defineMethod(
  target: object,
  key: PropertyKey,
  value: unknown,
  enumerable: boolean,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable,
    value,
    writable: true,
  });
}
