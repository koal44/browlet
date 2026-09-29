import { isValidElementLocalName } from '../../dom/infra/name-validation';

// https://html.spec.whatwg.org/multipage/custom-elements.html#valid-custom-element-name
export function isValidCustomElementName(name: string): boolean {
  return name.includes('-') &&
    LOWERCASE_START_RE.test(name) &&
    !UPPERCASE_RE.test(name) &&
    !restrictedNames.has(name) &&
    isValidElementLocalName(name);
}

const LOWERCASE_START_RE = /^[a-z]/;
const UPPERCASE_RE = /[A-Z]/;

const restrictedNames = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-format',
  'font-face-name',
  'font-face-src',
  'font-face-uri',
  'missing-glyph',
]);
