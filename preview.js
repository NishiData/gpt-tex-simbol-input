(() => {
  "use strict";
  const core = globalThis.TEX_PREVIEW;
  const renderer = globalThis.katex;
  if (!core || !renderer) return;
  let enabled = true, mode = "auto", editor = null, timer = null;
  let host, shadow, body, status, collapseButton, collapsed = false;
  let previous = null, frame = null, composing = false;
  const observer = new MutationObserver(() => schedule());
  const lifecycle = new MutationObserver(() => {
    if (editor && !editor.isConnected) {
      hide(); editor = null; previous = null; observer.disconnect();
    }
  });
  lifecycle.observe(document.body, {childList: true, subtree: true});

  function editorFor(target) {
    if (!(target instanceof Element) || host?.contains(target)) return null;
    if (target instanceof HTMLTextAreaElement) return target.disabled || target.readOnly ? null : target;
    if (!target.isContentEditable) return null;
    let root = target;
    while (root.parentElement?.isContentEditable) root = root.parentElement;
    return root;
  }

  function createPanel() {
    if (host) return;
    host = document.createElement("div");
    host.id = "tex-symbol-preview-host";
    host.hidden = true;
    host.style.cssText = "all:initial;position:fixed;z-index:2147483600;display:none;";
    shadow = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = `
      :host { color-scheme: light; --bg:#fff; --fg:#20252b; --muted:#657080; --edge:#d6dce4; --wash:#f5f7fa; }
      :host([data-dark]) { color-scheme:dark; --bg:#24272c; --fg:#eef0f4; --muted:#b8c0ce; --edge:#4a505b; --wash:#2e333b; }
      * { box-sizing:border-box; }
      .panel { color:var(--fg); background:var(--bg); border:1px solid var(--edge); border-radius:12px; box-shadow:0 5px 22px #0002; font:14px/1.55 system-ui,sans-serif; overflow:hidden; }
      header { display:flex; align-items:center; gap:8px; padding:8px 12px; background:var(--wash); }
      strong { font-size:12px; font-weight:650; white-space:nowrap; }
      #status { flex:1; min-width:0; color:var(--muted); font-size:11px; }
      button { background:transparent; color:var(--muted); border:0; border-radius:5px; padding:3px 6px; font:14px system-ui; cursor:pointer; }
      button:hover, button:focus-visible { background:var(--edge); color:var(--fg); }
      #body { padding:14px 16px; max-height:var(--body-height,190px); overflow:auto; overflow-wrap:anywhere; white-space:pre-wrap; }
      #body[hidden] { display:none; }
      .display { display:block; margin:6px 0; overflow-x:auto; padding:4px 0; }
      .inline { display:inline; }
      math { font-size:22px; font-family:"Cambria Math","STIX Two Math","Latin Modern Math",math; color:var(--fg); }
      .inline math { font-size:19px; }
      .error { font:13px/1.5 ui-monospace,monospace; color:var(--muted); white-space:pre-wrap; border-bottom:1px dotted var(--muted); }
      .hint { color:var(--muted); font-size:12px; }
    `;
    shadow.append(style);
    const panel = document.createElement("section");
    panel.className = "panel";
    panel.setAttribute("aria-label", "数式プレビュー");
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = "数式プレビュー";
    status = document.createElement("span"); status.id = "status";
    collapseButton = document.createElement("button");
    collapseButton.type = "button"; collapseButton.textContent = "−";
    collapseButton.title = "折りたたむ";
    collapseButton.setAttribute("aria-label", "プレビューを折りたたむ");
    collapseButton.addEventListener("click", () => {
      collapsed = !collapsed; body.hidden = collapsed;
      collapseButton.textContent = collapsed ? "+" : "−";
      collapseButton.title = collapsed ? "展開する" : "折りたたむ";
      collapseButton.setAttribute("aria-label", collapsed ? "プレビューを展開する" : "プレビューを折りたたむ");
      place();
    });
    const close = document.createElement("button");
    close.type = "button"; close.textContent = "×"; close.title = "プレビューをオフ（拡張機能の設定で再開）";
    close.setAttribute("aria-label", "プレビューをオフ");
    close.addEventListener("click", () => {
      enabled = false; hide(); chrome.storage.local.set({previewEnabled: false});
    });
    // Clicking panel controls does not steal the caret from the draft.
    for (const button of [collapseButton, close]) button.addEventListener("mousedown", event => event.preventDefault());
    header.append(title, status, collapseButton, close);
    body = document.createElement("div"); body.id = "body";
    panel.append(header, body); shadow.append(panel);
    document.body.append(host);
  }

  function hide() {
    if (host) { host.hidden = true; host.style.display = "none"; }
  }

  function place() {
    if (!host || !editor?.isConnected || !enabled || host.hidden) return;
    const rect = editor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const height = viewport?.height || window.innerHeight;
    const width = viewport?.width || window.innerWidth;
    const originY = viewport?.offsetTop || 0;
    const originX = viewport?.offsetLeft || 0;
    if (rect.width === 0 || rect.height === 0 || rect.bottom < originY || rect.top > originY + height) { hide(); return; }
    const panelWidth = Math.min(Math.max(rect.width, 280), 800, width - 24);
    const left = Math.max(originX + 12, Math.min(rect.left, originX + width - panelWidth - 12));
    const above = rect.top - originY - 12;
    const below = originY + height - rect.bottom - 12;
    const useAbove = above >= 100 || above >= below;
    const room = Math.max(70, useAbove ? above : below);
    host.style.width = panelWidth + "px"; host.style.left = left + "px";
    host.style.setProperty("--body-height", Math.max(25, Math.min(200, room - 50)) + "px");
    const panelHeight = host.getBoundingClientRect().height;
    host.style.top = Math.max(originY + 8, Math.min(useAbove ? rect.top - panelHeight - 8 : rect.bottom + 8, originY + height - panelHeight - 8)) + "px";
    const html = document.documentElement;
    const dark = html.classList.contains("dark") || html.dataset.theme === "dark" || getComputedStyle(html).colorScheme === "dark";
    host.toggleAttribute("data-dark", dark);
  }

  function render() {
    if (globalThis.TEX_COMPLETION?.isOpen()) { hide(); return; }
    if (!enabled || !editor?.isConnected || composing) { if (!enabled || !editor?.isConnected) hide(); return; }
    const text = editor instanceof HTMLTextAreaElement ? editor.value : editor.innerText;
    if (!text?.trim()) { previous = null; hide(); return; }
    const signature = mode + "\n" + text;
    if (previous === signature && host && !host.hidden) { place(); return; }
    previous = signature;
    const result = core.extract(text, mode);
    if (!result.count && !result.tooLong) { hide(); return; }
    createPanel(); body.replaceChildren();
    let errors = 0;
    if (result.tooLong) {
      const note = document.createElement("div"); note.className = "hint";
      note.textContent = `プレビューは${core.MAX_CHARS.toLocaleString()}文字以内の入力に対応しています。`;
      body.append(note);
    } else {
      for (const part of result.parts) {
        if (part.type === "text") { body.append(document.createTextNode(part.text)); continue; }
        const formula = document.createElement(part.display ? "div" : "span");
        formula.className = part.display ? "display" : "inline";
        if (!part.text.trim()) {
          formula.classList.add("hint"); formula.textContent = "数式を入力…";
        } else {
          try { renderer.render(core.normalize(part.text), formula, core.options(part.display)); }
          catch {
            errors++; formula.classList.add("error"); formula.textContent = part.text;
            formula.title = "入力途中、または対応していない数式です。";
          }
        }
        body.append(formula);
      }
    }
    status.textContent = result.tooLong ? "文字数の上限" : errors ? "入力途中・未対応の式があります" : "入力に合わせて更新";
    host.hidden = false; host.style.display = "block"; body.hidden = collapsed; place();
  }

  function schedule() {
    clearTimeout(timer); timer = setTimeout(render, 100);
  }
  function bind(target) {
    const next = editorFor(target);
    if (!next) return;
    if (editor !== next) {
      editor = next; previous = null; composing = false; observer.disconnect();
      if (!(editor instanceof HTMLTextAreaElement)) observer.observe(editor, {subtree: true, childList: true, characterData: true});
    }
    schedule();
  }
  function geometry() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; if (!editor?.isConnected) hide(); else render(); });
  }
  document.addEventListener("focusin", event => bind(event.target), true);
  document.addEventListener("input", event => bind(event.target), true);
  document.addEventListener("compositionstart", event => { if (editorFor(event.target)) composing = true; }, true);
  document.addEventListener("compositionend", event => { composing = false; bind(event.target); }, true);
  // React can clear/recreate an editor when a message is sent.
  document.addEventListener("keydown", event => {
    if (event.key === "Enter" && editorFor(event.target)) setTimeout(render, 200);
  }, true);
  document.addEventListener("selectionchange", () => { if (editor && !composing) schedule(); });
  document.addEventListener("tex-completion-visibility", schedule);
  window.addEventListener("resize", geometry, {passive: true});
  window.addEventListener("scroll", geometry, {passive: true, capture: true});
  window.visualViewport?.addEventListener("resize", geometry, {passive: true});
  window.visualViewport?.addEventListener("scroll", geometry, {passive: true});
  window.addEventListener("pagehide", hide);
  chrome.storage.local.get({previewEnabled: true, previewMode: "auto"}, settings => {
    enabled = settings.previewEnabled !== false;
    mode = ["auto", "math", "mixed"].includes(settings.previewMode) ? settings.previewMode : "auto";
    bind(document.activeElement);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.previewEnabled) enabled = changes.previewEnabled.newValue !== false;
    if (changes.previewMode) mode = ["auto", "math", "mixed"].includes(changes.previewMode.newValue) ? changes.previewMode.newValue : "auto";
    previous = null;
    if (!enabled) hide(); else { bind(document.activeElement); schedule(); }
  });
})();
