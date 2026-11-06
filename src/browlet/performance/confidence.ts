import { randomInteger } from '../../js-engine/index';
import { defineEnumeration, defineInterface, idlType, impl, op, reference, roAttr, xattr } from '../../web-idl/core/index';

import type { BrowletEnvironment } from '../environment/index';

/** One navigation's retained, randomized assessment of its timing measurements. */
// https://w3c.github.io/navigation-timing/#sec-performance-timing-confidence
export class PerformanceTimingConfidenceImpl {
  /** Environment owning this value and its platform object. */
  env: BrowletEnvironment;
  /** Browlet's fixed probability of substituting a fair random high/low answer. */
  randomizedTriggerRate = 0.5;
  /** Public result after applying the specified randomization once. */
  value: PerformanceTimingConfidenceValue;

  constructor(underlying: PerformanceTimingConfidenceValue, env: BrowletEnvironment) {
    this.env = env;
    this.value = underlying;
    // https://w3c.github.io/navigation-timing/#dom-performancenavigationtiming-confidence
    // With a fixed trigger rate of 1/2, two independent cryptographic coin tosses implement
    // the specified uniform comparison and optional substitution without a new random-number API.
    if (randomInteger(0, 2) === 0) this.value = randomInteger(0, 2) === 0 ? 'high' : 'low';
  }
}

/** Whether the navigation's measurements represent ordinary performance on this device. */
export type PerformanceTimingConfidenceValue = 'high' | 'low';

/*
 * [Exposed=Window]
 * interface PerformanceTimingConfidence {
 *   readonly attribute double randomizedTriggerRate;
 *   readonly attribute PerformanceTimingConfidenceValue value;
 *   object toJSON();
 * };
 */
export const performanceTimingConfidenceIDL = defineInterface({
  name: 'PerformanceTimingConfidence', exposed: 'Window', implementation: impl(PerformanceTimingConfidenceImpl),
  members: [
    roAttr('randomizedTriggerRate', idlType.double),
    roAttr('value', reference('PerformanceTimingConfidenceValue')),
    // SPEC_CLASH(navigation-confidence-json): The prose requires default toJSON but the IDL omits [Default]. Follow the prose and Chromium's two-field result.
    op('toJSON', idlType.object, [], xattr('Default')),
  ],
});

/*
 * enum PerformanceTimingConfidenceValue {
 *   "high",
 *   "low"
 * };
 */
export const performanceTimingConfidenceValueIDL = defineEnumeration({
  name: 'PerformanceTimingConfidenceValue', values: ['high', 'low'] satisfies PerformanceTimingConfidenceValue[],
});
