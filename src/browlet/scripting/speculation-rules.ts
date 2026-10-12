/** Result retained by a speculation-rules script and passed to its relevant Window. */
// https://html.spec.whatwg.org/multipage/webappapis.html#speculation-rules-parse-result
export type SpeculationRulesParseResult = {
  /** PROVISIONAL: no rule set is produced until HTML §7.6 parsing is implemented. */
  speculationRuleSet: null;
  /** JavaScript exception preventing registration, or null when none was recorded. */
  errorToRethrow: unknown;
};
