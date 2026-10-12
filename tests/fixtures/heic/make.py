"""Builds the HEIC fixtures in this folder: x265 (through ffmpeg) encodes each image as one HEVC
intra frame, and this script wraps the frames in a minimal HEIF container (ftyp, meta with
hdlr/pitm/iloc/iinf/iprp, mdat). Every image is a top-level item; the first is the primary one.

Run from the repository root: python3 -I tests/fixtures/heic/make.py
"""

import os
import struct
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def box(kind, payload):
    return struct.pack('>I', 8 + len(payload)) + kind.encode('ascii') + payload


def full_box(kind, version, flags, payload):
    return box(kind, struct.pack('>I', (version << 24) | flags) + payload)


def encode(lavfi):
    """One HEVC intra frame (Annex B) of a lavfi source graph."""
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'frame.hevc')
        subprocess.run(
            ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', lavfi, '-frames:v', '1',
             '-pix_fmt', 'yuv420p', '-c:v', 'libx265',
             '-x265-params', 'log-level=error:qp=4:frame-threads=1:pools=none:info=0',
             '-f', 'hevc', out],
            check=True,
        )
        with open(out, 'rb') as f:
            data = f.read()
    # Split on start codes (00 00 01 or 00 00 00 01)
    nals, i, starts = [], 0, []
    while True:
        j = data.find(b'\x00\x00\x01', i)
        if j < 0:
            break
        starts.append(j + 3)
        i = j + 3
    for k, s in enumerate(starts):
        end = starts[k + 1] - 3 if k + 1 < len(starts) else len(data)
        nal = data[s:end]
        while nal.endswith(b'\x00'):
            nal = nal[:-1]
        nals.append(nal)
    return nals


def nal_type(nal):
    return (nal[0] >> 1) & 0x3F


def unescape(nal):
    out, zeros = bytearray(), 0
    for b in nal:
        if zeros >= 2 and b == 3:
            zeros = 0
            continue
        out.append(b)
        zeros = zeros + 1 if b == 0 else 0
    return bytes(out)


def hvcc(vps, sps, pps):
    rbsp = unescape(sps)
    ptl = rbsp[3:15]  # profile byte, 4 compatibility, 6 constraint, level
    out = bytes([1]) + ptl[:11] + bytes([ptl[11]])
    out += struct.pack('>H', 0xF000) + bytes([0xFC, 0xFC | 1, 0xF8, 0xF8])
    out += struct.pack('>H', 0) + bytes([(1 << 3) | (1 << 2) | 3, 3])
    for nal in (vps, sps, pps):
        out += bytes([0x80 | nal_type(nal)]) + struct.pack('>HH', 1, len(nal)) + nal
    return box('hvcC', out)


def heif(images, path):
    """`images`: (width, height, lavfi) per item; item 1 is the primary image."""
    items = []
    for w, h, lavfi in images:
        nals = encode(lavfi)
        params = {nal_type(n): n for n in nals if nal_type(n) in (32, 33, 34)}
        slices = [n for n in nals if nal_type(n) < 32]
        data = b''.join(struct.pack('>I', len(n)) + n for n in slices)
        items.append((w, h, hvcc(params[32], params[33], params[34]), data))

    ftyp = box('ftyp', b'heic' + struct.pack('>I', 0) + b'mif1heic')
    hdlr = full_box('hdlr', 0, 0, struct.pack('>I', 0) + b'pict' + bytes(12) + b'\x00')
    pitm = full_box('pitm', 0, 0, struct.pack('>H', 1))
    iinf = full_box(
        'iinf', 0, 0,
        struct.pack('>H', len(items))
        + b''.join(full_box('infe', 2, 0, struct.pack('>HH', i + 1, 0) + b'hvc1\x00')
                   for i in range(len(items))),
    )
    ipco = box('ipco', b''.join(
        hvcc_box + full_box('ispe', 0, 0, struct.pack('>II', w, h)) for w, h, hvcc_box, _ in items
    ))
    ipma = full_box('ipma', 0, 0, struct.pack('>I', len(items)) + b''.join(
        struct.pack('>HBBB', i + 1, 2, 0x80 | (2 * i + 1), 2 * i + 2) for i in range(len(items))
    ))
    iprp = box('iprp', ipco + ipma)

    def iloc(offsets):
        return full_box('iloc', 0, 0, bytes([0x44, 0x00]) + struct.pack('>H', len(items)) + b''.join(
            struct.pack('>HHHII', i + 1, 0, 1, offsets[i], len(items[i][3]))
            for i in range(len(items))
        ))

    def meta(offsets):
        return full_box('meta', 0, 0, hdlr + pitm + iloc(offsets) + iinf + iprp)

    # The meta box's size doesn't depend on the offsets, so lay it out once to find mdat
    head = len(ftyp) + len(meta([0] * len(items))) + 8
    offsets, at = [], head
    for item in items:
        offsets.append(at)
        at += len(item[3])
    mdat = box('mdat', b''.join(item[3] for item in items))
    with open(path, 'wb') as f:
        f.write(ftyp + meta(offsets) + mdat)


RED, BLUE, GREEN = '0xDC141E', '0x0A28E6', '0x14C828'

heif(
    [(64, 48, f'color=c={RED}:s=32x48[a];color=c={BLUE}:s=32x48[b];[a][b]hstack')],
    os.path.join(HERE, 'halves.heic'),
)
heif(
    [
        (64, 48, f'color=c={RED}:s=64x48'),
        (32, 32, f'color=c={GREEN}:s=32x32'),
        (16, 24, f'color=c={BLUE}:s=16x24'),
    ],
    os.path.join(HERE, 'burst.heic'),
)
