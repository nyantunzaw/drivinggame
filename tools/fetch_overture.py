"""Download the raw Yangon map extract from Overture Maps (OpenStreetMap-derived).

Usage:
    pip install pyarrow
    python tools/fetch_overture.py [out_dir]

Writes one GeoParquet file per theme/type into out_dir (default: tools/raw).
Only row groups overlapping the Yangon bounding box are read, so the download
is small (~20 MB) even though the Overture release is global.
"""
import os
import sys
import time

import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.fs as pfs
import pyarrow.parquet as pq

RELEASE = "2026-09-23.0"
# Slightly larger than the playable area so roads/water crossing the border are kept.
XMIN, XMAX, YMIN, YMAX = 96.115, 96.195, 16.755, 16.855

LAYERS = [
    ("transportation", "segment"),
    ("buildings", "building"),
    ("base", "water"),
    ("base", "land_use"),
    ("base", "land"),
    ("base", "infrastructure"),
    ("places", "place"),
    ("divisions", "division_area"),
]


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "raw")
    os.makedirs(out_dir, exist_ok=True)
    fs = pfs.S3FileSystem(anonymous=True, region="us-west-2",
                          proxy_options=os.environ.get("HTTPS_PROXY"))
    base = f"overturemaps-us-west-2/release/{RELEASE}/"
    for theme, typ in LAYERS:
        t0 = time.time()
        dataset = ds.dataset(base + f"theme={theme}/type={typ}", filesystem=fs, format="parquet")
        flt = ((pc.field("bbox", "xmin") <= XMAX) & (pc.field("bbox", "xmax") >= XMIN) &
               (pc.field("bbox", "ymin") <= YMAX) & (pc.field("bbox", "ymax") >= YMIN))
        table = dataset.to_table(filter=flt)
        pq.write_table(table, os.path.join(out_dir, f"{theme}_{typ}.parquet"))
        print(f"{theme}/{typ}: {table.num_rows} rows in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
