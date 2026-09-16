# HTML parser roadmap

## Present

- `parse.ts` is the synchronous parse convenience over an existing or newly
  constructed Browlet Document.
- `tree-adapter.ts` maps parse5 tree operations to Browlet DOM algorithms.
  Its private source-location stamp keeps optional parser metadata on each
  `NodeImpl`, with parse5 types confined to the parser module. The streaming
  parser enables these locations; Browlet reads script start-tag positions
  to preserve document-relative line numbers in inline-script stack traces.
- `document-parser.ts` enters and resumes parsing through HTML networking tasks.
  It retains the supplied EventLoop and Runtime Context; stylesheet waits and
  script-handler completion use `PromiseValue`. Node's stream-finished callback
  only queues document finalization back into HTML. `Browlet.navigate()` keeps
  a native Promise at its outer Node API boundary.

This is enough for Browlet's current document shell, but it is not yet a
general HTML parser integration. In particular, the tree adapter's
`insertTextBefore()`, `setTemplateContent()`, and `getTemplateContent()` hooks
are unimplemented. Misnested table text and every `template` element can
therefore reach an intentional exception.

## First closure slice

Add public parse-behavior tests before changing the adapter. At minimum they
must cover foster-parented table text, ordinary template contents, foreign
SVG/MathML namespaces and attributes, scripting-enabled and scripting-disabled
`noscript`, and context-sensitive fragments. These are adapter contracts; do
not replace them with tests that call individual tree-adapter methods.

Then complete these seams in order:

1. Implement foster-parented text and ordinary template contents, including
   the template contents' correct node document.
2. Make parser insertion, attribute adoption, detachment, and text mutation
   flow through the same DOM insertion/removal and mutation-observer hooks as
   equivalent specified DOM operations. Parsing can batch genuinely
   unobservable style work, but it cannot bypass custom-element reactions,
   connection steps, or mutation records.
3. Retain the adjusted current element/intended parent while parse5 calls
   `createElement()`. The parse5 tree-adapter hook does not pass that parent,
   but HTML's "create an element for the token" algorithm needs it for the
   node document, scoped custom-element registry, form association, and
   parser-inserted state.
4. Derive parse5's `scriptingEnabled` option from the Document/parser scripting
   mode instead of accepting its default unconditionally. Parse errors may be
   retained as optional diagnostics; their specified recovery is not an
   author-facing exception.

## Missing host integration

| Planned source or owner | Contract | Specification |
| --- | --- | --- |
| `fragment.ts` | Context-sensitive fragment parsing, quirks propagation, parser scripting modes, root insertion targets, and declarative shadow roots | HTML §13, "Parsing HTML fragments" |
| `encoding.ts` | Byte-stream decoding, encoding sniffing, `<meta>` extraction, confidence, and navigation restart without a second network fetch | HTML §§2.1.7, 2.5.3, and 13.2 |
| `script-runner.ts` | Parser-inserted scripts, pause/resume, nesting level, pending parsing-blocking script | HTML §§13.2.2 and 13.2.6.4 |
| `dynamic-markup.ts` | `document.open()`, `close()`, `write()`, and `writeln()` over the active parser, including reentrancy, destructive-write guards, and script insertion points | HTML §8.4 |
| Existing `document-parser.ts` plus `browsing/document-lifecycle.ts` | Stop/abort parsing, readiness changes, deferred scripts, `DOMContentLoaded`, load-event delay, and final completion | HTML §13.2, "The end" |
| `preload-scanner.ts` only after ordinary loading works | Optional speculative resource discovery without semantic tree mutation | HTML §13.2, "Speculative HTML parsing" |

parse5 continues to own tokenization, tree construction, insertion modes,
foreign-content rules, the adoption-agency algorithm, named character
references, and parse-error recovery. Its tokenizer and tree builder are
covered by the shared html5lib suites; reimplementing those algorithms would
add a second conformance project without improving Browlet's host integration.
That ownership includes §16's obsolete tag-token and insertion-mode behavior;
obsolete markup is not a separate forgiving parser and must not be filtered
out before tree construction.

parse5 8.0.1 does not implement HTML's newer declarative-shadow-root branch.
That is a demonstrated limitation of the tree-builder surface, not a reason to
fork all of §13. Prefer an upstream contribution or the smallest maintained
extension at that exact branch. Reassess the dependency only if a second
required semantic branch cannot be expressed without growing such a patch.
Blink's `core/html/parser` shows the same conceptual split between tokenizer/
tree builder, document parser, script runner, and preload scanner.

HTML's document-writing syntax is primarily an authoring contract. HTML
fragment serialization belongs to `dom/parsing/`, backed by parse5's serializer
only where its output matches the specified DOM-facing algorithm. Browlet does
not need a runtime copy of the named-character-reference table because parse5's
`entities` dependency already owns it.

The public DOM parsing/serialization methods in HTML §8.5 live under
`dom/parsing/`, but every HTML-producing method must call this one fragment
parser. Dynamic markup insertion is different: it operates on a Document's
active parser and therefore remains here. Its script execution and parser
pause/resume behavior consume `scripting/` rather than calling JavaScript
directly from parse5 callbacks.

The parser is the first concrete consumer of HTML's "spin the event loop"
macro. Node does not expose a supported operation to copy, empty, and restore
V8's JavaScript execution-context stack, so do not manufacture a synchronous
general-purpose helper. When parser-inserted scripts enter, lower each spinning
algorithm into an explicit continuation which checkpoints, stops the current
parser task, waits outside the event loop, and queues the remaining steps on
the original task source. Preserve the distinction between blocking this
parser instance and pausing the entire event loop.

HTML §13.2.6.4 places two distinct boundaries before a parser-inserted script
runs. With no active speculative parser, it first performs a microtask
checkpoint when the JavaScript execution-context stack is empty. Only after
preparing the script does it spin the event loop when a style sheet blocks
scripts or the script is not ready.
`document-parser.ts` now explicitly requests the conditional checkpoint and
resumes synchronous handlers in the current task. A blocked stylesheet wait or
an internal asynchronous script result resumes through a later networking task.
The stylesheet condition is checked again before execution, since a new blocker
can appear before the continuation runs. Parsing starts in an HTML task rather
than a Node Promise job; this does not expose arbitrary V8 execution contexts.

The future `script-runner.ts` still needs the complete script-preparation and
readiness model, parser nesting and abort handling, and the separate preparation
point after restoring the insertion mode. Parse5 provides one script callback
before popping the script element, where the checkpoint belongs. Actual external
stylesheet loading is not connected to the Document's blocker set yet. CSSOM's constructed-sheet
`replace()` is a separate operation, not that loading gate. These remain
incomplete HTML integration, not Node accommodations.

## Removal condition

Burn this file when the adapter closure, fragment parsing, byte decoding and
restart, parser-script lifecycle, and stop/abort lifecycle are integrated, and
the speculative-loading decision has moved to `loader/`.
