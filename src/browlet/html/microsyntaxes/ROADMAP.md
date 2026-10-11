# HTML microsyntaxes roadmap

[HTML §2.3](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html)
defines reusable value syntax and parsing behavior consumed by elements,
reflection, parsing, and loading. This directory owns the HTML value algorithms;
content-attribute access, element state, and CSS evaluation retain their owners.

## Five implementation slices

Proceed in specification order, with one implementation/review unit per slice.
2.3A–2.3E are complete within their bounded scope. Media matching and
serializable identity retain the agreed consumer-dependent gates below.

| Slice | HTML sections | Scope |
| --- | --- | --- |
| **2.3A — Attribute states (implemented)** | §§2.3.1–2.3.3 | Parser idioms, boolean presence, enumerated states/defaults, and canonical keywords |
| **2.3B — Numbers (implemented)** | §2.3.4 | Integers, floating-point numbers, percentages/lengths, nonzero forms, numeric lists, and dimension lists |
| **2.3C — Dates and times (implemented)** | §2.3.5 | Months, dates/yearless dates, times, local/global date-times, offsets, weeks, durations, and date-or-time parsing |
| **2.3D — Colors and tokens (implemented)** | §§2.3.6–2.3.8 | Legacy colors and space/comma token forms |
| **2.3E — References, media, and identity (bounded slice complete)** | §§2.3.9–2.3.11 | Hash-name text parsing; image-map lookup retained with HTML elements; media matching and serializable identity deferred |

`parse…` operations turn attribute text into values. Date/time component consumers
advance a shared position and use `consume…`; their public parsers require the
complete input. HTML's numeric parsers deliberately recover a prefix, as their
JSDoc states, while the separate validity checks enforce authoring syntax.
Boolean presence, enumerated state lookup, normalization, and serialization
remain explicit value operations without consulting a DOM tree.

### 2.3A: attribute states

[`boolean.ts`](boolean.ts) separates presence interpretation from authoring
validity: every present value, including `false`, means true.
[`EnumeratedAttribute`](enumerated.ts) owns a shared definition's state lookup,
three independent defaults, authoring validity, and canonical keywords. It
prepares lookup tables and canonical spellings once; reads fold only the supplied
value with Infra's ASCII conversion and do not trim it. Element-specific keyword
definitions stay with their owners, and §2.6 reflection remains a later consumer.

The definition groups conforming keywords and legacy aliases by state, and
`getState()` receives raw attribute text separately. `null` represents an absent
input or no output state. Canonical-keyword lookup likewise returns `null` for a keywordless state.
State values may be strings, numeric enum members, or Symbols.

§2.3.1 only establishes the input/position convention. Ordinary string positions
and existing Infra classification suffice; no parser object or missing dependency
is introduced. [Focused tests](../../../../test/browlet/html/microsyntaxes/)
cover the decision order, absence versus empty text, ASCII matching, legacy
aliases, authoring conformance, and all canonical-keyword selection rules.
Stop before reflected IDL members, form controls, or custom-element reactions.

### 2.3B: numbers

[`numbers.ts`](numbers.ts) supplies all seven §2.3.4 families as ordinary functions.
Whole-string validity stays separate from permissive prefix parsing. Integers
return `bigint` to preserve exact values; callers apply their bounds before
converting to `number`. Floating-point parsing skips only ASCII whitespace,
converts the decimal prefix once, rejects non-finite results, and returns positive
zero. Serialization delegates to ECMAScript's number-to-string conversion.
Floating-point lists preserve zero entries for malformed members.

Dimensions use finite JavaScript numbers and retain their units; this does **not**
promise exact decimals or integers above the safe-integer range. Parsing a
nonzero dimension checks the converted value, so an underflowed zero fails.
Element defaults, usable size limits, unit resolution, and layout remain with
future consumers. This slice introduces no missing subsystem dependency and
does not yet wire reflection, controls, presentational hints, or framesets.

Dimension results use the reviewed and accepted named `{ value, unit }`
records to represent the single parser's categorized number and
the list parser's number/unit pairs. `DimensionUnit.Absolute` represents both
the single parser's length category and the list parser's absolute unit;
the single parser's type excludes relative units. `null` denotes parsing failure.

[`numbers.test.ts`](../../../../test/browlet/html/microsyntaxes/numbers.test.ts)
covers 166 cases, including signs, whitespace, trailing input, large exact
integers, incomplete exponents, decimal rounding, overflow/underflow, zero,
list recovery, empty members, and unit categorization. Together with slice A,
202 focused tests pass; typecheck and focused lint pass.

#### Numeric specification choices and browser evidence

The 2026-10-10 probe used Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5.
The reproducer is [HTML-NUMBERS-PROBE.mjs](../../../../scratch/HTML-NUMBERS-PROBE.mjs).
Frameset results below are observed widths in a 1,000px viewport; source inspection
separately identifies the parser behavior. No frameset layout is implemented here.

| Case | Chromium | Firefox | WebKit | Browlet choice |
| --- | --- | --- | --- | --- |
| Number input assigned `1.e2` | Retains text | Clears text | Retains text | Invalid authoring syntax, following HTML/Firefox; permissive parsing still returns 100 |
| `progress.max` from NBSP followed by `1.5` | Default 1 | 1.5 | Default 1 | Parsing fails, following HTML/Chromium/WebKit's ASCII whitespace rule |
| Frameset `cols="10.5%,*"` | 105px | 100px | 105px | Preserve 10.5% after consuming the omitted decimal point |
| Frameset `cols="10. 5%,*"` | 105px | 100px | 105px | Fractional whitespace is discarded as specified |
| Frameset `cols=".5%,*"` | 0px | 50px | 5px | The repaired algorithm permits an absent integer part: 0.5%, matching WebKit |
| Frameset `cols="100,,"` | Two columns: 100px/900px | One column | Two columns: 100px/900px | One parsed dimension, following HTML/Infra |

- `SPEC_CLASH(html-float-empty-fraction)` follows the written
  [valid floating-point grammar](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-floating-point-number).
  It requires a digit after a decimal point. This differs from permissive parsing,
  which accepts `1.e2` in all three browsers.
- `SPEC_CLASH(html-float-ascii-whitespace)` follows the written
  [parsing algorithm](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-floating-point-number-values).
  Native JavaScript parsing also skips NBSP, so Browlet checks the initial
  character after skipping ASCII whitespace before delegating decimal conversion.
- `SPEC_CLASH(html-dimension-list-fraction)` repairs the missing advancement in
  [list-of-dimensions step 5.7](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-list-of-dimensions).
  The literal steps cannot enter their fractional-digit collector at all and
  treat `10.5%` as an absolute length of 10. Browlet preserves the intended
  fraction and subsequent unit, as approved; Firefox instead uses an integer parser.
- `SPEC_CLASH(html-dimension-list-final-empty)` keeps the written composition:
  HTML removes one final comma, then [Infra comma splitting](https://infra.spec.whatwg.org/#split-on-commas)
  omits a final empty token. `100,,` therefore yields only the absolute 100 entry.
  Chromium/WebKit retain another empty member; Firefox strips trailing commas and
  produces one column here. This is not general alignment with Firefox: `100,, `
  has three members under HTML/Infra and Chromium/WebKit, but Firefox still keeps one.
- `SPEC_GAP(html-dimension-overflow)` records the unspecified numeric limit,
  also tracked in [HTML #11539](https://github.com/whatwg/html/issues/11539).
  Browlet rounds the complete decimal to a double. Single dimensions that become
  infinite fail with `null`; list entries recover as `{ value: 0, unit: Relative }`.
  This deliberately borrows Chromium's recovery, not its smaller component limits.
  Finite rounding is accepted, and a long fractional digit sequence is not an
  error when the complete value is finite. Exact integer parsing is unaffected.

Source evidence for overflow: [Chromium's dimension parser](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_dimension.cc)
uses checked unsigned integer/fraction components and substitutes `0*` on overflow.
[WebKit's parser](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/parser/HTMLParserIdioms.cpp)
uses checked unsigned components and substitutes `1*`.
[Firefox's frameset parser](https://github.com/mozilla-firefox/firefox/blob/main/dom/html/HTMLFrameSetElement.cpp)
stores signed integers; failed integer conversion becomes zero while retaining
the detected unit. These are parser policies, separate from subsequent layout.

### 2.3C: dates and times

`dates.ts` now uses the adopted `dates2` implementation and explicit names:
`parseYearMonth`, `parseCalendarDate`, `parseMonthDay`, `parseClockTime`,
`parseLocalDateTime`, `parseUtcOffsetMinutes`, `parseOffsetDateTime`,
`parseYearWeek`, `parseDurationSeconds`, and `parseDateOrTime`. The subsystem
barrel exposes this single implementation. Parsers consume complete input or
return `null`; private `consume` methods advance the shared cursor and may leave
it advanced on failure. Separate authoring checks remain only where HTML's
valid syntax is narrower than the parser's accepted input.

The reviewed records are type aliases. Years remain exact positive `bigint`
values; bounded calendar and clock fields use numbers. A `ClockTime` keeps whole
`second` and exact ASCII `fractionDigits` (`''` when absent), preserving long
fractions without rounding to 60 or underflowing to zero. Combined `DateTime`
values use one flat calendar/clock record, constructed without intermediate
calendar or clock objects. UTC offsets are signed numeric minutes; offset
results retain `{ utc, offsetMinutes }`. A positive offset can move year 1 into
UTC year 0. Date-or-time results use `kind: 'date' | 'time' | 'offsetDateTime'`.
These accepted representations no longer carry pending `SPEC_MISMATCH` flags.

The parser owns its input and position directly. Measured optimizations reuse
validated text during normalization, avoid a substring for four-digit years,
and reduce week arithmetic to the Gregorian 400-year cycle before using
numbers. Longer years remain exact. Parsing preserves fractional trailing zeros;
normalization shortens only the spelling of already-valid local date-times.

Durations return finite JavaScript-number seconds, with ordinary decimal
rounding and underflow. Nonzero calendar months/years fail because their length
is not fixed in seconds. The permissive parser accepts repeated units, zero
calendar components, and forms such as `P2W` that authoring grammar rejects.
There is no date-library, host-time-zone, or missing subsystem dependency.
Input-value sanitization, stepping, localization, and form reflection remain
later consumers.

The original [date fixtures](../../../../test/browlet/html/microsyntaxes/dates.test.ts)
remain, updated directly to the adopted API and records. Two additional cases
retain the short/long year conversion boundary and combined exact-value checks:
268 tests pass. Production no longer includes comparison adapters or duplicate
variant suites. The original, optimized, and native-`Date` alternatives, intermediate
snapshots, benchmark harnesses, and measured findings are preserved in the
independent [Experimental repository](../../../../node-compat/experimental/dates/README.md).
The native-`Date` carrier was not adopted; it cost more in the measured operations
while also narrowing the year and fraction contracts.

#### Date/time specification choices and browser evidence

The 2026-10-10 probe used Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5;
the reproducer is [HTML-DATES-PROBE.mjs](../../../../scratch/HTML-DATES-PROBE.mjs).
This installed WebKit build falls back to text inputs for date/time controls,
so its unchanged values are not evidence of date/time parsing. Source inspection
supplies its fractional-second limit instead.

- `SPEC_CLASH(html-time-parser-fraction)` follows the written
  [time parser](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-time-component):
  fractional digits are unbounded, while valid authoring syntax allows at most
  three. Chromium/Firefox reject four-digit fractions in both assigned time
  values and `min` parsing. With value `12:00`, minimum `12:00:00.001` produces
  underflow, while minimum `12:00:00.0001` is ignored. WebKit's `parseTime()`
  likewise rejects more than three digits. Browlet retains the written parser and the stricter validity check. The
  reviewed representation preserves all digits until a consuming algorithm
  requires narrower precision. Truncation would differ from both
  the written parser and the observed browser rejection. Assigned-value rejection
  itself is required by input value sanitization, not a specification conflict;
  the conflict concerns the broader parsing algorithm, including `min` conversion.
- `SPEC_CLASH(html-local-datetime-fraction-normalization)` follows HTML's
  [shortest time spelling](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-normalised-local-date-and-time-string)
  and Chromium: `.010` becomes `.01`. Firefox retains `.010`. Both tested
  engines omit zero seconds and replace the separating space with `T`.
  The 2026-10-11 [review probe](../../../../scratch/HTML-MICROSYNTAX-REVIEW-PROBE.mjs)
  confirms that Firefox preserves supplied fractional spelling rather than
  padding to three digits: `.1`, `.10`, and `.100` all remain as supplied.
  Chromium normalizes those three to `.1` for `datetime-local`; both browsers
  preserve them in plain `time` inputs. Their numeric millisecond values agree.
- `SPEC_CLASH(html-date-year-range)` records HTML's absence of a maximum year
  against browser form limits. Chromium rejects `275760-09-14` and
  `1000000-01-01`; Firefox accepts both, but rejects `9007199254740992-02-29`.
  Browlet follows the standalone grammar and Gregorian rules using `bigint`;
  future numeric form conversions still need their own consumer limits.
- `SPEC_GAP(html-duration-overflow)` records that the
  [duration algorithm](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#parse-a-duration-string)
  does not specify a numeric ceiling or overflow recovery. Following the finite
  number policy used in slice B, a non-finite seconds total returns `null`.
  Eric approved retaining this failure result. Syntactic validity remains
  independent of this bound. No comparable exposed
  browser duration parser was identified; `<time>.dateTime` reflects text and
  cannot establish numeric recovery behavior.

Fractional parsing source references:
[Chromium DateComponents](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/text/date_components.cc),
[Firefox HTMLInputElement](https://github.com/mozilla-firefox/firefox/blob/main/dom/html/HTMLInputElement.cpp),
and [WebKit DateComponents](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/DateComponents.cpp).

The 2026-10-11 history review found the exact unresolved discussion in
[WHATWG HTML #4948](https://github.com/whatwg/html/issues/4948), opened on
2019-09-29. It proposes allowing longer valid time strings to match the parser.
Domenic distinguishes parsing requirements from authoring conformance; Anne
van Kesteren identifies millisecond precision as a reason for the three-digit
limit. The issue remains open without a resolution of the differing limits.

[Chromium bug 683041](https://issues.chromium.org/issues/41296029) led to the
[2017-02-08 parser change](https://github.com/chromium/chromium/commit/925b3122a05d1ecaeedc8780a05089de19a6990a).
Chrome previously accepted longer fractions and read only their first three
digits numerically. The fix rejects them, citing the valid-time-string grammar
and Firefox. Reviewers identified `DateComponents` as a date/time-input utility;
this was not a decision about every consumer of HTML's general time parser.
The existing [WPT time test](https://github.com/web-platform-tests/wpt/blob/master/html/semantics/forms/the-input-element/time-2.html)
already requires `00:00:00.0000` to produce an empty input value. That result
therefore does not, by itself, decide the standalone parser's contract or its
numeric representation. Browlet retains exact fractions in the general parser.

### 2.3D: colors and tokens

[`color.ts`](color.ts) implements HTML's recovery algorithm and
returns Stylelet's existing `AbsoluteColor`, or `null` on failure. Results are
opaque legacy sRGB colors with byte components. Stylelet exposes its existing
`ColorRgba` table and `absoluteColorFromRgba()` factory through its source and
package entry points. HTML performs the name lookup directly against that table;
it neither copies the table nor sends legacy input through CSS parsing.
No Environment, Agent, or new color record is involved.

The parser checks empty input before trimming, rejects `transparent`, recognizes
named colors and three-digit hex, and then applies the specified recovery.
UTF-16 non-hex replacement supplies the required two zeros for a non-BMP code
point, including at the truncation boundary. Components retain their last eight
digits before common leading-zero removal and final two-digit truncation.
CSS functions, system colors, and four/eight-digit alpha hex use legacy recovery.
Obsolete element attributes and presentational-hint integration remain later consumers.

§2.3.7 needs no new implementation: DOM's existing
[ASCII splitter and ordered-set operations](../../dom/infra/ordered-set.ts)
already preserve the relevant tokens and first-occurrence order. Allowed values,
uniqueness requirements, and comparison rules remain with each consuming attribute;
this slice introduces no universal token validator or new token-list class.

[`parseCommaSeparatedTokens()`](tokens.ts) tokenizes the §2.3.8 syntax while
preserving duplicate and empty fields, including trailing empties. It trims only
edge ASCII whitespace; case and internal whitespace are unchanged. HTML defines
the grammar here, not a splitting algorithm. The helper represents `''` as one
empty field, `['']`; a consuming algorithm can specify a different interpretation.
This differs from Infra's
[split-on-commas algorithm](https://infra.spec.whatwg.org/#split-on-commas), which
omits a final empty field and returns `[]` for empty input. Substituting this
helper for an explicit Infra call therefore requires a behavior choice at the
consumer. Slice B's dimension parsing retains that Infra rule.

These are ordinary implementations of the existing color representation and
token syntax, so D adds no callable-shape `SPEC_MISMATCH`. Preserving empty
comma fields is approved for the HTML helper and future email consumer.
No dependency remains missing in C or D.

Validation: 1,168 microsyntax and Stylelet color tests pass, including 78 new D
cases. All six artifact tests pass, including ESM/CommonJS color exports.
Typecheck, focused lint, and the Stylelet/Browlet builds pass without warnings.

#### Legacy-color specification choices and browser evidence

The 2026-10-10 [probe](../../../../scratch/HTML-COLORS-PROBE.mjs) used Chromium
149.0.7827.55, Firefox 151.0, and WebKit 26.5. It reads a font element's computed
color under a parent colored `rgb(1, 2, 3)`; inheritance therefore distinguishes
parsing failure from a parsed black value. Unlike the date/time probe, all three
installed engines expose this behavior.

The implementation follows the written
[HTML algorithm](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#rules-for-parsing-a-legacy-colour-value)
with the following choices and browser results:

| Case | HTML / Browlet | Chromium | Firefox | WebKit |
| --- | --- | --- | --- | --- |
| ASCII-whitespace-only input | Black | Black | Inherits | Black |
| `transparent` | Failure / inherits | Inherits | Transparent black | Inherits |
| `12  34` | `rgb(18, 0, 52)` | Same | `rgb(18, 3, 64)` | Same |
| Vertical tab + `red` + vertical tab | `rgb(0, 237, 0)` | Red | Same as HTML | Same as HTML |
| `#` + 126 zeros + `11` | `rgb(0, 0, 16)` | `rgb(0, 0, 17)` | Same as HTML | `rgb(0, 0, 17)` |

- `SPEC_CLASH(html-legacy-color-whitespace)` covers Firefox's compression before
  the empty check: it rejects whitespace-only values and changes internal runs.
- `SPEC_CLASH(html-legacy-color-transparent)` covers Firefox accepting a
  transparent color instead of failing.
- `SPEC_CLASH(html-legacy-color-ascii-whitespace)` covers Chromium additionally
  trimming vertical tabs. Eric approved leaving vertical tabs for legacy
  recovery, as HTML requires. NBSP and BOM remain data in all three probes.
- `SPEC_CLASH(html-legacy-color-hash-limit)` covers Chromium/WebKit removing the
  leading hash before counting 128 characters. HTML and Firefox count the hash.

The direct tests retain the written expectations, including each disagreement.
Source evidence: [Chromium HTMLElement](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/html_element.cc),
[Firefox nsAttrValue](https://github.com/mozilla-firefox/firefox/blob/main/dom/base/nsAttrValue.cpp)
and [loose-hex parsing](https://github.com/mozilla-firefox/firefox/blob/main/gfx/src/nsColor.cpp),
and [WebKit HTMLElement](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/HTMLElement.cpp).

#### Comma-token consumer evidence

The 2026-10-11 [review probe](../../../../scratch/HTML-MICROSYNTAX-REVIEW-PROBE.mjs)
tested `input[type=email][multiple]` in Chromium 149.0.7827.55, Firefox 151.0,
and WebKit 26.5. All three preserve the trailing comma in `a@example.com,`
and report `validity.typeMismatch`; leading and interior empty entries likewise
fail. Empty input is accepted as an optional empty control, which does not by
itself reveal whether an internal splitter produced `[]` or `['']`.

`SPEC_CLASH(html-email-comma-trailing-empty)`: HTML's
[email value sanitization](https://html.spec.whatwg.org/multipage/input.html#email-state-(type=email))
calls Infra's comma splitter, which drops the final empty entry: `a@example.com,`
would become `a@example.com`. All three browsers retain that entry instead.
Eric approved preserving the final empty field and following browser behavior
for the future email control. The microsyntax helper already supplies that
behavior; Infra's algorithm and its other consumers remain unchanged.

Source evidence agrees with the probe:
[Chromium EmailInputType](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/html/forms/email_input_type.cc)
uses `StringView::Split(',')`, which preserves empty entries;
[WebKit EmailInputType](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/EmailInputType.cpp)
uses `splitAllowingEmptyEntries(',')`; and
[Firefox HTMLInputElement](https://github.com/mozilla-firefox/firefox/blob/main/dom/html/HTMLInputElement.cpp)
explicitly checks `separatorAfterCurrentToken()` as well as `hasMoreTokens()`
when reconstructing the sanitized list, preserving a terminal empty field.

### 2.3E: references, media, and identity

[`references.ts`](references.ts) supplies `parseHashNameReference(input)`, returning
the nonempty suffix after the first hash or `null`. It performs no URL parsing,
percent decoding, whitespace trimming, case folding, or DOM lookup. The
[reference tests](../../../../test/browlet/html/microsyntaxes/references.test.ts)
exercise that string-only contract.

HTML §2.3.9 combines text parsing with target lookup, but its only current caller
is [`img usemap` processing](https://html.spec.whatwg.org/multipage/image-maps.html#image-map-processing-model).
The reviewed split leaves `findImageMap(input, scope)` with
[HTML's embedded elements](../../dom/nodes/html/embedded/image-map.ts), specialized
to HTML `map` elements. It accepts the complete `usemap` value and calls the
text parser before looking up the first matching `id` or `name` in ordinary
tree order, including an element root. For example, `prefix#target` parses as
`target` and can resolve to a map with that name or id. A missing target returns
`null`; the caller can repeat the lookup after tree changes.
The [image-map tests](../../../../test/browlet/dom/nodes/html/embedded/image-map.test.ts)
retain ordering, detached/shadow-tree, namespace, attribute, and malformed-input cases.

The 2026-10-11 [browser probe](../../../../node-compat/experimental/image-map-references/browser-behavior.mjs)
used real clicks on an image to distinguish a matched `area` from the image
itself. Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5 agreed:

- `#target`, `prefix#target`, an unrelated URL ending in `#target`, and a
  whitespace prefix all associate with a map named `target` in the same tree.
- Matching by `id` alone also works, including with a prefix before the hash.
- No hash, an empty suffix, a missing target, different case, or an unmatched
  additional hash produces no association. The attribute value is retained.
- A dangling `#later` reference starts working when its map is inserted,
  stops when it is removed, and works again after reinsertion.

The inspected lookup paths agree: Blink's `TreeScope::GetImageMap()`, Gecko's
`nsImageLoadingContent::FindImageMap()`, and WebKit's
`parseHTMLHashNameReference()` plus `TreeScope::getImageMap()` search after the
first hash and resolve by name or id. They do not apply the stricter authoring
definition as a runtime precondition. This is not a `SPEC_CLASH`: HTML expressly
distinguishes author conformance from required runtime recovery. Browlet exposes
the runtime lookup only; the unused authoring-conformance checker was removed.

The pointer scan is provisional for performance. Tree-owned id/name indexes
should eventually supply the first matching map and track relevant mutations.
Image-element association and hit testing remain with the future element
implementation; no empty element class or index service is introduced here.
Microsyntaxes has no DOM dependency and sits one level above Browlet's platform,
timing, DOM infra, and style foundations. Its current runtime dependencies are
Infra and Stylelet's color facilities; the hierarchy also permits it to consume
Browlet's style integration when needed. Embedded HTML has a separate hierarchy
entry above the shared node implementations.

The 2026-10-11 audit retains the two approved stopping points:

- Defer active media matching until a concrete consumer needs it. The
  [style roadmap](../../style/ROADMAP.md#media-matching) identifies stylesheet
  applicability, source selection, and `matchMedia()` as consumers. Stylelet
  has parsing and value resolution, but no active-environment matcher was found
  in the audit. `getActiveStyleSheets()` still checks only the disabled flag.
  Choose the operation and its inputs with the first
  caller; do not preassign it to Environment or Agent. Include HTML's
  empty/ASCII-whitespace rule when that caller uses §2.3.10, without substituting
  constant answers for matching or starting a Media Queries/layout project here.
- Unique internal values already have consumers: [Agent signifiers](../../scripting/agents.ts)
  and [Navigable IDs](../../browsing/navigation/navigable.ts), as well as
  [timer handles](../../scripting/timers.ts), currently use Symbols. Keep that
  representation for their in-memory identity until a caller needs it to
  survive serialization. HTML's serializable, comparable-by-value contract
  remains an outstanding requirement at that boundary; UUIDs are an option,
  not a decided replacement. Do not add an identifier service, registry, or
  unused `unique-value.ts` before that consumer establishes the required scope.

These are unfinished integrations, not specification gaps or implemented
substitutes. Slice E adds no media or identity service. The bounded HTML pass
can continue to §2.4 URLs next.

Reference parsing and image-map lookup have separate focused suites alongside
the existing microsyntax cases.

## Dependency and validation discipline

Before each slice, recheck its dependencies and existing callers. Code against
the contracts we need; leave genuinely missing dependencies visible, including
TypeScript failures when appropriate, for review. Stubs, skips, and substitute
behavior require an explicit decision; do not hide a missing subsystem to make
the slice green. A slice can close with an agreed, recorded dependency gate.

Put focused tests under `test/browlet/html/microsyntaxes/`, retaining DOM/style
integration tests with their owners. Use direct tests for realm-neutral value
algorithms and projected tests for existing author-facing consumers. Preserve
specification errors and distinguish them from caller-applied defaults. New
subsystem entry points must obey the existing barrel and hierarchy rules.

## Removal condition

Burn this file when every microsyntax used by implemented HTML behavior has a
single tested semantic owner.
