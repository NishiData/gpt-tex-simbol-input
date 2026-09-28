/* Parsing and renderer options shared by the preview and offline tests. */
(() => {
  "use strict";
  const MAX_CHARS = 8000;
  const MAX_FORMULAS = 40;
  const escaped = (text, index) => {
    let count = 0;
    while (index > 0 && text[--index] === "\\") count++;
    return count % 2 === 1;
  };

  function splitMath(text) {
    const parts = [];
    let start = 0, index = 0, count = 0;
    while (index < text.length && count < MAX_FORMULAS) {
      // Leave Markdown code (including fenced blocks) as literal text.
      if ((text[index] === "`" || text.startsWith("~~~", index)) && !escaped(text, index)) {
        const char = text[index];
        let end = index;
        while (text[end] === char) end++;
        const marker = text.slice(index, end);
        const close = text.indexOf(marker, end);
        index = close < 0 ? text.length : close + marker.length;
        continue;
      }
      if (escaped(text, index)) { index++; continue; }
      let open, close, display;
      if (text.startsWith("$$", index)) [open, close, display] = ["$$", "$$", true];
      else if (text[index] === "$" && !/\d/.test(text[index + 1] || "")) [open, close, display] = ["$", "$", false];
      else if (text[index] === "$") {
        // A numeric opening is math only when a closing dollar exists.
        let end = index + 1;
        while (end < text.length && (text[end] !== "$" || escaped(text, end))) end++;
        if (end < text.length) [open, close, display] = ["$", "$", false];
      }
      else if (text.startsWith("\\(", index)) [open, close, display] = ["\\(", "\\)", false];
      else if (text.startsWith("\\[", index)) [open, close, display] = ["\\[", "\\]", true];
      if (!open) { index++; continue; }
      const contentStart = index + open.length;
      let end = contentStart;
      while (end < text.length && (!text.startsWith(close, end) || escaped(text, end))) end++;
      if (index > start) parts.push({type: "text", text: text.slice(start, index)});
      parts.push({type: "math", text: text.slice(contentStart, end), display, pending: end === text.length});
      count++;
      index = end === text.length ? end : end + close.length;
      start = index;
    }
    if (start < text.length) parts.push({type: "text", text: text.slice(start)});
    return {parts, count};
  }

  function looksLikeMath(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("~~~")) return false;
    // Japanese prose should use explicit delimiters; \text{...} is valid TeX.
    const withoutText = trimmed.replace(/\\(?:text|textrm|textsf|texttt)\{[^{}]*\}/g, "");
    if (/[\u3040-\u30ff\u3400-\u9fff]/.test(withoutText)) return false;
    return /\\[A-Za-z]+|[_^=<>]|[α-ωΑ-Ω∑∫√∞≠≤≥ℝℂℤ]|[A-Za-z0-9)]\s*[+*/-]\s*[A-Za-z0-9(]/.test(trimmed);
  }

  function extract(text, mode = "auto") {
    if (text.length > MAX_CHARS) return {parts: [], count: 0, tooLong: true};
    const split = splitMath(text);
    if (split.count > 0) return split;
    if (mode === "math" || (mode === "auto" && looksLikeMath(text))) {
      return {parts: [{type: "math", text: text.trim(), display: true, pending: false}], count: text.trim() ? 1 : 0};
    }
    return {parts: [], count: 0};
  }

  function normalize(tex) {
    // Existing symbol conversion may produce √{...}; restore a radical only
    // in the preview. The original input is never changed by this module.
    return tex.replace(/√(?=\s*[\[{])/g, "\\sqrt");
  }

  function options(display = true) {
    return {
      displayMode: display, output: "mathml", throwOnError: true, strict: "ignore",
      trust: false, maxSize: 20, maxExpand: 300,
      // Fresh macros per formula: user macro definitions never persist.
      macros: {"\\mathbbR": "\\mathbb{R}", "\\mathbbC": "\\mathbb{C}",
        "\\mathbbZ": "\\mathbb{Z}", "\\mathbbN": "\\mathbb{N}",
        "\\mathbbQ": "\\mathbb{Q}", "\\mathbbH": "\\mathbb{H}", "\\mathbbP": "\\mathbb{P}"}
    };
  }
  const api = Object.freeze({extract, splitMath, normalize, options, MAX_CHARS, MAX_FORMULAS});
  globalThis.TEX_PREVIEW = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})();
