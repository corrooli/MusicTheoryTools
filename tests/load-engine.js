// Loads the pure chord engine straight out of reversechordsearch.html.
// The page stays a single self-contained file for GitHub Pages; tests read the
// <script id="engine"> block and evaluate it in an isolated VM context.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEngine(file = 'reversechordsearch.html') {
  const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const match = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`No <script id="engine"> block found in ${file}`);
  const sandbox = { module: { exports: {} } };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox, { filename: `${file}#engine` });
  return sandbox.module.exports;
}

module.exports = { loadEngine };
