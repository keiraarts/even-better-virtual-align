/**
 * Manages VS Code decorations for visual alignment.
 *
 * Key insight from council: VS Code TextEditorDecorationType doesn't support
 * dynamic contentText per range. We work around this by creating a pool of
 * decoration types, one for each unique width (number of spaces).
 */

import * as vscode from "vscode";
import { AlignmentGroup } from "../core/types";

/** Maximum number of shared decoration types retained between updates. */
const MAX_CACHED_TYPES = 50;

export class DecorationManager {
  /** Cache of decoration types by width (number of spaces) */
  private decorationTypes: Map<number, vscode.TextEditorDecorationType> =
    new Map();

  /** Track which decoration types are currently applied to clear them */
  private activeDecorations: Map<vscode.TextEditor, Set<number>> = new Map();
  private transientDecorations = new Map<
    vscode.TextEditor,
    Map<number, vscode.TextEditorDecorationType>
  >();

  /**
   * Updates decorations for an editor based on alignment groups.
   *
   * Multi-pass algorithm to handle accumulated shift:
   * 1. Process funcArg groups column-by-column (Column-Based Sweep)
   * 2. Process regular operators, tracking per-line shift
   * 3. Process comments accounting for accumulated shift
   */
  update(editor: vscode.TextEditor, groups: AlignmentGroup[]): void {
    // Clear existing decorations for this editor
    this.clear(editor);
    const configuredLimit = vscode.workspace
      .getConfiguration("evenBetterVirtualAlign", editor.document)
      .get<number>("maxPadding", 0);
    const paddingLimit = Number.isInteger(configuredLimit) && configuredLimit > 0
      ? configuredLimit
      : Infinity;

    // Separate groups by type
    const commentGroups = groups.filter((g) => g.tokens[0]?.type === "//");
    const funcArgGroups = groups.filter((g) => g.tokens[0]?.type === "funcArg");
    const regularGroups = groups.filter(
      (g) => g.tokens[0]?.type !== "//" && g.tokens[0]?.type !== "funcArg"
    );

    // Track accumulated shift per line (from all padding)
    const lineShift = new Map<number, number>();

    // Batch ranges by width for efficient decoration application
    const rangesByWidth = new Map<number, vscode.Range[]>();

    // --- PASS 1: Process funcArg groups using Column-Based Sweep ---
    // Group funcArg tokens by scope, then process column-by-column
    const funcArgByScope = new Map<string, AlignmentGroup[]>();
    for (const group of funcArgGroups) {
      const scopeId = group.tokens[0]?.scopeId ?? "default";
      if (!funcArgByScope.has(scopeId)) {
        funcArgByScope.set(scopeId, []);
      }
      funcArgByScope.get(scopeId)!.push(group);
    }

    for (const scopeGroups of funcArgByScope.values()) {
      // Sort groups by tokenIndex (column order)
      scopeGroups.sort(
        (a, b) => a.tokens[0].tokenIndex - b.tokens[0].tokenIndex
      );

      // Track shift per line within this scope
      const scopeLineShift = new Map<number, number>();

      // Process each column (tokenIndex) left-to-right
      for (const group of scopeGroups) {
        // Calculate visual end positions accounting for accumulated shift
        let maxVisualEnd = 0;
        const tokenVisualEnds: Array<{
          token: (typeof group.tokens)[0];
          visualEnd: number;
        }> = [];

        for (const token of group.tokens) {
          const shift = scopeLineShift.get(token.line) ?? 0;
          const visualEnd = token.column + token.text.length + shift;
          tokenVisualEnds.push({ token, visualEnd });
          if (visualEnd > maxVisualEnd) {
            maxVisualEnd = visualEnd;
          }
        }

        // Apply padding and update shifts
        for (const { token, visualEnd } of tokenVisualEnds) {
          const spacesNeeded = Math.min(maxVisualEnd - visualEnd, paddingLimit);

          if (spacesNeeded > 0) {
            // Pad BEFORE the token (right-align)
            const shift = scopeLineShift.get(token.line) ?? 0;
            const visualColumn = token.column + shift;
            const pos = new vscode.Position(token.line, visualColumn);

            if (!rangesByWidth.has(spacesNeeded)) {
              rangesByWidth.set(spacesNeeded, []);
            }
            rangesByWidth.get(spacesNeeded)!.push(new vscode.Range(pos, pos));

            // Update accumulated shift for this line
            const currentShift = scopeLineShift.get(token.line) ?? 0;
            scopeLineShift.set(token.line, currentShift + spacesNeeded);
          }
        }
      }

      // Merge scope shifts into global lineShift for comment alignment
      for (const [line, shift] of scopeLineShift) {
        const current = lineShift.get(line) ?? 0;
        lineShift.set(line, current + shift);
      }
    }

    // --- PASS 2: Process regular operators ---
    // Separate function_arguments commas (need shift adjustment) from other operators
    const funcArgCommaGroups = regularGroups.filter(
      (g) => g.tokens[0]?.parentType === "function_arguments"
    );
    const otherRegularGroups = regularGroups.filter(
      (g) => g.tokens[0]?.parentType !== "function_arguments"
    );

    // Process function_arguments commas with shift adjustment (like comments)
    for (const group of funcArgCommaGroups) {
      // Recalculate target column using VISUAL positions
      const visualEndColumns = group.tokens.map((t) => {
        const shift = lineShift.get(t.line) ?? 0;
        return t.column + t.text.length + shift;
      });
      const targetVisualEndColumn = Math.max(...visualEndColumns);

      for (const token of group.tokens) {
        const shift = lineShift.get(token.line) ?? 0;
        const currentVisualEndColumn = token.column + token.text.length + shift;
        const spacesNeeded = Math.min(
          targetVisualEndColumn - currentVisualEndColumn, paddingLimit
        );

        if (spacesNeeded <= 0) {
          continue;
        }

        // Pad AFTER the comma (padAfter = true for commas)
        const visualColumn = token.column + token.text.length + shift;
        const pos = new vscode.Position(token.line, visualColumn);

        if (!rangesByWidth.has(spacesNeeded)) {
          rangesByWidth.set(spacesNeeded, []);
        }
        rangesByWidth.get(spacesNeeded)!.push(new vscode.Range(pos, pos));

        // Track this shift
        const currentShift = lineShift.get(token.line) ?? 0;
        lineShift.set(token.line, currentShift + spacesNeeded);
      }
    }

    // Process other regular operators normally
    for (const group of otherRegularGroups) {
      // Recalculate target column using VISUAL positions (accounting for accumulated shifts)
      let visualTargetColumn: number;
      if (group.padAfter) {
        // For padAfter groups, target is max visual end column
        visualTargetColumn = Math.max(
          ...group.tokens.map((t) => {
            const shift = lineShift.get(t.line) ?? 0;
            return t.column + t.text.length + shift;
          })
        );
      } else {
        // For padBefore groups, target is max visual start column
        visualTargetColumn = Math.max(
          ...group.tokens.map((t) => {
            const shift = lineShift.get(t.line) ?? 0;
            return t.column + shift;
          })
        );
      }

      for (const token of group.tokens) {
        // Get current accumulated shift for this line (from previous passes/operators)
        const currentShift = lineShift.get(token.line) ?? 0;

        let spacesNeeded: number;
        let pos: vscode.Position;

        if (group.padAfter) {
          // For `:` - pad AFTER operator to align values
          // Visual end = document position + text length + accumulated shift
          const visualEnd = token.column + token.text.length + currentShift;
          spacesNeeded = Math.min(visualTargetColumn - visualEnd, paddingLimit);
          pos = new vscode.Position(
            token.line,
            token.column + token.text.length
          );
        } else {
          // For `=`, `&&`, `||`, `}` - pad BEFORE operator to align operators
          // Visual start = document position + accumulated shift
          const visualStart = token.column + currentShift;
          spacesNeeded = Math.min(visualTargetColumn - visualStart, paddingLimit);
          pos = new vscode.Position(token.line, token.column);
        }

        // IMPORTANT: Always update lineShift for this line, even if no decoration is needed.
        // This ensures Pass 3 (comments) sees the correct accumulated shift.
        // If spacesNeeded is 0 or negative, we still need to preserve currentShift.
        const actualSpacesAdded = Math.max(0, spacesNeeded);
        if (actualSpacesAdded > 0) {
          lineShift.set(token.line, currentShift + actualSpacesAdded);
        }

        if (spacesNeeded <= 0) {
          continue;
        }

        if (!rangesByWidth.has(spacesNeeded)) {
          rangesByWidth.set(spacesNeeded, []);
        }

        rangesByWidth.get(spacesNeeded)!.push(new vscode.Range(pos, pos));
      }
    }

    // --- PASS 3: Process comment groups with shift adjustment ---
    for (const group of commentGroups) {
      // Recalculate target column using VISUAL positions
      // Visual position = original column + accumulated shift
      const visualColumns = group.tokens.map((t) => {
        const shift = lineShift.get(t.line) ?? 0;
        return t.column + shift;
      });
      const targetVisualColumn = Math.max(...visualColumns);

      for (const token of group.tokens) {
        const shift = lineShift.get(token.line) ?? 0;
        const currentVisualColumn = token.column + shift;
        const spacesNeeded = Math.min(
          targetVisualColumn - currentVisualColumn, paddingLimit
        );

        if (spacesNeeded <= 0) {
          continue;
        }

        const pos = new vscode.Position(token.line, token.column);

        if (!rangesByWidth.has(spacesNeeded)) {
          rangesByWidth.set(spacesNeeded, []);
        }

        rangesByWidth.get(spacesNeeded)!.push(new vscode.Range(pos, pos));
      }
    }

    // Apply decorations in batches by width
    const activeWidths = new Set<number>();

    for (const [width, ranges] of rangesByWidth) {
      const decorationType = this.getDecorationType(width, editor);
      editor.setDecorations(decorationType, ranges);
      activeWidths.add(width);
    }

    this.activeDecorations.set(editor, activeWidths);
  }

  /**
   * Gets or creates a decoration type for a specific width.
   */
  private getDecorationType(
    width: number,
    editor: vscode.TextEditor
  ): vscode.TextEditorDecorationType {
    const cached = this.decorationTypes.get(width);
    if (cached) {
      return cached;
    }
    const decorationType = vscode.window.createTextEditorDecorationType({
      before: {
        contentText: "\u00a0",
        width: `${width}ch`,
        color: "transparent",
      },
    });
    if (this.decorationTypes.size < MAX_CACHED_TYPES) {
      this.decorationTypes.set(width, decorationType);
    } else {
      if (!this.transientDecorations.has(editor)) {
        this.transientDecorations.set(editor, new Map());
      }
      this.transientDecorations.get(editor)!.set(width, decorationType);
    }
    return decorationType;
  }

  /**
   * Clears all decorations from an editor.
   */
  clear(editor: vscode.TextEditor): void {
    const activeWidths = this.activeDecorations.get(editor);
    if (activeWidths) {
      for (const width of activeWidths) {
        const decorationType = this.decorationTypes.get(width)
          ?? this.transientDecorations.get(editor)?.get(width);
        if (decorationType) {
          editor.setDecorations(decorationType, []);
        }
      }
      this.activeDecorations.delete(editor);
    }
    const transient = this.transientDecorations.get(editor);
    if (transient) {
      for (const decorationType of transient.values()) {
        decorationType.dispose();
      }
      this.transientDecorations.delete(editor);
    }
  }

  clearHiddenEditors(editors: readonly vscode.TextEditor[]): void {
    for (const editor of this.activeDecorations.keys()) {
      if (!editors.includes(editor)) {
        this.clear(editor);
      }
    }
  }

  /**
   * Clears decorations from all editors.
   */
  clearAll(): void {
    for (const editor of this.activeDecorations.keys()) {
      this.clear(editor);
    }
  }

  /**
   * Disposes all decoration types. Call this when deactivating.
   */
  dispose(): void {
    this.clearAll();
    for (const decorationType of this.decorationTypes.values()) {
      decorationType.dispose();
    }
    this.decorationTypes.clear();
  }
}
