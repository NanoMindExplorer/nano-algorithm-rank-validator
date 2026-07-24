#!/usr/bin/env bash
# Build a Chrome extension distribution zip for NARV.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")"
OUT_DIR="${ROOT}/dist"
NAME="nano-algorithm-rank-validator-v${VERSION}"
ZIP="${OUT_DIR}/${NAME}.zip"
mkdir -p "$OUT_DIR"

STORE_MODE="${NARV_STORE_PACKAGE:-0}"

python3 - "$ZIP" "$NAME" "$STORE_MODE" <<'PY'
import sys, zipfile, json
from pathlib import Path

out, name, store = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
root = Path(".")
skip = {".git", "dist", "__pycache__"}
# For store package, also drop sidecar/scripts/tests/docs/github
store_skip = {"sidecar", "scripts", "test", "docs", ".github"} if store else set()

count = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        parts = set(p.parts)
        if parts & skip:
            continue
        if parts & store_skip:
            continue
        if p.suffix == ".pyc":
            continue
        if p.name in (".DS_Store",):
            continue
        z.write(p, f"{name}/{p.as_posix()}")
        count += 1
print(f"Packed {count} files -> {out}")
PY

python3 - <<PY
import hashlib
from pathlib import Path
p = Path("$ZIP")
h = hashlib.sha256(p.read_bytes()).hexdigest()
Path(str(p) + ".sha256").write_text(f"{h}  {p.name}\n")
print(h, p.name, p.stat().st_size)
PY

echo "Built: $ZIP"
ls -lh "$ZIP"
