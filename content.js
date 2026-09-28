(() => {
  "use strict";
  // No message text is saved or transmitted. Only preferences use storage.
  let enabled = true;
  const composing = new WeakSet();
  chrome.storage.local.get({ enabled: true }, (value) => { enabled = value.enabled; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) enabled = changes.enabled.newValue !== false;
  });

  function editorFor(target) {
    if (!(target instanceof Element)) return null;
    if (target instanceof HTMLTextAreaElement) {
      return target.disabled || target.readOnly ? null : target;
    }
    if (!target.isContentEditable) return null;
    let root = target;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return root;
  }

  function matchSymbol(prefix) {
    // Refuse escaped backslashes; support both \\mathbb{R} and \\mathbbR.
    const match = /(^|[^\\])(\\(?:[A-Za-z]+|mathbb\{[RCZNQHP]\}))$/.exec(prefix);
    if (!match) return null;
    const command = match[2];
    const name = command.slice(1).replace(/^mathbb\{([RCZNQHP])\}$/, "mathbb$1");
    const symbol = Object.hasOwn(globalThis.TEX_SYMBOLS, name) ? globalThis.TEX_SYMBOLS[name] : null;
    return symbol ? { command, symbol } : null;
  }

  function textAreaReplacement(editor) {
    if (editor.selectionStart !== editor.selectionEnd) return false;
    const end = editor.selectionStart;
    const found = matchSymbol(editor.value.slice(0, end));
    if (!found) return false;
    const original = editor.value;
    editor.setSelectionRange(end - found.command.length, end);
    // Chromium's editing command preserves native undo and dispatches input.
    try { document.execCommand("insertText", false, found.symbol); } catch { /* Restore below. */ }
    if (editor.value !== original) return true;
    editor.setSelectionRange(end, end);
    return false;
  }

  function richTextReplacement(editor) {
    const selection = window.getSelection();
    if (!selection?.isCollapsed || selection.rangeCount !== 1) return false;
    const caret = selection.getRangeAt(0);
    if (!editor.contains(caret.endContainer)) return false;
    // Search only the current block, never across paragraphs or code nodes.
    const leaf = caret.endContainer.nodeType === Node.ELEMENT_NODE
      ? caret.endContainer : caret.endContainer.parentElement;
    if (leaf.closest("pre, code, [contenteditable='false']")) return false;
    const block = leaf.closest("p, div, li, blockquote") || editor;
    const scope = editor.contains(block) ? block : editor;
    const prefix = document.createRange();
    prefix.selectNodeContents(scope);
    prefix.setEnd(caret.endContainer, caret.endOffset);
    const text = prefix.toString();
    const found = matchSymbol(text);
    if (!found) return false;

    let offset = text.length - found.command.length;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (offset <= node.length) break;
      offset -= node.length;
    }
    if (!node) return false;
    const replacement = caret.cloneRange();
    replacement.setStart(node, offset);
    // A <br> contributes no text to Range.toString; don't span it or a nested
    // non-editable node even if the concatenated text resembles a command.
    const fragment = replacement.cloneContents();
    if (fragment.querySelector("br, pre, code, [contenteditable='false']")) return false;
    const originalCaret = caret.cloneRange();
    selection.removeAllRanges();
    selection.addRange(replacement);
    const previousText = editor.textContent;
    try { document.execCommand("insertText", false, found.symbol); } catch { /* Restore below. */ }
    if (editor.textContent !== previousText) return true;
    selection.removeAllRanges();
    selection.addRange(originalCaret);
    return false;
  }

  document.addEventListener("compositionstart", (event) => {
    const editor = editorFor(event.target);
    if (editor) composing.add(editor);
  }, true);
  document.addEventListener("compositionend", (event) => {
    const editor = editorFor(event.target);
    if (editor) composing.delete(editor);
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!enabled || event.defaultPrevented || event.key !== " " || event.ctrlKey ||
        event.metaKey || event.altKey || event.shiftKey || event.isComposing ||
        event.keyCode === 229 || event.repeat) return;
    const editor = editorFor(event.target);
    if (!editor || composing.has(editor)) return;
    const converted = editor instanceof HTMLTextAreaElement
      ? textAreaReplacement(editor) : richTextReplacement(editor);
    if (converted) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
