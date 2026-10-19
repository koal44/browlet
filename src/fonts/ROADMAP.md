# Fonts roadmap

Planned shared font resources, face selection, metrics, shaping, and Font Loading
state. No font implementation or backend is present yet. CSS properties and
descriptor parsing remain in [Stylelet](../stylelet/props/ROADMAP.md); line
construction belongs to [layout](../layout/ROADMAP.md), and glyph drawing belongs
to graphics/output. A font-relative length helper does not supply these systems.

## Sources and ownership

Use local CSSWG `css-fonts-4/Overview.bs` and `css-font-loading-3/Overview.bs`,
with earlier requirements and later-level additions reviewed explicitly.
[Font matching](https://drafts.csswg.org/css-fonts-4/#font-matching-algorithm),
[fetching](https://drafts.csswg.org/css-fonts-4/#font-fetching-requirements), and
the loading API's retained-state/readiness contracts were inspected; complete
selection, format, and shaping algorithms remain unaudited.

| Owner | Responsibility |
| --- | --- |
| Fonts | Available/loaded faces, matching and fallback, decoded font data, metrics, shaping operations, and retained loading state |
| Stylelet | Font/text properties, font-face and related CSS rules/descriptors, computed font inputs, and CSS-relative-unit rules |
| Browlet integration | Document/Worker font sets, stylesheet-connected membership, policy/request settings, task delivery, document teardown, and readiness coordination |
| Layout | Text runs, bidi/line construction, wrapping, baselines, and changes caused by newly available fonts |
| Backend | Font decoding, platform font discovery, and any selected native shaping facilities through deliberate Host Ports |

Reuse shared faces and backend facilities through the existing UserAgent where
their lifetime warrants it. Document membership and loading promises have their
own lifetimes; do not turn all of this into a process-wide font registry.

## Missing contracts

- [ ] Preserve sources, loading/failure state, decoded faces, matching results,
  and metrics as distinct concepts. URL loading can consume Fetch with the
  owning environment and specified request settings; binary input still needs
  decoding/validation. Do not give the decoder a Document or a network client.
  CSS font URL requests use destination `font` and CORS mode `cors`.
- [ ] Connect CSS face descriptors and matching to actual available faces,
  fallback, Unicode coverage, variation/feature settings, and font-display
  behavior. Choose supported formats/backend capabilities explicitly.
- [ ] Implement [FontFace](https://drafts.csswg.org/css-font-loading-3/#fontface-interface)
  sources, descriptors, status, and loaded promise, and
  [FontFaceSet](https://drafts.csswg.org/css-font-loading-3/#FontFaceSet-interface)
  membership, load/check operations, events, and readiness.
- [ ] Integrate [FontFaceSource](https://drafts.csswg.org/css-font-loading-3/#font-face-source)
  with Document and WorkerGlobalScope. Reuse the existing DOM event machinery
  and Binding; settle that cross-owner dependency before implementing the
  public FontFaceSet surface rather than creating another event dispatcher.
- [ ] Implement [FontFaceSet.ready](https://drafts.csswg.org/css-font-loading-3/#font-face-set-ready)
  with document/layout coordination. It includes layout work that can discover
  further loads, not merely settlement of current network requests.
- [ ] Supply metrics and shaped runs to actual consumers. Effective em/ex/ch/
  cap/ic and line-height references also depend on CSS rules; they are not all
  raw glyph measurements. Font availability, selected fallback, and style
  changes must invalidate the appropriate style/layout results.

Font feature/variation/palette discovery additions and the Houdini Font Metrics
proposal need their own current-source and backend review before adoption.

## First implementation and checks

Start with a concrete face-data/metrics consumer and deterministic test font,
then connect matching and loading. Test binary and URL failures, fallback changes,
membership, explicit loading, events, and readiness across style/layout changes.
Prove FontFace/FontFaceSet author conversion and identity through bindings.
No backend is selected and no complete loading, shaping, or readiness API is
implied by this folder. Exact module/API boundaries remain implementation work.
