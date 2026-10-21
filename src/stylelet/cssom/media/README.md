# CSSOM media lists

[MediaListImpl](media-list.ts) retains parsed media queries and implements
CSSOM's text replacement, indexed access, append, and delete operations. Its
Web IDL declaration lives beside the implementation; Binding supplies the
Platform object's conversions and indexed properties.

The export-only [barrel](index.ts) is an entry point below rules and sheets.
This object imports the [media-query grammar](../../values/media-query.ts)
and Web IDL Core; it does not import stylesheet or rule implementations.

Parsing and serialization remain in `values/`. Device matching and condition
applicability belong to [conditional/](../../conditional/README.md), which
does not yet supply a media evaluator. The [roadmap](ROADMAP.md) preserves
the reviewed browser differences and missing consumer connections.

[Unit tests](../../../../test/stylelet/unit/cssom/media/media-list.test.ts),
[binding tests](../../../../test/browlet/style/media-list.test.ts), and
[browser scenarios](../../../../test/stylelet/scenarios/media-list.test.ts)
cover list behavior, projection, and the separate native-browser disagreements.
