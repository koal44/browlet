/** Result retained by a speculation-rules script and passed to its relevant Window. */
// https://html.spec.whatwg.org/multipage/webappapis.html#speculation-rules-parse-result
export class SpeculationRulesParseResult {
  /** PROVISIONAL: no rule set is produced until HTML §7.6 parsing is implemented. */
  speculationRuleSet: null = null;
  /** JavaScript exception preventing registration, or null when none was recorded. */
  errorToRethrow: unknown = null;
}
