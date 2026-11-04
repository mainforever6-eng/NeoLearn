import struct, zlib, math

SIZE = 1024
SS = 2
W = SIZE * SS

def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

TOP = (46, 125, 50)
BOTTOM = (27, 94, 32)
WHITE = (255, 255, 255)

def dist_seg(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    t = (wx * vx + wy * vy) / (vx * vx + vy * vy)
    t = max(0.0, min(1.0, t))
    dx, dy = px - (ax + t * vx), py - (ay + t * vy)
    return math.hypot(dx, dy)

stroke = 96 * SS
sq = SS * SS
sx, sy = 330 * SS, 324 * SS
ex, ey = 700 * SS, 700 * SS
segments = [
    (sx, sy, sx, ey),
    (ex, sy, ex, ey),
    (sx, sy, ex, ey),
]

pixels = bytearray(W * W * 4)
for y in range(W):
    ty = y / (W - 1)
    bg = lerp(TOP, BOTTOM, ty)
    for x in range(W):
        i = (y * W + x) * 4
        if min(dist_seg(x, y, *seg) for seg in segments) <= stroke / 2:
            r, g, b = WHITE
        else:
            r, g, b = bg
        pixels[i] = r
        pixels[i + 1] = g
        pixels[i + 2] = b
        pixels[i + 3] = 255

# downsample by SS with box filter
out = bytearray(SIZE * SIZE * 4)
for y in range(SIZE):
    for x in range(SIZE):
        rs = gs = bs = 0
        for dy in range(SS):
            row = (y * SS + dy) * W
            for dx in range(SS):
                i = (row + x * SS + dx) * 4
                rs += pixels[i]
                gs += pixels[i + 1]
                bs += pixels[i + 2]
        o = (y * SIZE + x) * 4
        out[o] = rs // sq
        out[o + 1] = gs // sq
        out[o + 2] = bs // sq
        out[o + 3] = 255

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

raw = bytearray()
for y in range(SIZE):
    raw.append(0)
    raw += out[y * SIZE * 4:(y + 1) * SIZE * 4]

png = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
png += chunk(b"IEND", b"")

with open("src-tauri/icons/icon.png", "wb") as f:
    f.write(png)
print("wrote", len(png), "bytes")
