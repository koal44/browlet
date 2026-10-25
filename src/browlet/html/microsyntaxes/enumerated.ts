import { asciiLower, InternalError } from '../../../infra/index';

/** Shared keyword definitions and defaults for one kind of content attribute. */
// https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#keywords-and-enumerated-attributes
export class EnumeratedAttribute<State extends PropertyKey> {
  /** All recognized keywords, including non-conforming aliases, folded once at construction. */
  #statesByKeyword = new Map<string, State>();
  /** Keywords permitted in author input, independent of runtime fallback behavior. */
  #conformingKeywords = new Set<string>();
  /** Specification-selected spellings for reflection, computed once per definition. */
  #canonicalKeywords = new Map<State, string>();
  /** State used when the content attribute is absent. */
  #missingValueDefault: State | undefined;
  /** State used for an empty value that does not match a keyword. */
  #emptyValueDefault: State | undefined;
  /** State used when neither a keyword nor the empty-value default applies. */
  #invalidValueDefault: State | undefined;

  /**
   * Group an attribute's keywords by state; definitions belong to the attribute's owner.
   * Each state appears once, and keyword spellings must be distinct under ASCII case folding.
   */
  constructor(
    states: EnumeratedAttributeState<State>[],
    defaults: EnumeratedAttributeDefaults<State> = {},
  ) {
    this.#missingValueDefault = defaults.missingValueDefault;
    this.#emptyValueDefault = defaults.emptyValueDefault;
    this.#invalidValueDefault = defaults.invalidValueDefault;

    for (const { state, keywords, nonConformingKeywords = [], canonicalKeyword } of states) {
      for (const keyword of keywords) {
        const folded = asciiLower(keyword);
        this.#statesByKeyword.set(folded, state);
        this.#conformingKeywords.add(folded);
      }
      for (const keyword of nonConformingKeywords) {
        this.#statesByKeyword.set(asciiLower(keyword), state);
      }

      // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#canonical-keyword
      const keywordCount = keywords.length + nonConformingKeywords.length;
      let canonical: string;
      if (keywordCount === 0) continue;
      if (keywordCount === 1) {
        canonical = keywords[0] ?? nonConformingKeywords[0]!;
      } else if (keywords.length === 1) {
        canonical = keywords[0]!;
      } else if (keywords.length === 2 && keywords.includes('')) {
        canonical = keywords[0] === '' ? keywords[1]! : keywords[0]!;
      } else if (canonicalKeyword !== undefined) {
        canonical = canonicalKeyword;
      } else {
        throw new InternalError('Enumerated attribute state requires an explicit canonical keyword.');
      }
      this.#canonicalKeywords.set(state, canonical);
    }
  }

  /** Interpret raw attribute text without trimming; null represents absence or no state. */
  // The value is supplied separately from this shared definition, without retaining an Element.
  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#keywords-and-enumerated-attributes
  getState(value: string | null): State | null {
    if (value === null) return this.#missingValueDefault ?? null;

    const state = this.#statesByKeyword.get(asciiLower(value));
    if (state !== undefined) return state;
    if (value === '' && this.#emptyValueDefault !== undefined) {
      return this.#emptyValueDefault;
    }
    return this.#invalidValueDefault ?? null;
  }

  /** Check a present value's authoring syntax; recognized legacy aliases can still be invalid. */
  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#keywords-and-enumerated-attributes
  isValidValue(value: string): boolean {
    return this.#conformingKeywords.has(asciiLower(value)) ||
      (value === '' && this.#emptyValueDefault !== undefined);
  }

  /** Retrieve the canonical spelling, or null for a state with no keyword. */
  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#canonical-keyword
  getCanonicalKeyword(state: State): string | null {
    return this.#canonicalKeywords.get(state) ?? null;
  }
}

/** One state and its distinct keyword spellings, kept in specification spelling. */
export type EnumeratedAttributeState<State extends PropertyKey> = {
  /** Implementation value for this state, such as a numeric enum member. */
  state: State;
  /** Conforming keywords; an empty list permits a legacy-only or keywordless state. */
  keywords: string[];
  /** Legacy spellings recognized at runtime but not permitted in author input. */
  nonConformingKeywords?: string[];
  /** Explicit spelling required when the specification's automatic rules cannot select one. */
  canonicalKeyword?: string;
};

/** The three independent defaults specified by an enumerated attribute's owner. */
export type EnumeratedAttributeDefaults<State extends PropertyKey> = {
  /** State for an absent attribute; omission means no state. */
  missingValueDefault?: State;
  /** State for an unmatched empty string; omission continues to the invalid-value default. */
  emptyValueDefault?: State;
  /** State for an otherwise unmatched value; omission means no state. */
  invalidValueDefault?: State;
};
