"""Builds the ISO fixtures in this folder with pycdlib (pip install pycdlib; LGPL, used only to
generate them). Timestamps are pinned so the output is reproducible.

- iso9660.iso: ISO 9660 with Joliet and Rock Ridge, volume CLIPBOX_DISC.
- udf.iso: UDF 2.60 only. pycdlib always writes an ISO 9660 bridge, so the script then rewrites the
  volume recognition sequence to BEA01/NSR03/TEA01 with no CD001 descriptors, like a UDF-only disc.

Both are written gzipped (the tests gunzip them). Run from the repository root:
python3 -I tests/fixtures/iso/make.py
"""

import gzip
import io
import os
import random
import time

import pycdlib

HERE = os.path.dirname(os.path.abspath(__file__))
EPOCH = 1767225600  # 2026-01-01T00:00:00Z
os.environ['TZ'] = 'UTC'
time.tzset()
time.time = lambda: EPOCH
random.seed(0)  # UDF volume set identifiers include random bits
SECTOR = 2048
WHEN = EPOCH


def add(iso, data, **paths):
    iso.add_fp(io.BytesIO(data), len(data), creation_time=WHEN, **paths)


def iso9660():
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=3, vol_ident='CLIPBOX_DISC', joliet=3, rock_ridge='1.09')
    iso.add_directory('/DOCS', rr_name='docs', joliet_path='/docs', creation_time=WHEN)
    add(iso, b'Hello from an ISO 9660 disc.\n',
        iso_path='/README.TXT;1', rr_name='readme.txt', joliet_path='/readme.txt')
    add(iso, b'{"disc": "iso9660", "ok": true}\n',
        iso_path='/DOCS/DATA.JSON;1', rr_name='data.json', joliet_path='/docs/data.json')
    out = io.BytesIO()
    iso.write_fp(out)
    iso.close()
    return out.getvalue()


def udf():
    iso = pycdlib.PyCdlib()
    iso.new(interchange_level=3, vol_ident='CLIPBOX_UDF', udf='2.60')
    iso.add_directory(udf_path='/notes', creation_time=WHEN)
    add(iso, b'Hello from a UDF disc.\n', udf_path='/hello.txt')
    add(iso, b'# Notes\n\nUDF keeps long, mixed-case names.\n', udf_path='/notes/Read Me First.md')
    out = io.BytesIO()
    iso.write_fp(out)
    iso.close()
    data = bytearray(out.getvalue())
    # Replace the descriptors from sector 16 on (CD001 PVD and terminator, BEA01, NSR02/3, TEA01)
    # with a UDF-only recognition sequence
    first = 16
    last = first
    known = (b'CD001', b'BEA01', b'NSR02', b'NSR03', b'TEA01')
    while bytes(data[last * SECTOR + 1:last * SECTOR + 6]) in known:
        last += 1
    data[first * SECTOR:last * SECTOR] = bytes((last - first) * SECTOR)
    for i, ident in enumerate((b'BEA01', b'NSR03', b'TEA01')):
        at = (first + i) * SECTOR
        data[at:at + 7] = b'\x00' + ident + b'\x01'
    return bytes(data)


# Gzipped (mtime 0), since an image is mostly zero padding: UDF's anchor sits at sector 256
for name, build in (('iso9660.iso.gz', iso9660), ('udf.iso.gz', udf)):
    with open(os.path.join(HERE, name), 'wb') as f:
        f.write(gzip.compress(build(), mtime=0))
