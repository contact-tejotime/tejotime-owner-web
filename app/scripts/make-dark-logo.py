"""Generate a dark-mode variant of logo-full.png.

Only the near-black navy (wordmark + tagline + clock outline) is lifted to near-white; the orange
"Time" and the blue calendar tile are left alone. Luminance separates them cleanly:
navy ~0.03, calendar blue ~0.12, orange ~0.35.
"""
import struct, zlib, sys

SRC, DST = sys.argv[1], sys.argv[2]
THRESHOLD = 0.075          # below this relative luminance -> treat as "ink"
INK = (248, 250, 252)      # gray50, matches darkColors.textStrong


def load(path):
    d = open(path, 'rb').read()
    pos, idat, pal = 8, b'', None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos + 4])[0]
        typ = d[pos + 4:pos + 8]
        data = d[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, comp, filt, il = struct.unpack('>IIBBBBB', data)
        elif typ == b'IDAT':
            idat += data
        elif typ == b'PLTE':
            pal = data
        pos += 12 + ln
    assert bd == 8 and ct in (6, 2) and il == 0, f'unsupported PNG: bd={bd} ct={ct} il={il}'
    ch = 4 if ct == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * ch
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        for k in range(stride):
            a = line[k - ch] if k >= ch else 0
            b = prev[k]
            c = prev[k - ch] if k >= ch else 0
            if f == 1: line[k] = (line[k] + a) & 255
            elif f == 2: line[k] = (line[k] + b) & 255
            elif f == 3: line[k] = (line[k] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[k] = (line[k] + pr) & 255
        rows.append(line); prev = line
    return w, h, ch, rows


def lum(r, g, b):
    f = []
    for v in (r, g, b):
        v /= 255
        f.append(v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]


w, h, ch, rows = load(SRC)
changed = 0
for line in rows:
    for x in range(w):
        o = x * ch
        r, g, b = line[o], line[o + 1], line[o + 2]
        alpha = line[o + 3] if ch == 4 else 255
        if alpha > 0 and lum(r, g, b) < THRESHOLD:
            line[o], line[o + 1], line[o + 2] = INK
            changed += 1

out = b''.join(b'\x00' + bytes(line) for line in rows)


def chunk(typ, data):
    return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', zlib.crc32(typ + data) & 0xffffffff)


png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6 if ch == 4 else 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(out, 9))
       + chunk(b'IEND', b''))
open(DST, 'wb').write(png)
print(f'  {w}x{h}, {changed} px recoloured -> {DST}')
