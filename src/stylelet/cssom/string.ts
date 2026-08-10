/**
 * CSSOM permits CSSOMString to be defined as either DOMString or USVString.
 * Stylelet selects DOMString, preserving JavaScript's UTF-16 code units,
 * including unmatched surrogates. CSS Syntax input preprocessing remains
 * responsible for replacing unmatched surrogates before tokenization.
 */
export type CSSOMString = string;
