# Browlet

Browlet is a browser-like TypeScript runtime. It brings together the repository's DOM, Web IDL, URL, HTML lifecycle, and CSS work behind a higher-level API.

## Installation

```sh
npm install browlet
```

## Usage

```js
import { Browlet } from 'browlet';

const browser = new Browlet({
  route(url) {
    return `<h1>${url}</h1>`;
  },
});

await browser.navigate('https://example.test/');
const pageURL = await browser.evaluate(() => document.URL);
```

`evaluate()` serializes the supplied function, runs it in the page, awaits its
result, and copies the result back to Node. Prefer functions so TypeScript can
check the code and infer its result. Pass data through the second argument;
local closures are not transferred. Source strings are also supported when
you need to evaluate script text directly.

Use `await browser.exposeFunction(name, callback)` for a page-to-host callback.
Calling it in the page returns a page Promise; arguments and results are
copied, and callbacks remain installed after navigation. Live DOM objects and
function arguments require handles, which are not implemented yet.

Browlet is under active development.

## License

MIT
