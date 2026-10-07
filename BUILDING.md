# Building Browlet

Browlet runs on stock Node.js. An optional compatibility addon exposes additional
native capabilities. Custom Node builds with our V8 patches extend these further.

## Build from source

```sh
git clone https://github.com/koal44/browlet.git
cd browlet

npm run install:vendor -- undici
npm ci
npm run build
```

The vendor step prepares the [patched Undici dependency](vendor/README.md).

`npm run build` builds Browlet, Selectlet, and Stylelet. To build only the
standalone engines, use `npm run build -- selectlet stylelet`.

## Stock Node.js

Copy [.env.example](.env.example) to `.env` and select the test runtime:

```ini
NODE_BASE=26.8.1
NODE_RUNTIME=stock
```

```sh
npm run install:node
npm run test:unit
```

The installer downloads the selected Node version into `node-compat/.cache`
on Windows and Linux x64.
Node 24.19.0 is also supported; set `NODE_BASE=24.19.0` to select it.

## Browser tests

The Selectlet and Stylelet browser suites use Playwright's Chromium, Firefox, and
WebKit engines. After selecting and installing a Node runtime:

```sh
npm run install:browsers
npm run test:selectlet:oracle
npm run test:stylelet:oracle
```

On Linux, use `npm run install:browsers -- --with-deps` to also install the required
system libraries.

## Node.js with the compatibility addon

**Why?** The HTML standard requires behavior that stock Node.js cannot fully
provide. Some limitations are in Node's APIs; others are in its V8 engine.
The addon and V8 patches let us implement and test these capabilities to help
motivate upstream improvements in Node.js and V8.

The addon supports Windows and Linux x64 and can be built against official or
custom Node. Follow the [addon setup](node-compat/README.md#build-and-run) and set
`NODE_RUNTIME=compat` in Browlet's `.env`.

## V8 patches

To use the [V8 patches](vendor/_patches/node-v8.patch), start with a separate Node.js
source checkout and follow Node's build prerequisites for
[Windows](https://github.com/nodejs/node/blob/6f41e415639b5ec3dd816e44945cc73b4d7651e3/BUILDING.md#windows-prerequisites) or
[Linux](https://github.com/nodejs/node/blob/6f41e415639b5ec3dd816e44945cc73b4d7651e3/BUILDING.md#unix-prerequisites).
From that checkout, apply the patch using the path to your Browlet checkout:

```sh
git switch --detach 6f41e415639b5ec3dd816e44945cc73b4d7651e3
git apply "/path/to/browlet/vendor/_patches/node-v8.patch"
```

Build on Windows:

```powershell
.\vcbuild.bat release x64
```

Or on Linux:

```sh
./configure
make -j4
```

Then select the custom build in Browlet's `.env`:

```ini
NODE_BASE=custom
NODE_RUNTIME=compat
CUSTOM_NODE_SOURCE=/path/to/node
```

Back in the Browlet checkout, build the addon against it and run the tests:

```sh
npm run build:node-compat
npm run test:unit
```
