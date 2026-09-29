#!/usr/bin/env python3
"""Build an installable ZIP using Python's standard library only."""
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
version = manifest["version"]
if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
    raise SystemExit("Invalid extension version in manifest.json")

files = {
    "manifest.json", "README.md", "LICENSE", "PRIVACY.md", "CHANGELOG.md",
    "THIRD_PARTY_NOTICES.md", "popup.html", "popup.css", "popup.js",
    "bookmarks.html", "bookmarks.css", "bookmarks.js", "background.js",
    "vendor/katex/LICENSE", "vendor/katex/NOTICE.txt",
}
for entry in manifest.get("content_scripts", []):
    files.update(entry.get("js", []))
    files.update(entry.get("css", []))

for name in sorted(files):
    file = (ROOT / name).resolve()
    if not file.is_relative_to(ROOT) or not file.is_file():
        raise SystemExit(f"Missing or invalid distribution file: {name}")

output = ROOT / "dist" / f"tex-symbol-input-v{version}.zip"
output.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        archive.write(ROOT / name, "tex-symbol-input/" + name)
with zipfile.ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise SystemExit("ZIP integrity check failed")
print(f"Created {output.relative_to(ROOT)} ({len(files)} files, {output.stat().st_size:,} bytes)")
