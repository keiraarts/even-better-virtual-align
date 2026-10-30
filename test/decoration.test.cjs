const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
let maxPadding = 0;
const types = [];
const vscode = {
  Position: class { constructor(line, character) { Object.assign(this, {line, character}); } },
  Range: class { constructor(start, end) { Object.assign(this, {start, end}); } },
  workspace: {getConfiguration: () => ({get: () => maxPadding})},
  window: {createTextEditorDecorationType(options) {
    const type = {options, disposed: false, dispose() {this.disposed = true;}};
    types.push(type);
    return type;
  }}
};
const originalLoad = Module._load;
Module._load = function(id, ...args) {return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);};
const { DecorationManager } = require('../out/view/DecorationManager');
Module._load = originalLoad;
const { ParserService } = require('../out/parsing/ParserService');
const { groupTokens } = require('../out/logic/Grouper');
const { createMockDocument } = require('../out/test/mocks/MockDocument');
function render(keys, manager = new DecorationManager()) {
  const content = JSON.stringify(Object.fromEntries(keys.map(key => [key, 'translation'])), null, 2);
  const document = createMockDocument(content, 'json');
  const parser = new ParserService({wasmDir: ''});
  const groups = groupTokens(parser.parseJsonWithRegex(document, 0, document.lineCount - 1));
  const padding = new Map();
  const editor = {document, setDecorations(type, ranges) {
    for (const range of ranges) padding.set(range.start.line, type.options.before.width ? Number.parseInt(type.options.before.width) : type.options.before.contentText.length);
  }};
  manager.update(editor, groups);
  return {manager, editor, padding, content, groups};
}
test('all screenshot keys align, including padding above 50', () => {
  maxPadding = 0;
  const result = render(['Option', 'Options', 'Quantity', 'Additional Information', 'Please provide the following information for {productTitle}']);
  assert.deepEqual([...result.padding.values()], [53, 52, 51, 37]);
  assert.equal(result.editor.document.getText(), result.content);
  result.manager.dispose();
});
test('limit caps padding instead of dropping a row and updates on refresh', () => {
  maxPadding = 20;
  const result = render(['a', 'b'.repeat(100)]);
  assert.equal(result.padding.get(1), 20);
  maxPadding = 0;
  result.manager.update(result.editor, result.groups);
  assert.equal(result.padding.get(1), 99);
  result.manager.dispose();
});
test('50 and 51 columns both render', () => {
  maxPadding = 0;
  const result = render(['a', 'bb', 'x'.repeat(52)]);
  assert.deepEqual([...result.padding.values()], [51, 50]);
  result.manager.dispose();
});
test('empty groups and one property create no decoration', () => {
  const result = render(['a']);
  assert.equal(result.padding.size, 0);
  result.manager.update(result.editor, []);
  result.manager.dispose();
});
test('oversized padding uses a CSS width instead of a large string', () => {
  maxPadding = 0;
  const start = types.length;
  const result = render(['a', 'z'.repeat(10000)]);
  assert.equal(result.padding.get(1), 9999);
  assert.equal(types[start].options.before.contentText.length, 1);
  result.manager.dispose();
});
test('shared cache stays bounded and transient decorations are disposed', () => {
  maxPadding = 0;
  const start = types.length;
  const result = render(Array.from({length: 80}, (_, i) => 'k'.repeat(i + 1)));
  assert.equal(result.padding.size, 79);
  assert.ok(types.slice(start).filter(type => !type.disposed).length === 79);
  result.manager.clear(result.editor);
  assert.ok(types.slice(start).filter(type => !type.disposed).length <= 50);
  assert.ok(types.slice(start + 50).every(type => type.disposed));
  result.manager.dispose();
  assert.ok(types.slice(start).every(type => type.disposed));
});
test('clearing one editor preserves another editor decorations', () => {
  maxPadding = 0;
  const manager = new DecorationManager();
  const first = render(['a', 'z'.repeat(100)], manager);
  const second = render(['a', 'z'.repeat(100)], manager);
  manager.clear(first.editor);
  assert.equal(second.padding.get(1), 99);
  assert.ok([...manager.decorationTypes.values()].every(type => !type.disposed));
  manager.dispose();
});
test('invalid limits safely fall back to unlimited padding', () => {
  for (const value of [undefined, null, -1, 1.5, '20', NaN, Infinity]) {
    maxPadding = value;
    const result = render(['a', 'z'.repeat(100)]);
    assert.equal(result.padding.get(1), 99);
    result.manager.dispose();
  }
});
test('hiding an editor disposes its transient decorations', () => {
  maxPadding = 0;
  const start = types.length;
  const result = render(Array.from({length: 80}, (_, i) => 'k'.repeat(i + 1)));
  result.manager.clearHiddenEditors([result.editor]);
  assert.equal(types.slice(start).filter(type => type.disposed).length, 0);
  result.manager.clearHiddenEditors([]);
  assert.ok(types.slice(start + 50).every(type => type.disposed));
  result.manager.dispose();
});
