# Stylelet

Stylelet is a TypeScript CSS style engine for JavaScript DOM implementations. It contains the repository's CSS syntax, values, CSSOM, cascade, inheritance, custom-property, and computed-value work.

## Installation

```sh
npm install stylelet
```

## Usage

```js
import { Stylelet } from 'stylelet';

const styles = new Stylelet(document);
const sheet = styles.createStyleSheet();
```

Stylelet is under active development. Its public surface and implemented specification coverage are not yet complete.

## License

MIT
