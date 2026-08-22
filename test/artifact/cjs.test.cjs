const path = require('node:path');

const selectlet = require(path.resolve(
  __dirname,
  '../../packages/selectlet/dist/index.cjs',
));
const stylelet = require(path.resolve(
  __dirname,
  '../../packages/stylelet/dist/index.cjs',
));
const browlet = require(path.resolve(
  __dirname,
  '../../packages/browlet/dist/index.cjs',
));

if (typeof selectlet.createSelectlet !== 'function') {
  throw new Error(
    `Expected createSelectlet export to be function, got ${typeof selectlet.createSelectlet}`,
  );
}

if (!selectlet.DEFAULT_CONFIG || typeof selectlet.DEFAULT_CONFIG !== 'object') {
  throw new Error(
    `Expected DEFAULT_CONFIG export to be object, got ${typeof selectlet.DEFAULT_CONFIG}`,
  );
}

if (typeof stylelet.Stylelet !== 'function') {
  throw new Error(
    `Expected Stylelet export to be class, got ${typeof stylelet.Stylelet}`,
  );
}

if (typeof browlet.Browlet !== 'function') {
  throw new Error(
    `Expected Browlet export to be class, got ${typeof browlet.Browlet}`,
  );
}

console.log('cjs artifacts passed');
