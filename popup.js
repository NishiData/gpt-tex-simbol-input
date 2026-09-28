"use strict";
const toggle = document.getElementById("enabled");
const previewToggle = document.getElementById("preview-enabled");
const previewMode = document.getElementById("preview-mode");
chrome.storage.local.get({ enabled: true, previewEnabled: true, previewMode: "auto" }, (value) => {
  toggle.checked = value.enabled;
  previewToggle.checked = value.previewEnabled;
  previewMode.value = value.previewMode;
});
toggle.addEventListener("change", () => chrome.storage.local.set({ enabled: toggle.checked }));
previewToggle.addEventListener("change", () => chrome.storage.local.set({ previewEnabled: previewToggle.checked }));
previewMode.addEventListener("change", () => chrome.storage.local.set({ previewMode: previewMode.value }));
const search = document.getElementById("search");
const table = document.getElementById("symbols");
function render() {
  const query = search.value.replace(/^\\/, "").toLowerCase();
  table.replaceChildren();
  const entries = Object.entries(globalThis.TEX_SYMBOLS).filter(([name, value]) =>
    name.toLowerCase().includes(query) || value.includes(query));
  for (const [name, value] of entries) {
    const row = document.createElement("tr");
    for (const text of ["\\" + name, value]) {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.append(cell);
    }
    table.append(row);
  }
  document.getElementById("count").textContent = `${entries.length} 件`;
}
search.addEventListener("input", render);
render();
