#!/usr/bin/env python3
"""
make_thumbs.py — Resize illustrations to 400px thumbnails, preserving transparency.

Creates a mirror of:
  /Asset Tracker/Bolt Illustrations/
into:
  /Asset Tracker/Bolt Illustrations _thumbs/

Run once (or re-run to update new files only).

Requirements:
  pip install Pillow
"""

import os
import sys
from pathlib import Path
from PIL import Image

# ── CONFIG ────────────────────────────────────────────────────────────────────
MAX_SIZE    = 400          # max width OR height in pixels
SOURCE_DIR  = "Bolt Illustrations"
DEST_DIR    = "Bolt Illustrations _thumbs"
SKIP_EXISTING = True       # set False to re-process everything
# ─────────────────────────────────────────────────────────────────────────────

def find_dropbox_root():
    """Try to auto-detect the Dropbox folder on Mac or Windows."""
    candidates = [
        Path.home() / "Dropbox",
        Path.home() / "Library/CloudStorage/Dropbox",   # macOS newer
        Path("C:/Users") / os.environ.get("USERNAME","") / "Dropbox",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None

def resize_png(src_path, dst_path, max_size):
    """Resize a PNG to fit within max_size x max_size, preserving transparency."""
    with Image.open(src_path) as img:
        # Ensure RGBA so transparency is preserved
        if img.mode not in ("RGBA", "LA"):
            img = img.convert("RGBA")
        w, h = img.size
        if w <= max_size and h <= max_size:
            # Already small enough — just copy as optimised PNG
            img.save(dst_path, "PNG", optimize=True)
            return "copied"
        # Resize preserving aspect ratio
        img.thumbnail((max_size, max_size), Image.LANCZOS)
        img.save(dst_path, "PNG", optimize=True)
        return "resized"

def main():
    # 1. Locate Dropbox root
    dbx = find_dropbox_root()
    if not dbx:
        print("❌  Could not auto-detect Dropbox folder.")
        print("    Edit the script and set dbx = Path('/your/dropbox/path')")
        sys.exit(1)

    asset_root = dbx / "Asset Tracker"
    src_root   = asset_root / SOURCE_DIR
    dst_root   = asset_root / DEST_DIR

    if not src_root.exists():
        print(f"❌  Source folder not found:\n    {src_root}")
        print("    Check the SOURCE_DIR constant at the top of the script.")
        sys.exit(1)

    print(f"📂  Source : {src_root}")
    print(f"📂  Output : {dst_root}")
    print(f"📐  Max size: {MAX_SIZE}px")
    print()

    # 2. Walk source, mirror structure in dest
    processed = skipped = errors = 0

    for src_file in sorted(src_root.rglob("*.png")):
        rel = src_file.relative_to(src_root)
        dst_file = dst_root / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)

        if SKIP_EXISTING and dst_file.exists():
            skipped += 1
            continue

        try:
            result = resize_png(src_file, dst_file, MAX_SIZE)
            processed += 1
            print(f"  ✓ [{result:>7}]  {rel}")
        except Exception as e:
            errors += 1
            print(f"  ✗ [  error]  {rel}  →  {e}")

    print()
    print(f"✅  Done — {processed} processed, {skipped} skipped, {errors} errors")
    print(f"    Thumbnails saved to:\n    {dst_root}")
    print()
    print("Next step: make sure Dropbox has finished syncing, then update")
    print(f'the app constant IMG_FOLDER_THUMBS to point to:')
    print(f'  /Asset Tracker/{DEST_DIR}')

if __name__ == "__main__":
    main()
