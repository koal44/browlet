/** A decoded custom-property name; the bare -- name is reserved. */
export type CustomPropertyName = `--${string}`;

/** Recognize a decoded property name, without parsing or restricting its CSS spelling. */
// https://drafts.csswg.org/css-variables-1/#defining-variables
export function isCustomPropertyName(name: string): name is CustomPropertyName {
  return name.length > 2 && name.startsWith('--');
}
