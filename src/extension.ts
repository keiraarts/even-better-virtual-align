/**
 * Even Better Virtual Align - Virtual code alignment for TypeScript, JSON, and Python.
 *
 * Uses Tree-sitter for reliable parsing and VS Code decorations for
 * visual alignment without modifying files.
 */

import * as path from "path";
import * as vscode from "vscode";
import { VSCodeDocumentAdapter } from "./adapters/VSCodeDocumentAdapter";
import { isSupportedLanguage } from "./core/types";
import { groupTokens } from "./logic/Grouper";
import { ParserService } from "./parsing/ParserService";
import { debounce } from "./utils/debounce";
import { DecorationManager } from "./view/DecorationManager";

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 100;

let parserService: ParserService;
let decorationManager: DecorationManager;
let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;
let enabled = true;
const editorUpdates = new WeakMap<vscode.TextEditor, number>();

/**
 * Updates the status bar item to reflect current state.
 */
function updateStatusBar(): void {
  if (enabled) {
    statusBarItem.text = "$(check) Align";
    statusBarItem.tooltip =
      "Even Better Virtual Align: Enabled (click to disable)";
  } else {
    statusBarItem.text = "$(x) Align";
    statusBarItem.tooltip =
      "Even Better Virtual Align: Disabled (click to enable)";
  }
}

/**
 * Logs a message to the output channel.
 */
function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

/**
 * Activates the extension.
 */
export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // Create output channel for logging
  outputChannel = vscode.window.createOutputChannel(
    "Even Better Virtual Align"
  );
  context.subscriptions.push(outputChannel);

  // Create status bar item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "even-better-virtual-align.toggle";
  updateStatusBar();
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  log("Activating...");

  // Initialize services
  // Find wasmDir using require.resolve, with fallback to extension path
  let wasmDir: string;
  try {
    const treeSitterPath = require.resolve("@vscode/tree-sitter-wasm");
    wasmDir = path.dirname(treeSitterPath);
  } catch {
    wasmDir = path.join(
      context.extensionPath,
      "node_modules",
      "@vscode",
      "tree-sitter-wasm",
      "wasm"
    );
  }

  parserService = new ParserService({ wasmDir });
  decorationManager = new DecorationManager();

  try {
    await parserService.initialize();
    log("Parser initialized successfully");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log(`Failed to initialize parser: ${errorMsg}`);
    vscode.window.showErrorMessage(
      `Even Better Virtual Align: Failed to initialize. Error: ${errorMsg}`
    );
    return;
  }

  // Create debounced update function
  const debouncedUpdate = debounce(updateEditor, DEBOUNCE_MS);

  // Register toggle command
  const toggleCommand = vscode.commands.registerCommand(
    "even-better-virtual-align.toggle",
    () => {
      enabled = !enabled;
      updateStatusBar();
      log(`Toggled: ${enabled ? "enabled" : "disabled"}`);
      if (enabled) {
        vscode.window.showInformationMessage(
          "Even Better Virtual Align: Enabled"
        );
        if (vscode.window.activeTextEditor) {
          debouncedUpdate(vscode.window.activeTextEditor);
        }
      } else {
        vscode.window.showInformationMessage(
          "Even Better Virtual Align: Disabled"
        );
        decorationManager.clearAll();
      }
    }
  );
  context.subscriptions.push(toggleCommand);

  // Register enable command
  const enableCommand = vscode.commands.registerCommand(
    "even-better-virtual-align.enable",
    () => {
      if (!enabled) {
        enabled = true;
        updateStatusBar();
        log("Enabled");
        vscode.window.showInformationMessage(
          "Even Better Virtual Align: Enabled"
        );
        if (vscode.window.activeTextEditor) {
          debouncedUpdate(vscode.window.activeTextEditor);
        }
      }
    }
  );
  context.subscriptions.push(enableCommand);

  // Register disable command
  const disableCommand = vscode.commands.registerCommand(
    "even-better-virtual-align.disable",
    () => {
      if (enabled) {
        enabled = false;
        updateStatusBar();
        log("Disabled");
        vscode.window.showInformationMessage(
          "Even Better Virtual Align: Disabled"
        );
        decorationManager.clearAll();
      }
    }
  );
  context.subscriptions.push(disableCommand);

  // Register format command - applies alignment as actual text edits
  const formatCommand = vscode.commands.registerCommand(
    "even-better-virtual-align.format",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      const document = editor.document;
      const langId = document.languageId;

      if (!isSupportedLanguage(langId)) {
        vscode.window.showWarningMessage(
          `Even Better Virtual Align: Language "${langId}" is not supported`
        );
        return;
      }

      try {
        // Parse document
        const docAdapter = new VSCodeDocumentAdapter(document);
        const tokens = await parserService.parse(
          docAdapter,
          0,
          document.lineCount - 1
        );
        const groups = groupTokens(tokens);

        if (groups.length === 0) {
          vscode.window.showInformationMessage("No alignable content found");
          return;
        }

        // Calculate padding operations
        const paddingOps = calculatePaddingOps(document, groups);

        if (paddingOps.length === 0) {
          vscode.window.showInformationMessage("Content is already aligned");
          return;
        }

        // Apply edits
        const success = await editor.edit((editBuilder) => {
          // Sort by line desc, then column desc to apply from end to start
          const sorted = [...paddingOps].sort((a, b) => {
            if (a.line !== b.line) return b.line - a.line;
            return b.column - a.column;
          });

          for (const op of sorted) {
            const position = new vscode.Position(op.line, op.column);
            editBuilder.insert(position, " ".repeat(op.spaces));
          }
        });

        if (success) {
          log(`Applied ${paddingOps.length} alignment edits`);
          vscode.window.showInformationMessage(
            `Applied ${paddingOps.length} alignment edits`
          );
        } else {
          vscode.window.showErrorMessage("Failed to apply formatting");
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`Format failed: ${errorMsg}`);
        vscode.window.showErrorMessage(`Format failed: ${errorMsg}`);
      }
    }
  );
  context.subscriptions.push(formatCommand);

  // Listen for active editor changes
  const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      if (editor && enabled) {
        debouncedUpdate(editor);
      }
    }
  );
  context.subscriptions.push(activeEditorDisposable);

  // Listen for document changes
  const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && enabled && event.document === editor.document) {
        debouncedUpdate(editor);
      }
    }
  );
  context.subscriptions.push(documentChangeDisposable);

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (!enabled || !event.affectsConfiguration("evenBetterVirtualAlign")) {
      return;
    }
    for (const editor of vscode.window.visibleTextEditors) {
      void updateEditor(editor);
    }
  }));
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors((editors) => {
    decorationManager.clearHiddenEditors(editors);
    if (enabled) {
      for (const editor of editors) {
        void updateEditor(editor);
      }
    }
  }));

  // Initial update for active editor
  if (vscode.window.activeTextEditor) {
    debouncedUpdate(vscode.window.activeTextEditor);
  }

  log("Activated successfully");
}

/**
 * Padding operation for applying alignment as text edits.
 */
interface PaddingOp {
  line: number;
  column: number;
  spaces: number;
}

/**
 * Counts the number of consecutive spaces starting at a given column in a line.
 */
function countExistingSpaces(lineText: string, column: number): number {
  let count = 0;
  for (let i = column; i < lineText.length && lineText[i] === " "; i++) {
    count++;
  }
  return count;
}

/**
 * Calculates padding operations to apply alignment as actual text.
 * This version accounts for existing whitespace to make the operation idempotent.
 */
function calculatePaddingOps(
  document: vscode.TextDocument,
  groups: ReturnType<typeof groupTokens>
): PaddingOp[] {
  // Sort groups by line then column
  const sortedGroups = [...groups].sort((a, b) => {
    if (a.tokens[0].line !== b.tokens[0].line) {
      return a.tokens[0].line - b.tokens[0].line;
    }
    return a.tokens[0].column - b.tokens[0].column;
  });

  // Cache line texts
  const lineTexts: string[] = [];
  for (let i = 0; i < document.lineCount; i++) {
    lineTexts.push(document.lineAt(i).text);
  }

  const lineShift = new Map<number, number>();
  const paddingOps: PaddingOp[] = [];

  for (const group of sortedGroups) {
    let visualTargetColumn: number;

    if (group.tokens.length === 1) {
      const token = group.tokens[0];
      const shift = lineShift.get(token.line) ?? 0;
      if (group.padAfter) {
        const originalEndColumn = token.column + token.text.length;
        const originalPadding = group.targetColumn - originalEndColumn;
        visualTargetColumn = originalEndColumn + shift + originalPadding;
      } else {
        const originalPadding = group.targetColumn - token.column;
        visualTargetColumn = token.column + shift + originalPadding;
      }
    } else if (group.padAfter) {
      visualTargetColumn = Math.max(
        ...group.tokens.map((t) => {
          const shift = lineShift.get(t.line) ?? 0;
          return t.column + t.text.length + shift;
        })
      );
    } else {
      visualTargetColumn = Math.max(
        ...group.tokens.map((t) => {
          const shift = lineShift.get(t.line) ?? 0;
          return t.column + shift;
        })
      );
    }

    for (const token of group.tokens) {
      const shift = lineShift.get(token.line) ?? 0;
      let spacesNeeded: number;
      let insertColumn: number;

      if (group.padAfter) {
        const visualEndColumn = token.column + token.text.length + shift;
        spacesNeeded = visualTargetColumn - visualEndColumn;
        insertColumn = token.column + token.text.length;
      } else {
        const visualColumn = token.column + shift;
        spacesNeeded = visualTargetColumn - visualColumn;
        insertColumn = token.column;
      }

      if (spacesNeeded > 0) {
        // Check for existing spaces at the insertion point
        const lineText = lineTexts[token.line];
        const existingSpaces = countExistingSpaces(lineText, insertColumn);

        // Only skip if there's already MORE spaces than needed (already over-padded or correctly aligned)
        // If existing <= spacesNeeded, we need to add the full amount since existing is likely just baseline spacing
        if (existingSpaces <= spacesNeeded) {
          paddingOps.push({
            line: token.line,
            column: insertColumn,
            spaces: spacesNeeded,
          });
          lineShift.set(
            token.line,
            (lineShift.get(token.line) ?? 0) + spacesNeeded
          );
        }
        // If existingSpaces > spacesNeeded, skip (already has sufficient padding)
      }
    }
  }

  return paddingOps;
}

/**
 * Updates alignment decorations for an editor.
 */
async function updateEditor(editor: vscode.TextEditor): Promise<void> {
  const updateVersion = (editorUpdates.get(editor) ?? 0) + 1;
  editorUpdates.set(editor, updateVersion);
  if (!enabled) {
    return;
  }

  const document = editor.document;
  const langId = document.languageId;

  // Check if language is supported
  if (!isSupportedLanguage(langId)) {
    decorationManager.clear(editor);
    return;
  }

  // Check if language is enabled in settings
  const config = vscode.workspace.getConfiguration("evenBetterVirtualAlign");
  const enabledLanguages = config.get<Record<string, boolean>>(
    "enabledLanguages",
    {}
  );
  if (enabledLanguages[langId] === false) {
    decorationManager.clear(editor);
    return;
  }

  // Process entire file
  const startLine = 0;
  const endLine = document.lineCount - 1;

  try {
    // Wrap VS Code document with adapter for ParserService
    const docAdapter = new VSCodeDocumentAdapter(document);

    // Parse document to extract tokens
    const tokens = await parserService.parse(docAdapter, startLine, endLine);
    if (
      !enabled || document.isClosed ||
      editorUpdates.get(editor) !== updateVersion ||
      !vscode.window.visibleTextEditors.includes(editor)
    ) {
      return;
    }

    // Group tokens into alignment groups
    const groups = groupTokens(tokens);

    // Update decorations
    decorationManager.update(editor, groups);
  } catch (error) {
    log(
      `Update failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Deactivates the extension.
 */
export function deactivate(): void {
  if (outputChannel) {
    log("Deactivating...");
  }

  if (decorationManager) {
    decorationManager.dispose();
  }

  if (parserService) {
    parserService.dispose();
  }
}
