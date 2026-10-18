/** Fixed HTML element facts used to assemble sanitizer configurations and navigation-URL checks. */
// https://html.spec.whatwg.org/multipage/dom.html#concept-element-sanitization
export type ElementSanitization = {
  category: SanitizationCategory;
  /** Namespace-less attributes added to the shared default allowances; omission means none. */
  defaultAttributes?: string[];
  /** Namespace-less attributes subject to navigation-URL checks; omission means none. */
  navigatingURLAttributes?: string[];
};

/** An element's prescribed treatment in built-in sanitizer configurations. */
// https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#sanitization-category
export enum SanitizationCategory {
  /** Included in the built-in safe default configuration. */
  Default,
  /** Removed by safe sanitization regardless of the supplied configuration. */
  Unsafe,
  /** Excluded from the default selection, but available for explicit inclusion. */
  Uncategorized,
}
