"""
Remove the square white backdrop (flood-fill from edges) and trim transparent margins.

Re-run after replacing `src/assets/brand/logo-aldepositos.png` with a new export:
  python scripts/process-logo.py
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    src = root / "src" / "assets" / "brand" / "logo-aldepositos.png"
    if len(sys.argv) >= 2:
        src = Path(sys.argv[1])
    if not src.is_file():
        print(f"Missing source: {src}", file=sys.stderr)
        sys.exit(1)

    img = Image.open(src).convert("RGBA")
    w, h = img.size
    data = img.load()
    visited = [[False] * w for _ in range(h)]
    tol = 22

    def is_backdrop_white(r: int, g: int, b: int) -> bool:
        return r >= 255 - tol and g >= 255 - tol and b >= 255 - tol

    stack: list[tuple[int, int]] = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or x >= w or y < 0 or y >= h or visited[y][x]:
            continue
        visited[y][x] = True
        r, g, b, a = data[x, y]
        if not is_backdrop_white(r, g, b):
            continue
        data[x, y] = (r, g, b, 0)
        stack.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)

    img.save(src, "PNG", optimize=True)
    print(f"Updated: {src} ({img.size[0]}×{img.size[1]})")


if __name__ == "__main__":
    main()
