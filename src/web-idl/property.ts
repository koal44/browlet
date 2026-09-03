export function defineDataProperty(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  defineMethod(target, key, value, true);
}

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
