# Infra translation notes

This is a checklist for translating WHATWG algorithms into TypeScript. It is
not an implementation plan for Infra and should stay substantially shorter than
the specification.

## Default posture

- Reproduce the required result, not the specification's pseudocode shape.
- Algorithmic imperatives are mandatory even when the introducing prose does
  not explicitly say "must". Plain "or" is inclusive unless the specification
  says otherwise.
- Do not add an Infra abstraction when a native JavaScript operation has the
  same semantics.
- Add a shared helper only when the behavior recurs, is easy to mistranslate,
  or differs materially from the obvious native operation.
- Treat omitted arguments as distinct from supplied values when the algorithm
  tests whether an argument "was given".
- Infra optional boolean algorithm parameters always declare a default, and
  that default is false. Do not infer a different truthy or tri-state default.
- Do not mechanically translate Infra assertions into runtime checks. A failed
  assertion denotes a specification defect; validate only where the runtime can
  actually receive invalid input.
- Do not add arbitrary limits to otherwise unbounded algorithm inputs without
  an implementation reason.
- Infra `abort when` means checking the condition before each described step
  (or an observably equivalent scheme), not an asynchronous interruption at an
  arbitrary instruction.

## Translation warnings

- Infra's exact 64-bit and 128-bit integer ranges exceed JavaScript's safe
  integer range. Use `bigint` or another exact representation when an internal
  algorithm needs the full range; do not infer exactness from a `number` type.
- Infra strings are JavaScript UTF-16 strings. `length`, indexing, `slice()`,
  `startsWith()`, `endsWith()`, comparison, and default string sorting operate
  on code units, without Unicode normalization. Canonically equivalent strings
  can therefore be unequal.
- Code-point operations need code-point iteration. Do not use code-unit indices
  for code-point lengths or substrings.
- A scalar-value string contains no surrogate code points. Conversion replaces
  unpaired surrogates with U+FFFD; `String.prototype.toWellFormed()` performs
  exactly this part of Web IDL `USVString` conversion. It does not perform
  broader syntax preprocessing such as newline normalization or NUL replacement.
- Unicode noncharacters are still scalar values. Scalar-value conversion
  excludes surrogates; it does not reject or replace noncharacters.
- Infra ASCII whitespace is exactly TAB, LF, FF, CR, and SPACE. JavaScript
  `trim()` and `\s` recognize more characters.
- Infra ASCII lowercasing and uppercasing affect only ASCII letters. Generic
  `toLowerCase()` and `toUpperCase()` affect non-ASCII text.
- A byte sequence should normally be represented by `Uint8Array`, not an
  unconstrained number array or a string.
- Isomorphic encoding maps each U+0000--U+00FF code point directly to the byte
  with the same value, and decoding performs the inverse. It is not UTF-8;
  implement the direct mapping instead of relying on an encoding label.
- `null`, failure, an omitted value, and JavaScript `undefined` are distinct
  concepts unless the consuming algorithm explicitly identifies them.
- Infra tuple/list multiple assignment requires exact arity. Check the size
  first when the value can originate from uncontrolled input; JavaScript
  destructuring would silently fill or discard values.
- An Infra string position variable advances by code points. A JavaScript
  numeric string index advances by code units, so a position variable cannot be
  translated blindly when non-BMP text or unpaired surrogates are possible.
- The three Infra split operations differ. Strict splitting preserves empty
  input and trailing empty tokens. ASCII-whitespace splitting discards empty
  tokens. Comma splitting returns an empty list for empty input and omits a
  trailing empty token, while preserving leading and interior empty tokens and
  trimming only ASCII whitespace around each token.

## Data structures

- List: normally a dense array. Infra list removal removes every matching item,
  and list replacement replaces every matching item. Except for an explicit
  existence test, Infra forbids out-of-bounds indexing; do not use an
  `undefined` array read as an implicit existence check when `undefined` could
  be an item.
- Infra list reversal and sorting create new collections and preserve the
  collection's designation; JavaScript `reverse()` and `sort()` mutate. Infra
  sorting is stable. A boolean less-than algorithm must be adapted in both
  directions to JavaScript's negative/zero/positive comparator contract.
- Stack: normally an array used only through push, pop, and peek-style access.
  Consume it with a `while` loop rather than ordinary iteration. Do not create a
  stack class unless a concrete invariant needs enforcement. If `undefined`
  can be a valid item, test emptiness separately because `pop()` cannot
  distinguish it from an empty stack.
- Queue: an array is semantically sufficient; use a head index or deque only
  when repeated front removal is performance-relevant.
- Ordered set: use `Set` for append, containment, removal, and ordered
  iteration. It is not a complete Infra ordered set when an algorithm needs
  indexing, prepend, positional replacement, or designation-preserving slices.
  Choose the representation for the actual operations instead of introducing a
  universal ordered-set class. Set equality ignores order. Replacement keeps
  the earliest position occupied by either the old item or its replacement and
  removes the other occurrence; it is not ordinary delete-then-add.
- Ordered map: normally `Map`. Check the consuming algorithm's key-equality
  assumptions; Infra itself does not fully define general map-key equality.
  Native `Map` and `WeakMap` compare object keys by identity, so they are not a
  faithful translation when an Infra key is a value-like tuple or struct. In
  that case, derive a canonical primitive key or use an equality-aware map;
  preserve distinct opaque identities rather than keying their common
  serialization.
  Use `has()` when absence must be distinguished from a stored `undefined`.
  Infra's keys and values operations create new collections, not live
  iterators, and map sorting creates a new stable map rather than reordering the
  original.
- Struct: normally an object or class. Tuple: normally a TypeScript tuple.
  Infra's fixed item names do not imply that runtime objects must be frozen.
- Cloning an Infra list or map is shallow unless another algorithm says
  otherwise.

## Algorithms worth exact helpers when consumed

- Scalar-value-string conversion.
- ASCII whitespace stripping, collapsing, and splitting.
- Isomorphic byte/string encoding and decoding.
- Forgiving Base64; do not assume Node's permissive Base64 decoder is exact.
  It removes only ASCII whitespace, permits omitted padding, rejects a length
  congruent to 1 modulo 4, and does not require discarded trailing bits to be
  zero. Trailing padding is removed only in the form accepted by the algorithm.
- JSON-to-Infra conversion when a realm-independent map/list is required.
  Infra-map serialization creates a null-prototype JavaScript object, and its
  JSON string serializer throws when `JSON.stringify()` returns `undefined`.

## Platform constants

- Infra defines the HTML, MathML, SVG, XLink, XML, and XMLNS namespace strings.
  Keep one shared source of truth when multiple engines consume them; these are
  web-platform constants rather than state owned by a DOM implementation.

## Not runtime machinery

- A tracking vector is a privacy-review annotation, not a data structure.
- Infra assertions, algorithm prose conventions, and the `allowed`, `blocked`,
  `success`, and `failure` singletons do not require universal runtime classes.
  Use a distinct sentinel or result type only when a singleton must be
  distinguished from every ordinary return value; do not automatically map
  failure to `null` or `undefined` when either can also be a valid result.
- Time delegates to High Resolution Time; do not invent an Infra clock.
