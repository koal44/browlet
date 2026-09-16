import {
  type JSRealm, copyMapData, copySetData, getDateValue, getRegExpData,
  hasDateValue, hasErrorData, hasMapData, hasRegExpMatcher, hasSetData, isProxyObject,
} from '../../js-engine/index';

/** Copy automation data into its recipient's realm; live objects require handles. */
export function copyEvaluationValue(
  value: unknown, realm?: JSRealm, memory = new Map<object, unknown>(),
): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    if (typeof value === 'symbol') throw new TypeError('Symbols cannot cross the evaluation boundary');
    return value;
  }
  if (memory.has(value)) return memory.get(value);
  if (typeof value === 'function' || isProxyObject(value)) {
    throw new TypeError('Functions and proxies cannot cross the evaluation boundary');
  }

  let copy: object;
  if (hasDateValue(value)) {
    const date = new (realm?.intrinsics.date ?? Date)(getDateValue(value));
    memory.set(value, date);
    return date;
  }
  if (hasRegExpMatcher(value)) {
    const { source, flags } = getRegExpData(value);
    const expression = new (realm?.intrinsics.regExp ?? RegExp)(source, flags);
    memory.set(value, expression);
    return expression;
  }
  if (hasMapData(value)) {
    const map = new (realm?.intrinsics.map ?? Map)();
    memory.set(value, map);
    for (const [key, item] of copyMapData(value)) {
      Map.prototype.set.call(map,
        copyEvaluationValue(key, realm, memory), copyEvaluationValue(item, realm, memory));
    }
    return map;
  }
  if (hasSetData(value)) {
    const set = new (realm?.intrinsics.set ?? Set)();
    memory.set(value, set);
    for (const item of copySetData(value)) {
      Set.prototype.add.call(set, copyEvaluationValue(item, realm, memory));
    }
    return set;
  }
  if (hasErrorData(value)) {
    const error = value as Error;
    const name = String(error.name);
    const constructors: Record<string, ErrorConstructor> = realm ? {
      Error: realm.intrinsics.error, TypeError: realm.intrinsics.typeError,
      RangeError: realm.intrinsics.rangeError, SyntaxError: realm.intrinsics.syntaxError,
      ReferenceError: realm.intrinsics.referenceError, EvalError: realm.intrinsics.evalError,
      URIError: realm.intrinsics.uriError,
    } : { Error, TypeError, RangeError, SyntaxError, ReferenceError, EvalError, URIError };
    const constructor = Object.hasOwn(constructors, name) ? constructors[name]! : constructors.Error!;
    const result = new constructor(error.message);
    memory.set(value, result);
    result.name = name;
    const stack = error.stack;
    result.stack = stack === undefined ? undefined : String(stack);
    if (Object.hasOwn(error, 'cause')) result.cause = copyEvaluationValue(error.cause, realm, memory);
    return result;
  }
  if (Array.isArray(value)) {
    copy = new (realm?.intrinsics.array ?? Array)(value.length);
  } else {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== null && Object.getPrototypeOf(prototype) !== null) {
      throw new TypeError('Only data values can cross the evaluation boundary; live objects require handles');
    }
    copy = realm ? realm.createOrdinaryObject(realm.intrinsics.objectPrototype) : {};
  }
  memory.set(value, copy);
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      configurable: true, enumerable: true, writable: true,
      value: copyEvaluationValue(Reflect.get(value, key), realm, memory),
    });
  }
  return copy;
}
