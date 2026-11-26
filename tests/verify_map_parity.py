#!/usr/bin/env python3
"""Prove the PNG alpha mask == the server's 1-bit 1001/fore.map.

Tile.cs reads [int32 width][int32 height][width/8+1 bytes per row], MSB first,
and treats alpha > 100 as solid. This script compares every pixel.
Requires Pillow (pip install pillow).
"""
from pathlib import Path
import struct
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: python3 -m pip install pillow")

ROOT = Path(__file__).resolve().parents[1]
PNG = ROOT / "dist/assets/map-1001-fore.png"
MAP = ROOT / "reference/map/1001/fore.map"

img = Image.open(PNG).convert("RGBA")
w, h = img.size
raw = MAP.read_bytes()
mw, mh = struct.unpack("<ii", raw[:8])
row_bytes = w // 8 + 1
payload = raw[8:]

assert (mw, mh) == (w, h), f"header {mw}x{mh} != PNG {w}x{h}"
assert len(payload) == row_bytes * h, f"payload {len(payload)} != {row_bytes * h}"

alpha = img.getchannel("A").tobytes()
mismatch = 0
solid = 0
for y in range(h):
    map_row = y * row_bytes
    png_row = y * w
    for x in range(w):
        bit = (payload[map_row + x // 8] >> (7 - x % 8)) & 1
        is_solid = alpha[png_row + x] > 100
        solid += is_solid
        mismatch += (bit == 1) != is_solid

print(f"PNG {w}x{h}; map {mw}x{mh}; solid pixels {solid:,}; mismatches {mismatch}")
assert mismatch == 0, "PNG alpha and fore.map differ"
print("PASS: display pixels and server collision bitmap are identical.")
