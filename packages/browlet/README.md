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
```

Browlet is under active development.

## License

MIT
