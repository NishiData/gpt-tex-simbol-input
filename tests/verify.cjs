// Run with: node tests/verify.cjs
// Event-level tests with a mocked textarea; not a live-browser compatibility test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const listeners = {};
const storageListeners = [];
let active;
let failInsert = false;
class Element {}
class HTMLTextAreaElement extends Element {
  constructor(value) {
    super(); this.value = value; this.selectionStart = value.length;
    this.selectionEnd = value.length; this.disabled = false; this.readOnly = false;
  }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}
const document = {
  addEventListener(name, listener) { listeners[name] = listener; },
  execCommand(name, showUI, value) {
    assert.equal(name, 'insertText');
    if (failInsert) return false;
    active.value = active.value.slice(0, active.selectionStart) + value + active.value.slice(active.selectionEnd);
    active.setSelectionRange(active.selectionStart + value.length, active.selectionStart + value.length);
    return true;
  }
};
const context = vm.createContext({Element, HTMLTextAreaElement, document,
  chrome: {storage: {local: {get(defaults, cb) { cb(defaults); }},
    onChanged: {addListener(cb) { storageListeners.push(cb); }}}}});
for (const file of ['symbols.js', 'content.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename: file});
}
let count = 0;
function check(label, input, expected, options = {}) {
  active = new HTMLTextAreaElement(input);
  if (options.caret != null) active.setSelectionRange(options.caret, options.caret);
  if (options.selection) active.setSelectionRange(...options.selection);
  if (options.readOnly) active.readOnly = true;
  if (options.disabled) active.disabled = true;
  const event = {target: active, key: ' ', preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() {}, ...options.event};
  if (options.composing) listeners.compositionstart({target: active});
  listeners.keydown(event);
  assert.equal(active.value, expected, label);
  if (expected !== input) assert.equal(event.defaultPrevented, true, label + ' consumes Space');
  else assert.notEqual(event.defaultPrevented, true, label + ' leaves key alone');
  if (options.composing) listeners.compositionend({target: active});
  count++;
}
check('Greek conversion', '\\alpha', 'α');
check('preserve Japanese prefix', 'モジュライは\\tau', 'モジュライはτ');
check('preserve suffix and caret', 'x=\\alpha + y', 'x=α + y', {caret: 8});
assert.equal(active.selectionStart, 3);
check('nested source symbol', 'D_{\\tau', 'D_{τ');
check('blackboard braces', '\\mathbb{C}', 'ℂ');
check('capital Greek', '\\Gamma', 'Γ');
check('unknown command', '\\fractions', '\\fractions');
check('fraction untouched', '\\frac{a}{b}', '\\frac{a}{b}');
check('escaped command', '\\\\alpha', '\\\\alpha');
check('prototype name untouched', '\\constructor', '\\constructor');
check('case sensitive', '\\ALPHA', '\\ALPHA');
check('Shift bypass', '\\alpha', '\\alpha', {event: {shiftKey: true}});
check('IME event', '\\alpha', '\\alpha', {event: {isComposing: true}});
check('IME legacy', '\\alpha', '\\alpha', {event: {keyCode: 229}});
check('IME composition state', '\\alpha', '\\alpha', {composing: true});
check('Tab untouched', '\\alpha', '\\alpha', {event: {key: 'Tab'}});
check('Enter untouched', '\\alpha', '\\alpha', {event: {key: 'Enter'}});
check('selection untouched', '\\alpha', '\\alpha', {selection: [0, 6]});
check('readOnly untouched', '\\alpha', '\\alpha', {readOnly: true});
check('disabled untouched', '\\alpha', '\\alpha', {disabled: true});
failInsert = true;
check('failed insertion preserves source', '\\alpha', '\\alpha');
assert.equal(active.selectionStart, 6);
assert.equal(active.selectionEnd, 6);
failInsert = false;
storageListeners[0]({enabled: {newValue: false}}, 'local');
check('disabled preference', '\\alpha', '\\alpha');
storageListeners[0]({enabled: {newValue: true}}, 'local');
check('enabled preference', '\\alpha', 'α');
const symbols = context.TEX_SYMBOLS;
assert(Object.keys(symbols).length > 150);
for (const [key, value] of Object.entries(symbols)) {
  assert.match(key, /^[A-Za-z]+$/);
  assert.equal([...value].length, 1);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage']);
for (const file of [...manifest.content_scripts[0].js, manifest.action.default_popup]) {
  assert(fs.existsSync(path.join(root, file)), file);
}
console.log(`${count} behavior checks passed; ${Object.keys(symbols).length} symbols; manifest valid.`);
console.log('This command uses mocks; browser.cjs covers native browser input.');
