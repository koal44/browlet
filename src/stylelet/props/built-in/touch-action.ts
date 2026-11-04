import { InternalError } from '../../../infra/internal-error';

import {
  createKeywordConsumer, one, oneOf, someOf, withTrivia, createComponentParser,
  type ParserInput,
} from '../../syntax/index';
import { ValueStage } from '../../value-processing/index';
import type { Value } from '../../values/index';
import { BuiltInProperty } from '../builtin-property';

/** One exclusive keyword or an ordered combination of horizontal, vertical, and pinch permissions. */
export class TouchActionValue implements Value {
  /** Canonical grammar order, established by parsing rather than by serialization. */
  repr: TouchActionKeyword[];

  constructor(value: TouchActionKeyword[]) {
    this.repr = value;
  }

  static parse(this: void, input: ParserInput, context: unknown): TouchActionValue | null {
    return touchActionParser(input, context);
  }

  resolve(_stage: ValueStage, _context: unknown): TouchActionValue {
    // SPEC_CLASH(touch-action-computed-alias): Keep the specified combination per the draft/Firefox/WebKit; Chromium computes pan-x pan-y pinch-zoom to manipulation.
    return this;
  }

  serialize(): string {
    return this.repr.join(' ');
  }
}

// https://w3c.github.io/pointerevents/#the-touch-action-css-property
// https://compat.spec.whatwg.org/#touch-action
export const touchActionProperty = new BuiltInProperty({
  name: 'touch-action',
  parse: TouchActionValue.parse,
  inherits: false,
  initialValue: new TouchActionValue(['auto']),
  appliesTo() {
    // TODO(Pointer Events §7.1 / CSS box classification): exclude non-replaced
    // inline elements, table rows/row groups, and table columns/column groups.
    // As with margin, computing a value does not establish that it applies.
    throw new InternalError('Touch-action applicability requires box classification');
  },
  animationType: 'not-animatable',
  percentages: 'not-applicable',
  resolvedValueStage: ValueStage.Computed,
});

type TouchActionKeyword = 'auto' | 'none' | 'manipulation' |
  'pan-x' | 'pan-left' | 'pan-right' | 'pan-y' | 'pan-up' | 'pan-down' | 'pinch-zoom';

/*
 * <'touch-action'> = auto | none |
 *   [ [ pan-x | pan-left | pan-right ] || [ pan-y | pan-up | pan-down ] || pinch-zoom ] | manipulation
 */
// Compatibility §3.5.1 adds pinch-zoom to Pointer Events §7.1's grammar.
// SPEC_CLASH(touch-action-directions): Implement the specified directional keywords like Chromium; Firefox/WebKit reject them.
const panZoomConsumer = someOf([
  one(withTrivia(createKeywordConsumer('pan-x', 'pan-left', 'pan-right'))),
  one(withTrivia(createKeywordConsumer('pan-y', 'pan-up', 'pan-down'))),
  one(withTrivia(createKeywordConsumer('pinch-zoom'))),
], ([horizontal, vertical, pinch]) => new TouchActionValue([
  ...(horizontal ?? []), ...(vertical ?? []), ...(pinch ?? []),
]));

const touchActionConsumer = oneOf([
  one(createKeywordConsumer('auto', 'none', 'manipulation')),
  one(panZoomConsumer),
], ([value]) => typeof value === 'string' ? new TouchActionValue([value]) : value);
const touchActionParser = createComponentParser(withTrivia(touchActionConsumer));
