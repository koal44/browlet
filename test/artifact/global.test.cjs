const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../dist/selectlet.js'), 'utf8');

const document = {
  documentElement: {},
  contentType: 'text/html',
  addEventListener() {},
};

const context = vm.createContext({
  document,
});

vm.runInContext(source, context, { filename: 'dist/selectlet.js' });

if (typeof context.selectlet.select !== 'function') throw new Error('Expected selectlet.select');
if (typeof context.selectlet.match !== 'function') throw new Error('Expected selectlet.match');
if (typeof context.selectlet.configure !== 'function') throw new Error('Expected selectlet.configure');

console.log('global artifact passed');
