/**
 * Returns an existing object so a derived constructor stamps its private fields
 * onto that object without exposing properties or changing its prototype.
 * Each derived stamper owns its private fields and their recognition.
 *
 * MDN: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_elements#returning_overriding_object
 * SpiderMonkey (Matthew Gaudet): https://hacks.mozilla.org/2021/06/implementing-private-fields-for-javascript/
 * TC39: https://github.com/tc39/proposal-stabilize#the-return-override-mistake
 */
export abstract class Stamper {
  constructor(target: object) { return target; }
}
