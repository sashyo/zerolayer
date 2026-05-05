/**
 * Lightweight syntax highlighter — no third-party dep. Covers the small set
 * of languages most commonly pasted in chat. Output is a flat array of
 * `{ text, kind }` tokens; the renderer maps `kind` to a tailwind class.
 *
 * Supported: js / ts / jsx / tsx, python, json, sh / bash, sql.
 * Anything else falls through as a single "plain" token, so unsupported
 * blocks still render as monospace prose without losing characters.
 */
export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "func"
  | "type";

export interface Token {
  text: string;
  kind: TokenKind;
}

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "default", "throw", "try",
  "catch", "finally", "new", "this", "super", "class", "extends", "import",
  "export", "from", "as", "async", "await", "yield", "of", "in", "typeof",
  "instanceof", "void", "delete", "true", "false", "null", "undefined",
]);

const TS_KEYWORDS = new Set([
  ...JS_KEYWORDS,
  "type", "interface", "enum", "implements", "public", "private", "protected",
  "readonly", "abstract", "declare", "namespace", "keyof", "infer", "any",
  "unknown", "never", "string", "number", "boolean", "object", "symbol",
]);

const PY_KEYWORDS = new Set([
  "def", "class", "return", "if", "elif", "else", "for", "while", "in",
  "not", "and", "or", "True", "False", "None", "import", "from", "as",
  "with", "try", "except", "finally", "raise", "yield", "lambda", "pass",
  "break", "continue", "global", "nonlocal", "async", "await",
]);

const SH_KEYWORDS = new Set([
  "if", "then", "fi", "else", "elif", "for", "while", "do", "done", "case",
  "esac", "in", "function", "return", "exit", "echo", "export", "local",
  "set", "unset",
]);

const SQL_KEYWORDS = new Set([
  "select", "from", "where", "and", "or", "not", "in", "is", "null", "as",
  "join", "left", "right", "inner", "outer", "on", "group", "by", "order",
  "limit", "offset", "having", "insert", "update", "delete", "into", "values",
  "set", "create", "table", "primary", "key", "foreign", "references",
  "drop", "alter", "add", "column", "distinct", "union", "all",
]);

function pickKeywords(lang: string): Set<string> | null {
  const l = lang.toLowerCase();
  if (l === "js" || l === "javascript" || l === "jsx") return JS_KEYWORDS;
  if (l === "ts" || l === "typescript" || l === "tsx") return TS_KEYWORDS;
  if (l === "py" || l === "python") return PY_KEYWORDS;
  if (l === "sh" || l === "bash" || l === "zsh" || l === "shell") return SH_KEYWORDS;
  if (l === "sql") return SQL_KEYWORDS;
  if (l === "json") return new Set(["true", "false", "null"]);
  return null;
}

export function highlight(src: string, lang: string): Token[] {
  const keywords = pickKeywords(lang);
  if (!keywords) return [{ text: src, kind: "plain" }];

  const lineComment =
    lang === "py" || lang === "python" || lang === "sh" || lang === "bash" || lang === "shell" || lang === "zsh"
      ? "#"
      : lang === "sql"
        ? "--"
        : "//";
  const supportsBlockComment =
    lang !== "py" && lang !== "python" && lang !== "sh" && lang !== "bash" && lang !== "zsh" && lang !== "shell" && lang !== "sql";

  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;

  const push = (text: string, kind: TokenKind) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  while (i < n) {
    const c = src[i];

    // Block comment /* … */
    if (supportsBlockComment && c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      const close = end < 0 ? n : end + 2;
      push(src.slice(i, close), "comment");
      i = close;
      continue;
    }

    // Line comment
    if (src.startsWith(lineComment, i)) {
      const nl = src.indexOf("\n", i);
      const close = nl < 0 ? n : nl;
      push(src.slice(i, close), "comment");
      i = close;
      continue;
    }

    // String literals (single, double, backtick)
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      let j = i + 1;
      while (j < n) {
        const cj = src[j];
        if (cj === "\\") {
          j += 2;
          continue;
        }
        if (cj === quote) {
          j += 1;
          break;
        }
        if (cj === "\n" && quote !== "`") break; // single/double don't span lines
        j += 1;
      }
      push(src.slice(i, j), "string");
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9._eExX+\-a-fA-F]/.test(src[j])) j += 1;
      push(src.slice(i, j), "number");
      i = j;
      continue;
    }

    // Identifiers / keywords / functions
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const word = src.slice(i, j);
      if (keywords.has(word) || keywords.has(word.toLowerCase())) {
        push(word, "keyword");
      } else if (src[j] === "(") {
        push(word, "func");
      } else if (/^[A-Z]/.test(word)) {
        push(word, "type");
      } else {
        push(word, "plain");
      }
      i = j;
      continue;
    }

    push(c, "plain");
    i += 1;
  }

  return tokens;
}

export const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "",
  comment: "text-muted italic",
  string: "text-green-300",
  number: "text-orange-300",
  keyword: "text-pink-300",
  func: "text-blue-300",
  type: "text-cyan-300",
};
