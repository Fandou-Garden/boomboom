#!/usr/bin/env python3
"""Generate the three display/collision artefacts for one original Gunny map.

Given <id> in Gunny/Tank.Flash/resource/v1.1/image/map/<id>/, produce:
  dist/assets/map-<id>-fore.png   resampled 1843x1020 (palette, alpha from source)
  dist/assets/map-<id>-fore.webp  lossless WebP of the exact same pixels
  dist/assets/map-<id>-back.jpg   resampled 1843x1020 background
  dist/assets/map-<id>-thumb.jpg  240x133 picker thumbnail
  dist/data/<id>.fore.map         [int32 w][int32 h][MSB-first rows], alpha>100 solid
  dist/data/<id>.fore.map.gz      pre-gzip for static hosting (DecompressionStream)

The fore PNG/WebP and the collision bitmask come from the SAME resampled alpha
so tests/verify_map_parity.py can prove display pixels == collision pixels.

Requires Pillow. Run from the repository root:
  python3 scripts/gen-map-assets.py 1049
"""
from __future__ import annotations

import gzip
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("/Users/123jiaru/Desktop/project/game/Gunny/Tank.Flash/resource/v1.1/image/map")
W, H = 1843, 1020
THUMB = (240, 133)


def gen(map_id: str) -> None:
    src = SRC / map_id
    fore = src / "fore.png"
    back = src / "back.jpg"
    for f in (fore, back):
        if not f.exists():
            sys.exit(f"missing source file: {f}")

    # Source fore.png is palette mode with a progressive transparency table;
    # convert to RGBA first so LANCZOS resamples real alpha, then keep a
    # palette PNG (matching the other 11 maps) plus a lossless WebP.
    rgba = Image.open(fore).convert("RGBA").resize((W, H), Image.LANCZOS)
    assets = ROOT / "dist" / "assets"
    data = ROOT / "dist" / "data"
    assets.mkdir(parents=True, exist_ok=True)
    data.mkdir(parents=True, exist_ok=True)

    rgba.save(assets / f"map-{map_id}-fore.png", optimize=True)
    rgba.save(assets / f"map-{map_id}-fore.webp", "WEBP", lossless=True, exact=True)

    bg = Image.open(back).convert("RGB").resize((W, H), Image.LANCZOS)
    bg.save(assets / f"map-{map_id}-back.jpg", quality=82, optimize=True)
    rgba.convert("RGB").resize(THUMB, Image.LANCZOS).save(
        assets / f"map-{map_id}-thumb.jpg", quality=82, optimize=True
    )

    # Collision bitmask: alpha > 100 is solid (Tile.cs rule), MSB first,
    # row_bytes = w//8 + 1 (the +1 matches the original fore.map layout).
    alpha = rgba.getchannel("A")
    row_bytes = W // 8 + 1
    payload = bytearray(row_bytes * H)
    px = alpha.load()
    for y in range(H):
        base = y * row_bytes
        for x in range(W):
            if px[x, y] > 100:
                payload[base + (x >> 3)] |= 1 << (7 - (x & 7))
    blob = struct.pack("<ii", W, H) + bytes(payload)
    (data / f"{map_id}.fore.map").write_bytes(blob)
    with gzip.open(data / f"{map_id}.fore.map.gz", "wb", compresslevel=9) as gz:
        gz.write(blob)

    solid = sum(bin(b).count("1") for b in payload)
    print(f"map {map_id}: fore {W}x{H}, solid~{solid} bits, "
          f"map {len(blob)}B, gz {(data / f'{map_id}.fore.map.gz').stat().st_size}B")


if __name__ == "__main__":
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        sys.exit("usage: gen-map-assets.py <map-id>")
    gen(sys.argv[1])
