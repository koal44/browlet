const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../dist/nwsapi.js'), 'utf8');

const document = {
  documentElement: {},
  contentType: 'text/html',
  addEventListener() {},
};

const context = vm.createContext({
  document,
});

vm.runInContext(source, context, { filename: 'dist/nwsapi.js' });

if (typeof context.NW.Dom.select !== 'function') throw new Error('Expected NW.Dom.select');
if (typeof context.NW.Dom.match !== 'function') throw new Error('Expected NW.Dom.match');
if (typeof context.NW.Dom.configure !== 'function') throw new Error('Expected NW.Dom.configure');

console.log('global artifact passed');
