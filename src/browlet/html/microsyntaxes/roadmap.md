# HTML microsyntaxes roadmap

HTML §2.3 defines reusable value syntax and parsing behavior consumed by
elements, reflection, parsing, and loading. This directory should own those
value algorithms, not content-attribute access or element-specific state.

| Planned source | Contract | Specification |
| --- | --- | --- |
| `boolean.ts` | Boolean-attribute presence and conforming-value rules | HTML §2.3.2 |
| `enumerated.ts` | Keyword/state maps, missing/invalid/empty defaults, and canonical keywords | HTML §2.3.3 |
| `numbers.ts` | Integers, non-negative integers, floating-point values, percentages, dimensions, and numeric lists | HTML §2.3.4 |
| `dates.ts` | Months, dates, times, time zones, weeks, durations, and vague moments | HTML §2.3.5 |
| `legacy-color.ts` | HTML legacy-color parsing without replacing Stylelet's CSS color semantics | HTML §2.3.6 |
| `tokens.ts` | Space- and comma-separated token forms and uniqueness rules | HTML §§2.3.7–2.3.8 |
| `references.ts` | Hash-name references resolved against Browlet trees | HTML §2.3.9 |
| `unique-value.ts` only when a consumer appears | Unexposed serializable identity values | HTML §2.3.11 |

Common parser idioms should reuse Infra string/code-point operations. Introduce
a shared cursor helper only after multiple implemented parsers demonstrate the
same mechanism. HTML §2.3.10 media-query matching belongs to Stylelet plus
Browlet's environment adapter, not this directory.

Reflection code selects and applies these algorithms but must not duplicate
them. Element-specific sanitization and validation remain with the relevant
element family.

## Removal condition

Burn this file when every microsyntax used by implemented HTML behavior has a
single tested semantic owner.
