# selectlet

A browser-aligned CSS selector engine for JavaScript DOM implementations.

`selectlet` is a TypeScript modernization and architectural fork of `nwsapi`.

The engine is tested against thousands of selector cases in Chromium, Firefox,
and WebKit, including the original `nwsapi` coverage plus additional cases for
modern selector behavior, XML/HTML differences, namespaces, fragments, detached
contexts, escaping, attributes, and Selectors Level 4 features such as `:is()`,
`:where()`, `:not()`, and `:has()`.

The package is currently pre-1.0 while the public package/API shape and jsdom
integration are still being finalized.
