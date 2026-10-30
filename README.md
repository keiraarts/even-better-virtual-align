# Even Better Virtual Align

> **even-better-virtual-align** is based on [virtual-better-align](https://github.com/hborchardt/virtual-better-align), which is based on [better-align](https://github.com/chouzz/vscode-better-align). Rebuilt from scratch using Tree-sitter for reliable, AST-based parsing.

This VS Code/Cursor extension attempts to solve the "glanceability" problem: how do you read not just a thousand lines of code per day, but tens of thousands?

[![VS Code](https://img.shields.io/badge/VS%20Code-Compatible-blue?logo=visualstudiocode)](https://marketplace.visualstudio.com/)
[![Cursor](https://img.shields.io/badge/Cursor-Compatible-purple)](https://cursor.sh/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

Vertical alignment makes code scannable instead of just readable:

```python
# Hard to scan                    # Easy to scan
name = "app"                      name    = "app"
version = "1.0.0"                 version = "1.0.0"
debug = True                      debug   = True
timeout = 30                      timeout = 30
```

## The Alignment Dilemma

- **Noisy Git Diffs:** Change one variable name and you have to realign 10 other lines.
- **Formatter Wars:** Prettier, Black, and gofmt all have opinions. Manual alignment gets destroyed.
- **Team Friction:** "Should we align or not?" becomes an endless debate.

## The Solution

**Even Better Virtual Align** renders alignment **visually** without touching your files. Your code looks perfectly aligned in the editor, but the file on disk stays exactly as your formatter left it.

| What You See (Editor) | What Is Saved (Disk) |
| :-------------------- | :------------------- |
| `name:    "app"`      | `name: "app"`        |
| `version: "1.0"`      | `version: "1.0"`     |
| `debug:   true`       | `debug: true`        |

**Your git diff:** Clean. Zero alignment noise. Just the actual changes.

---

## Key Features

- **Zero File Modifications:** Alignment is purely visual. Your git diffs remain pristine.
- **Tree-sitter Powered:** Uses robust AST parsing instead of fragile regex. It understands context, scope, and structure.
- **Smart Grouping:** Only aligns related code (same indentation, same AST context, consecutive lines).
- **Go-Style Rules:**
  - **Colons (`:`)**: Attached to the key; padding added _after_ to align values.
  - **Operators (`=`, `&&`, `||`)**: Padding added _before_ to align the operators.
- **Multi-Language:** Native support for TypeScript, TSX, JSON, YAML, Python, CSS, SCSS, and Less.

---

## Visual Examples

### Data & Configuration

_Aligns keys at the same indentation level. Nested blocks form separate alignment groups._

**Package Configuration** (JSON)

```json
{
  "name":        "enterprise-dashboard",
  "version":     "2.4.0",
  "description": "Real-time analytics platform",
  "main":        "dist/server.js",
  "license":     "MIT"
}
```

**Nested Structures** (YAML)

```yaml
# Each indentation level aligns independently
spec:
  replicas: 3
  strategy: RollingUpdate
  selector:
    app:  backend    # Nested group - aligns separately
    tier: production
```

**Type Definitions** (TypeScript)

```typescript
interface UserProfile {
  id:          string;
  email:       string;
  displayName: string;
  avatarUrl:   string | null;
  isVerified:  boolean;
}
```

### Logic & Conditions

_Clarify complex logic by aligning operators. Padding added **before** `=`, `&&`, `||`, etc._

**Environment Setup** (Python)

```python
DEBUG        = os.getenv("DEBUG", "false") == "true"
SECRET_KEY   = os.getenv("SECRET_KEY", "dev-secret")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///app.db")
REDIS_HOST   = os.getenv("REDIS_HOST", "localhost")
API_TIMEOUT  = int(os.getenv("API_TIMEOUT", "30"))
```

**Conditional Classes** (TSX / React)

```tsx
const buttonClasses = clsx(
  "px-4 py-2 rounded transition-all",
  isPrimary   && "bg-blue-600 text-white hover:bg-blue-700",
  isSecondary && "bg-gray-100 text-gray-900 hover:bg-gray-200",
  isLoading   && "opacity-75 cursor-wait",
  isDisabled  && "opacity-50 pointer-events-none",
);
```

**Guard Clauses** (TypeScript)

```typescript
const canSubmit =
  isFormValid      &&
  !isSubmitting    &&
  hasAgreedToTerms &&
  (hasCredit || isFreeTier);
```

### Styling & Theming

_Create clean, readable style definitions and token maps._

**Component Styles** (CSS)

```css
.card {
  position:       relative;
  display:        flex;
  flex-direction: column;
  padding:        1.5rem;
  border-radius:  0.5rem;
}
```

**Design Tokens** (SCSS)

```scss
$color-primary: #3b82f6;
$color-danger:  #ef4444;
$color-success: #22c55e;
$spacing-unit:  0.25rem;
```

**Responsive Breakpoints** (Less)

```less
@screen-sm:     640px;
@screen-md:     768px;
@screen-lg:     1024px;
@screen-xl:     1280px;
@container-max: 1440px;
```

---

## Supported Languages & Operators

| Language              | Extension                | Aligned Operators      |
| :-------------------- | :----------------------- | :--------------------- |
| **TypeScript / TSX**  | `.ts`, `.tsx`            | `=`, `:`, `&&`, `\|\|` |
| **JSON / JSONC**      | `.json`, `.jsonc`        | `:`                    |
| **YAML**              | `.yaml`, `.yml`          | `:`                    |
| **Python**            | `.py`                    | `=`, `:`, `and`, `or`  |
| **CSS / SCSS / Less** | `.css`, `.scss`, `.less` | `:`                    |

---

## Usage

### Virtual Alignment (Default)

Virtual alignment renders code as aligned **without modifying files**. Your code looks perfectly aligned in the editor, but the file on disk stays untouched.

| Action      | Command / Shortcut                               |
| :---------- | :----------------------------------------------- |
| **Toggle**  | `Cmd+Shift+A` (Mac) / `Ctrl+Shift+A` (Win/Linux) |
| **Enable**  | Command Palette → `Even Better Virtual Align: Enable`     |
| **Disable** | Command Palette → `Even Better Virtual Align: Disable`    |

**Status Bar:** Look for the "✓ Align" / "✗ Align" indicator in the bottom right.

### Apply Formatting (Permanent)

If you want to write the alignment to the file permanently (e.g., for sharing, code reviews, or Markdown tables), use the format command:

| Action             | Command                                                    |
| :----------------- | :--------------------------------------------------------- |
| **Apply Formatting** | Command Palette → `Even Better Virtual Align: Apply Formatting` |

This inserts actual space characters to align your code. The changes are reversible with undo (`Cmd+Z` / `Ctrl+Z`).

> **Note:** If you use Prettier or another formatter with "Format on Save," it may collapse the alignment spaces. Consider using `// prettier-ignore` comments to protect aligned blocks.

---

## Configuration

`evenBetterVirtualAlign.maxPadding` controls virtual spacer width. It defaults to
`0` (unlimited), so short translation keys still align with long keys. Set a
positive integer to cap padding per alignment point; capped values may no longer
share one column. This setting supports language overrides and updates visible
editors immediately. It does not affect the Apply Formatting command.

You can enable or disable alignment for specific languages in your `settings.json`:

```json
{
  "evenBetterVirtualAlign.enabledLanguages": {
    "typescript":      true,
    "typescriptreact": true,
    "json":            true,
    "jsonc":           true,
    "yaml":            true,
    "python":          true,
    "css":             true,
    "scss":            true,
    "less":            true
  }
}
```

Set any language to `false` to disable alignment for that language.

---

## Installation

### From VSIX (Releases)

1. Download the `.vsix` file from the [Releases page](https://github.com/zaydek/even-better-virtual-align/releases).
2. Run the install command:

```bash
# For VS Code
code --install-extension even-better-virtual-align-*.vsix

# For Cursor
cursor --install-extension even-better-virtual-align-*.vsix
```

---

## Credits

Inspired by [virtual-better-align](https://github.com/hborchardt/virtual-better-align), which is based on [better-align](https://github.com/chouzz/vscode-better-align). Rebuilt from scratch using **Tree-sitter** for reliable, AST-based parsing.
