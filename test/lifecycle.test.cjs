const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const { ParserService } = require('../out/parsing/ParserService');
const { createMockDocument } = require('../out/test/mocks/MockDocument');
const events = {};
const commands = {};
const pending = [];
const scopes = [];
let enabledLanguages = {};
const vscode = {
  Position: class { constructor(line, character) { Object.assign(this, {line, character}); } },
  Range: class { constructor(start, end) { Object.assign(this, {start, end}); } },
  StatusBarAlignment: {Right: 2},
  commands: {registerCommand(name, callback) {commands[name] = callback; return {dispose() {}};}},
  workspace: {
    getConfiguration(section, document) {
      scopes.push(document);
      return {get: (key, fallback) => key === 'maxPadding' ? document.cap : key === 'enabledLanguages' ? enabledLanguages : fallback};
    },
    onDidChangeTextDocument(callback) {events.text = callback; return {dispose() {}};},
    onDidChangeConfiguration(callback) {events.config = callback; return {dispose() {}};},
  },
  window: {
    visibleTextEditors: [],
    createTextEditorDecorationType(options) {return {options, dispose() {}};},
    createOutputChannel() {return {appendLine() {}, dispose() {}};},
    createStatusBarItem() {return {show() {}, dispose() {}};},
    onDidChangeActiveTextEditor(callback) {events.active = callback; return {dispose() {}};},
    onDidChangeVisibleTextEditors(callback) {events.visible = callback; return {dispose() {}};},
    showErrorMessage() {},
    showInformationMessage() {},
  },
};
const originalLoad = Module._load;
Module._load = function(id, ...args) {return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args);};
const extension = require('../out/extension');
Module._load = originalLoad;
function editor(cap) {
  const document = {...createMockDocument('{\n "a":1,\n "longer":2\n}', 'json'), cap};
  const applied = new Map();
  return {document, applied, setDecorations(type, ranges) {applied.set(type, ranges);}};
}
async function completeParses() {
  pending.splice(0).forEach(resolve => resolve());
  await new Promise(setImmediate);
}
test('settings refresh all visible editors and late parses cannot restore hidden or disabled decorations', async () => {
  const initialize = ParserService.prototype.initialize;
  const parse = ParserService.prototype.parse;
  ParserService.prototype.initialize = async function() {};
  ParserService.prototype.parse = function(document, start, end) {
    const tokens = this.parseJsonWithRegex(document, start, end);
    return new Promise(resolve => pending.push(() => resolve(tokens)));
  };
  try {
    await extension.activate({subscriptions: [], extensionPath: process.cwd()});
    const first = editor(3);
    const second = editor(1);
    vscode.window.visibleTextEditors = [first, second];
    events.config({affectsConfiguration: () => true});
    assert.equal(pending.length, 2);
    await completeParses();
    for (const current of [first, second]) {
      assert.ok(scopes.includes(current.document));
      assert.ok([...current.applied].some(([type, ranges]) => ranges.length && type.options.before.width === `${current.document.cap}ch`));
    }
    events.config({affectsConfiguration: () => true});
    vscode.window.visibleTextEditors = [];
    events.visible([]);
    await completeParses();
    for (const current of [first, second]) {
      assert.ok([...current.applied.values()].every(ranges => ranges.length === 0), 'hidden editor must stay clear after pending parse');
    }
    vscode.window.visibleTextEditors = [first];
    events.config({affectsConfiguration: () => true});
    enabledLanguages = {json: false};
    events.config({affectsConfiguration: () => true});
    await completeParses();
    assert.ok([...first.applied.values()].every(ranges => ranges.length === 0), 'disabled language must stay clear after pending parse');
    enabledLanguages = {};
    events.config({affectsConfiguration: () => true});
    commands['even-better-virtual-align.disable']();
    await completeParses();
    assert.ok([...first.applied.values()].every(ranges => ranges.length === 0), 'disabled alignment must stay clear after pending parse');
  } finally {
    extension.deactivate();
    ParserService.prototype.initialize = initialize;
    ParserService.prototype.parse = parse;
  }
});
