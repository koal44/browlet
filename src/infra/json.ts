/** A JSON-derived JavaScript value: primitives, dense arrays, and string-keyed objects. */
export type JSONValue = null | boolean | string | number | JSONValue[] | { [key: string]: JSONValue; };

/** JSON data represented with Infra ordered maps and lists. */
export type InfraValue = null | boolean | string | number | InfraValue[] | Map<string, InfraValue>;

/** Convert a value returned by intrinsic JSON parsing; arbitrary JavaScript objects are not supported. */
// https://infra.spec.whatwg.org/#convert-a-json-derived-javascript-value-to-an-infra-value
export function convertJSONDerivedValueToInfra(value: JSONValue): InfraValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') {
    return value;
  }
  if (Array.isArray(value)) {
    const result: InfraValue[] = [];
    // JSON arrays are dense. Indexed access also avoids an author-replaced iterator.
    for (let index = 0; index < value.length; ++index) result.push(convertJSONDerivedValueToInfra(value[index]!));
    return result;
  }
  const result = new Map<string, InfraValue>();
  for (const key of Object.keys(value)) result.set(key, convertJSONDerivedValueToInfra(value[key]!));
  return result;
}
