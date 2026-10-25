# CSSOM media roadmap

The [README](README.md) describes the current list object. Its parsing and
mutation paths have regression coverage; condition evaluation remains separate.

## Consumer connections

- [ ] Connect future CSSMediaRule instances to the same MediaList contract.
  Rule construction belongs in [rules/](../rules/ROADMAP.md).
- [ ] Connect stylesheet applicability and changes through the
  [media-matching owner](../../conditional/ROADMAP.md#media-matching).
  Retaining queries does not determine whether they match a device.

## Media-query disagreements

Three-engine probes and the retained media-list browser regressions establish
the following choices, rechecked with Playwright 1.62.1. Revisit the markers
when the specifications or engines converge.

- `SPEC_CLASH(media-query-only-serialization)`: CSSOM's
  [serializer](https://drafts.csswg.org/cssom/#serialize-a-media-query) only emits
  `not`. Preserve `only`, following Chromium, Firefox, and WebKit; for example,
  `ONLY Screen AND (color)` becomes `only screen and (color)`.
- `SPEC_CLASH(media-query-trailing-comma)`: Media Queries delegates list splitting
  to Syntax's [comma-list algorithm](https://drafts.csswg.org/css-syntax-3/#parse-comma-separated-list-of-component-values),
  which drops the final empty arm. Preserve it specifically for media queries,
  as all three engines do: `screen,` becomes `screen, not all`. The general
  Syntax entry point is unchanged. A comma inside a folded block is not a separator.
- `SPEC_GAP(media-general-enclosed-serialization)`: Media Queries defines
  [`<general-enclosed>`](https://drafts.csswg.org/mediaqueries-4/#typedef-general-enclosed),
  but CSSOM's older serializer does not cover it. Retain token-based serialization,
  as WebKit does: `future(a,` becomes `future(a,)`, and repeated whitespace
  collapses. Chromium and Firefox preserve source text, including missing
  closers and comments. Unknown grammar remains opaque; its function names
  are not treated as interpreted CSS function keywords.
- `SPEC_CLASH(media-list-mutation-comparison)`: Keep CSSOM's
  [append](https://drafts.csswg.org/cssom/#dom-medialist-appendmedium) and
  [delete](https://drafts.csswg.org/cssom/#dom-medialist-deletemedium) behavior,
  matching Chromium/WebKit: an equivalent append leaves order unchanged; deletion
  removes all matching entries. Firefox moves an existing query to the end on
  append. All three browsers now delete every matching entry.
- `SPEC_CLASH(media-list-mutation-input)`: Keep CSSOM's
  [single-query parsing](https://drafts.csswg.org/cssom/#parse-a-media-query)
  and Chromium's mutations: empty or multiple-query inputs are no-ops; invalid
  single queries recover as `not all`. The table below records the other engines.
  Each browser/input pair has a separate expected failure so convergence surfaces.

Starting from `screen`, append and then delete the same input:

| Input | Firefox | WebKit |
| --- | --- | --- |
| Empty string | Both operations throw NotFoundError; unchanged. | Append does nothing; delete throws NotFoundError. |
| `,` | Append does nothing; delete throws NotFoundError. | Appends two `not all` entries; delete throws NotFoundError, retaining them. |
| `screen, print` | Append does nothing; delete removes `screen`. | Appends both entries, including duplicate `screen`; delete throws NotFoundError. |
| `&` | Append does nothing; delete throws NotFoundError. | Appends `not all`; delete removes it. |

