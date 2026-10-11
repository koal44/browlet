import { asciiLower } from '../../../infra/index';

/** Interpret a content-attribute value; null means absent, and every string means true. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#boolean-attributes
export function parseBooleanAttribute(value: string | null): boolean {
  return value !== null;
}

/** Check a present attribute's authoring syntax, without changing its boolean meaning. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#boolean-attributes
export function isValidBooleanAttributeValue(value: string, canonicalName: string): boolean {
  return value === '' || asciiLower(value) === asciiLower(canonicalName);
}
