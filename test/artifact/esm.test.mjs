import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const importArtifact = name => import(pathToFileURL(path.resolve(
  dirname,
  `../../packages/${name}/dist/index.mjs`,
)));

const [selectlet, stylelet, browlet] = await Promise.all([
  importArtifact('selectlet'),
  importArtifact('stylelet'),
  importArtifact('browlet'),
]);

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

if (Object.keys(browlet).join(',') !== 'Browlet') {
  throw new Error(
    `Expected only Browlet export, got ${Object.keys(browlet).join(', ')}`,
  );
}

console.log('esm artifacts passed');
