import { isValidElementLocalName } from '../../dom/infra/name-validation';

// HTML §4.13.3 Valid custom element names
export function isValidCustomElementName(name: string): boolean {
  return isValidElementLocalName(name) &&
    /^[a-z]/u.test(name) &&
    !/[A-Z]/u.test(name) &&
    name.includes('-') &&
    !restrictedNames.has(name);
}

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
