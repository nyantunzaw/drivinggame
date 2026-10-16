"""Convert the raw Overture/OpenStreetMap extract of Yangon into data/yangon.json.

Usage:
    pip install pyarrow shapely
    python tools/fetch_overture.py tools/raw
    python tools/build_map.py tools/raw data/yangon.json

World coordinates are metres: +x = east, +z = south (three.js convention, -z is
north). The origin is Sule Pagoda, the traditional centre of downtown Yangon.
Polylines/polygons are stored as integer, delta-encoded coordinate lists to keep
the file small:  [x0, z0, dx1, dz1, dx2, dz2, ...]  (units given per layer).
"""
import hashlib
import json
import math
import os
import sys
from collections import defaultdict

import pyarrow.parquet as pq
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import substring, unary_union
import numpy as np
from shapely.strtree import STRtree

LAT0, LON0 = 16.77437, 96.15877          # Sule Pagoda
MLAT = 110600.0
MLON = 111320.0 * math.cos(math.radians(LAT0))
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = 96.126, 96.186, 16.758, 16.850


def px(lon, lat):
    return (lon - LON0) * MLON, -(lat - LAT0) * MLAT


def proj(geom):
    return shapely.transform(geom, lambda c: np.column_stack(((c[:, 0] - LON0) * MLON, -(c[:, 1] - LAT0) * MLAT)))


BX0, BZ1 = px(LON_MIN, LAT_MIN)
BX1, BZ0 = px(LON_MAX, LAT_MAX)
WORLD = box(BX0, BZ0, BX1, BZ1)
WORLD_PAD = WORLD.buffer(250, join_style=2)


def rnd(seed_str):
    h = hashlib.md5(seed_str.encode()).digest()
    return int.from_bytes(h[:4], "little") / 2 ** 32


def delta(coords, unit):
    out = []
    px_, pz_ = 0, 0
    for i, (x, z) in enumerate(coords):
        ix, iz = int(round(x / unit)), int(round(z / unit))
        if i == 0:
            out += [ix, iz]
        else:
            if ix == px_ and iz == pz_:
                continue
            out += [ix - px_, iz - pz_]
        px_, pz_ = ix, iz
    return out


def ring(poly, unit, simplify):
    p = poly.simplify(simplify, preserve_topology=True) if simplify else poly
    if p.is_empty:
        return None
    coords = list(p.exterior.coords)[:-1] if isinstance(p, Polygon) else None
    if not coords or len(coords) < 3:
        return None
    return delta(coords, unit)


def polys(geom):
    if geom is None or geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    if hasattr(geom, "geoms"):
        out = []
        for g in geom.geoms:
            out += polys(g)
        return out
    return []


def load(raw, name, cols):
    return pq.read_table(os.path.join(raw, name + ".parquet"), columns=cols).to_pylist()


def en_name(names):
    if not names:
        return None
    common = dict(names.get("common") or [])
    if common.get("en"):
        return common["en"]
    prim = names.get("primary")
    return prim


class Strings:
    def __init__(self):
        self.idx, self.list = {}, []

    def get(self, s):
        if s is None:
            return -1
        if s not in self.idx:
            self.idx[s] = len(self.list)
            self.list.append(s)
        return self.idx[s]


# ---------------------------------------------------------------- landmarks
LANDMARKS = {
    # id: (lat, lon, english name, burmese name)
    "shwedagon": (16.79834, 96.14961, "Shwedagon Pagoda", "ရွှေတိဂုံစေတီ"),
    "sule": (16.77437, 96.15877, "Sule Pagoda", "ဆူးလေစေတီ"),
    "botataung": (16.76846, 96.17199, "Botataung Pagoda", "ဗိုလ်တထောင်စေတီ"),
    "mahawizaya": (16.79491, 96.15216, "Maha Wizaya Pagoda", "မဟာဝိဇယစေတီ"),
    "karaweik": (16.79523, 96.16820, "Karaweik Palace", "ကရဝိက်နန်းတော်"),
    "independence": (16.77311, 96.15949, "Independence Monument", "လွတ်လပ်ရေးကျောက်တိုင်"),
    "strand": (16.76959, 96.16259, "The Strand Hotel", "စထရင်းဟိုတယ်"),
    "cityhall": (16.77504, 96.15968, "Yangon City Hall", "ရန်ကုန်မြို့တော်ခန်းမ"),
    "bogyoke": (16.78034, 96.15559, "Bogyoke Aung San Market", "ဗိုလ်ချုပ်အောင်ဆန်းဈေး"),
    "station": (16.78160, 96.16128, "Yangon Central Station", "ရန်ကုန်ဘူတာကြီး"),
    "secretariat": (16.77546, 96.16585, "The Secretariat", "ဝန်ကြီးများရုံး"),
    "junctioncity": (16.77895, 96.15427, "Junction City", "ဂျန်ရှင်းစီးတီး"),
    "sakura": (16.77905, 96.15939, "Sakura Tower", "ဆာကူရာတာဝါ"),
    "hospital": (16.77839, 96.15051, "Yangon General Hospital", "ရန်ကုန်ဆေးရုံကြီး"),
    "peoplespark": (16.79881, 96.14238, "People's Park", "ပြည်သူ့ဥယျာဉ်"),
    "zoo": (16.79172, 96.15944, "Yangon Zoological Gardens", "တိရစ္ဆာန်ဥယျာဉ်"),
    "stadium": (16.78304, 96.16148, "Aung San Stadium", "အောင်ဆန်းအားကစားကွင်း"),
    "chaukhtatgyi": (16.81166, 96.16388, "Chaukhtatgyi Buddha", "ခြောက်ထပ်ကြီးဘုရား"),
    "myanmarplaza": (16.82792, 96.15547, "Myanmar Plaza", "မြန်မာပလာဇာ"),
    "hledan": (16.82613, 96.13029, "Hledan Centre", "လှည်းတန်းစင်တာ"),
    "university": (16.83016, 96.13521, "University of Yangon", "ရန်ကုန်တက္ကသိုလ်"),
    "inya": (16.83864, 96.14489, "Inya Lake", "အင်းလျားကန်"),
    "kandawgyi": (16.79642, 96.16435, "Kandawgyi Lake", "ကန်တော်ကြီး"),
    "nanthida": (16.76763, 96.16249, "Nan Thida Jetty", "နန်းသီတာဆိပ်ကမ်း"),
    "theatre": (16.78382, 96.14935, "National Theatre", "အမျိုးသားပြဇာတ်ရုံ"),
    "chinatown": (16.77650, 96.14950, "Chinatown (19th Street)", "တရုတ်တန်း"),
    "highcourt": (16.77307, 96.16090, "High Court", "တရားလွှတ်တော်"),
    "parliament": (16.79490, 96.13731, "Regional Parliament", "တိုင်းဒေသကြီးလွှတ်တော်"),
}
# Procedurally modelled landmarks: remove the OSM footprints underneath them.
EXCLUDE = {"shwedagon": 175, "sule": 24, "botataung": 26, "mahawizaya": 40, "karaweik": 55,
           "independence": 14}

# Hand-tuned heights for well known towers (metres).
TOWERS = {"Sakura Tower": 88, "Sule Shangri-La": 80, "Junction City": 34,
          "Junction City Office Tower": 104, "Parkroyal Yangon": 48, "Melia Hotel": 70,
          "Myanmar Plaza": 36, "Novotel Yangon Max": 75, "LOTTE HOTEL YANGON": 85,
          "Diamond Inya Palace Condo": 105, "Pearl Condo": 60, "Crystal Tower": 70,
          "Hledan Centre": 40, "The Strand Hotel": 16, "Strand Hotel - Bellroom": 14,
          "Yangon City Hall": 22, "ရန်ကုန်မြို့တော်ခန်းမ": 22, "ဝန်ကြီးများရုံး": 18,
          "ရန်ကုန် ဘူတာကြီး": 18, "High Court": 26, "Times City": 90}

ROAD_CLS = {"motorway": 0, "trunk": 0, "primary": 1, "secondary": 2, "tertiary": 3,
            "residential": 4, "unclassified": 4, "living_street": 4, "unknown": 4,
            "service": 5, "track": 5, "pedestrian": 6, "footway": 6, "path": 6,
            "steps": 6, "cycleway": 6, "sidewalk": 6, "crosswalk": 6, "bridleway": 6}
ROAD_HALF = [7.5, 7.0, 5.5, 4.5, 3.5, 2.2, 1.3]


def main():
    raw = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "raw")
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "data", "yangon.json")
    S = Strings()
    data = {
        "v": 1,
        "origin": [LAT0, LON0],
        "scale": [MLAT, MLON],
        "bounds": [round(BX0), round(BZ0), round(BX1), round(BZ1)],
        "attribution": "© OpenStreetMap contributors (ODbL), Overture Maps Foundation, Microsoft ML Buildings",
    }

    # ------------------------------------------------------------ roads/graph
    segs = load(raw, "transportation_segment",
                ["id", "names", "subtype", "class", "connectors", "geometry", "road_flags",
                 "access_restrictions", "level_rules"])
    # Burmese -> English road name lookup from segments that carry both.
    my2en = {}
    for s in segs:
        n = s["names"]
        if n and n.get("primary"):
            en = dict(n.get("common") or []).get("en")
            if en:
                my2en.setdefault(n["primary"], en)

    node_pos = defaultdict(list)
    raw_edges = []
    rails = []
    for s in segs:
        geom = proj(shapely.from_wkb(s["geometry"]))
        if not isinstance(geom, LineString) or geom.length < 0.5:
            continue
        if not geom.intersects(WORLD_PAD):
            continue
        if s["subtype"] == "rail":
            if geom.intersects(WORLD):
                rails.append(delta(list(geom.simplify(1.0).coords), 0.1))
            continue
        if s["subtype"] != "road":
            continue
        cls = ROAD_CLS.get(s["class"], 4)
        name = None
        if s["names"]:
            prim = s["names"].get("primary")
            name = dict(s["names"].get("common") or []).get("en") or my2en.get(prim) or prim
        oneway = 0
        for ar in s["access_restrictions"] or []:
            w = ar.get("when") or {}
            if ar["access_type"] == "denied" and w.get("heading") and not w.get("mode") and not ar.get("between"):
                oneway = 1 if w["heading"] == "backward" else -1
        bridge = 0
        for rf in s["road_flags"] or []:
            if "is_bridge" in (rf.get("values") or []):
                bridge = 1
        conns = sorted(s["connectors"] or [], key=lambda c: c["at"])
        if not conns or conns[0]["at"] > 1e-6:
            conns = [{"connector_id": s["id"] + ":s", "at": 0.0}] + conns
        if conns[-1]["at"] < 1 - 1e-6:
            conns = conns + [{"connector_id": s["id"] + ":e", "at": 1.0}]
        L = geom.length
        for c in conns:
            p = geom.interpolate(c["at"] * L)
            node_pos[c["connector_id"]].append((p.x, p.y))
        for a, b in zip(conns, conns[1:]):
            if b["at"] - a["at"] < 1e-9:
                continue
            part = substring(geom, a["at"] * L, b["at"] * L)
            if part.length < 0.5:
                continue
            raw_edges.append((a["connector_id"], b["connector_id"], cls, name, oneway, bridge, part))

    node_ids = {}
    nodes = []

    def node(cid):
        if cid not in node_ids:
            pts = node_pos[cid]
            x = sum(p[0] for p in pts) / len(pts)
            z = sum(p[1] for p in pts) / len(pts)
            node_ids[cid] = len(nodes) // 2
            nodes.extend([int(round(x * 10)), int(round(z * 10))])
        return node_ids[cid]

    edges = []
    road_lines = []
    for a, b, cls, name, oneway, bridge, part in raw_edges:
        mid = part.interpolate(0.5, normalized=True)
        if not WORLD_PAD.contains(mid):
            continue
        ia, ib = node(a), node(b)
        coords = list(part.simplify(0.4).coords)
        coords[0] = (nodes[ia * 2] / 10, nodes[ia * 2 + 1] / 10)
        coords[-1] = (nodes[ib * 2] / 10, nodes[ib * 2 + 1] / 10)
        edges.append([ia, ib, cls, S.get(name), oneway, bridge] + delta(coords, 0.1))
        if cls <= 5:
            road_lines.append((part, cls))
    data["nodes"] = nodes
    data["edges"] = edges
    data["rail"] = rails
    print("roads:", len(edges), "edges,", len(nodes) // 2, "nodes,", len(rails), "rail lines")

    road_buf_tree_geoms = [ln.buffer(ROAD_HALF[c] * 0.55, cap_style=2) for ln, c in road_lines]
    road_tree = STRtree(road_buf_tree_geoms)

    # ------------------------------------------------------------------ water
    water_raw = load(raw, "base_water", ["subtype", "class", "names", "geometry"])
    wpolys = []
    for w in water_raw:
        if w["class"] in ("swimming_pool", "fountain", "reflecting_pool", "ocean"):
            continue
        g = proj(shapely.from_wkb(w["geometry"]))
        if not g.intersects(WORLD_PAD):
            continue
        if g.geom_type in ("LineString", "MultiLineString"):
            width = 6 if w["subtype"] in ("stream", "canal", "drain", "ditch") else 14
            if w["subtype"] in ("drain", "ditch"):
                continue
            g = g.buffer(width / 2, cap_style=1)
        g = g.intersection(WORLD_PAD)
        for p in polys(g):
            if p.area > 150:
                wpolys.append(p)
    water = unary_union(wpolys)
    water_out = []
    for p in polys(water):
        p = p.simplify(1.2, preserve_topology=True)
        if p.area < 150:
            continue
        rings = [delta(list(p.exterior.coords)[:-1], 0.5)]
        for hole in p.interiors:
            hp = Polygon(hole)
            if hp.area > 400:
                rings.append(delta(list(hole.coords)[:-1], 0.5))
        water_out.append(rings)
    data["water"] = water_out
    water_list = polys(water)
    water_tree = STRtree(water_list)
    print("water polygons:", len(water_out))

    # ----------------------------------------------------------- green / plazas
    GREEN = {"park": 0, "grass": 0, "garden": 0, "recreation_ground": 0, "village_green": 0,
             "playground": 0, "meadow": 0, "flowerbed": 0, "zoo": 0, "golf_course": 0,
             "driving_range": 0, "grassland": 0, "pitch": 1, "track": 1, "stadium": 1,
             "forest": 2, "wood": 2, "wetland": 2, "cemetery": 2, "grave_yard": 2,
             "religious": 3, "pedestrian": 3}
    green_src = load(raw, "base_land_use", ["class", "subtype", "names", "geometry"]) + \
        load(raw, "base_land", ["class", "subtype", "names", "geometry"])
    green_out = []
    green_polys = []
    for g in green_src:
        t = GREEN.get(g["class"])
        if t is None:
            continue
        geom = proj(shapely.from_wkb(g["geometry"]))
        if geom.geom_type not in ("Polygon", "MultiPolygon") or not geom.intersects(WORLD):
            continue
        geom = geom.intersection(WORLD_PAD)
        for p in polys(geom):
            if p.area < 200:
                continue
            r = ring(p, 0.5, 1.0)
            if r:
                green_out.append([t, r])
                green_polys.append((t, p))
    # draw large areas first so small pitches/plazas sit on top
    order = sorted(range(len(green_out)), key=lambda i: -green_polys[i][1].area)
    data["green"] = [green_out[i] for i in order]
    print("green polygons:", len(green_out))

    # ---------------------------------------------------------------- buildings
    blds = load(raw, "buildings_building",
                ["id", "names", "class", "subtype", "height", "num_floors", "geometry", "is_underground"])
    excl = []
    for k, r in EXCLUDE.items():
        lat, lon = LANDMARKS[k][:2]
        excl.append(Point(px(lon, lat)).buffer(r))
    excl = unary_union(excl)
    core = Polygon([px(96.140, 16.7675), px(96.1760, 16.7665), px(96.1760, 16.7840), px(96.140, 16.7850)])
    TYPE = {"residential": 1, "outbuilding": 1, "commercial": 2, "religious": 3, "civic": 4,
            "education": 5, "medical": 5, "industrial": 6, "transportation": 6, "agricultural": 1,
            "entertainment": 2, "military": 4, "service": 6}
    bout = []
    stats = defaultdict(int)
    for b in blds:
        if b["is_underground"]:
            continue
        geom = proj(shapely.from_wkb(b["geometry"]))
        for p in polys(geom):
            c = p.centroid
            if not WORLD.contains(c):
                stats["outside"] += 1
                continue
            if p.area < 22:
                stats["tiny"] += 1
                continue
            if excl.intersects(p):
                stats["landmark"] += 1
                continue
            hits = water_tree.query(p, predicate="intersects")
            if len(hits) and sum(water_list[i].intersection(p).area for i in hits) > 0.3 * p.area:
                stats["water"] += 1
                continue
            if len(road_tree.query(p, predicate="intersects")):
                stats["road"] += 1
                continue
            p = p.simplify(0.45, preserve_topology=True)
            if p.is_empty or not isinstance(p, Polygon):
                continue
            coords = list(p.exterior.coords)[:-1]
            if len(coords) > 24:
                p = p.simplify(1.2, preserve_topology=True)
                coords = list(p.exterior.coords)[:-1]
            if len(coords) < 3:
                continue
            name = en_name(b["names"]) or ""
            prim = (b["names"] or {}).get("primary") or ""
            seed = rnd(b["id"])
            area = p.area
            t = TYPE.get(b["subtype"], 0)
            if b["class"] in ("house", "detached", "hut", "bungalow"):
                t = 1
            if b["class"] in ("temple", "shrine", "monastery", "church", "mosque", "pagoda"):
                t = 3
            if "စေတီ" in prim or "pagoda" in name.lower() or "paya" in name.lower():
                t = 3
            if name in TOWERS or prim in TOWERS:
                h = TOWERS.get(name) or TOWERS.get(prim)
            elif b["height"]:
                h = b["height"]
            elif b["num_floors"]:
                h = b["num_floors"] * 3.3 + 0.5
            else:
                in_core = core.contains(c)
                if in_core:
                    floors = 3 + int(seed * 4) if area < 900 else 4 + int(seed * 7)
                    if area > 2500 and seed > 0.6:
                        floors += 6
                elif area < 70:
                    floors = 1 + int(seed * 1.6)
                elif area < 250:
                    floors = 1 + int(seed * 3)
                elif area < 1200:
                    floors = 2 + int(seed * 6)
                else:
                    floors = 3 + int(seed * 8)
                    if seed > 0.85:
                        floors += 8
                if t == 3:
                    floors = min(floors, 2)
                h = floors * 3.3 + 0.4
            h = max(3.0, min(h, 140))
            ring_ = delta(coords, 0.5)
            bout.append([t, int(round(h * 2))] + ring_)
            stats["kept"] += 1
    data["buildings"] = bout
    print("buildings:", dict(stats))

    # -------------------------------------------------------------------- trees
    trees = []
    land = load(raw, "base_land", ["class", "geometry"])

    def free(pt):
        return not len(water_tree.query(pt, predicate="intersects"))

    for g in land:
        geom = proj(shapely.from_wkb(g["geometry"]))
        if not geom.intersects(WORLD):
            continue
        if g["class"] == "tree" and geom.geom_type == "Point":
            trees.append((geom.x, geom.y))
        elif g["class"] == "tree_row" and geom.geom_type == "LineString":
            n = int(geom.length // 9)
            for i in range(n + 1):
                p = geom.interpolate(i * 9)
                trees.append((p.x, p.y))
    for t, p in green_polys:
        if t not in (0, 2) or p.area < 600:
            continue
        dens = 260 if t == 0 else 140
        n = min(int(p.area / dens), 900)
        minx, miny, maxx, maxy = p.bounds
        k = 0
        tries = 0
        seed = rnd(str(p.centroid))
        while k < n and tries < n * 4:
            tries += 1
            u = rnd(f"{seed}:{tries}:x")
            v = rnd(f"{seed}:{tries}:z")
            q = Point(minx + (maxx - minx) * u, miny + (maxy - miny) * v)
            if p.contains(q) and free(q):
                trees.append((q.x, q.y))
                k += 1
    # roadside rain trees along the big avenues
    for ln, c in road_lines:
        if c > 2 or ln.length < 40:
            continue
        off = ROAD_HALF[c] + 2.2
        n = int(ln.length // 22)
        for i in range(1, n):
            d = i * 22
            p0 = ln.interpolate(d - 1)
            p1 = ln.interpolate(d + 1)
            dx, dz = p1.x - p0.x, p1.y - p0.y
            L = math.hypot(dx, dz) or 1
            nx, nz = -dz / L, dx / L
            for side in (-1, 1):
                q = Point(p0.x + dx / 2 + nx * off * side, p0.y + dz / 2 + nz * off * side)
                if rnd(f"{q.x:.1f},{q.y:.1f}") < 0.55 and free(q):
                    trees.append((q.x, q.y))
    flat = []
    for x, z in trees:
        if WORLD.contains(Point(x, z)):
            flat += [int(round(x)), int(round(z))]
    data["trees"] = flat
    print("trees:", len(flat) // 2)

    # ---------------------------------------------------------------- districts
    divs = load(raw, "divisions_division_area", ["subtype", "names", "geometry"])
    dout = []
    for d in divs:
        if d["subtype"] != "county":
            continue
        name = en_name(d["names"])
        prim = (d["names"] or {}).get("primary")
        if not name or name in ("Yangon City", "Dala Township"):
            continue
        geom = proj(shapely.from_wkb(d["geometry"])).intersection(WORLD_PAD)
        for p in polys(geom):
            if p.area < 20000:
                continue
            r = ring(p, 1.0, 6.0)
            if r:
                dout.append([S.get(name), S.get(prim), r])
    data["districts"] = dout
    print("districts:", len(dout))

    lm = {}
    for k, (lat, lon, en, my) in LANDMARKS.items():
        x, z = px(lon, lat)
        lm[k] = [round(x, 1), round(z, 1), en, my]
    data["landmarks"] = lm
    data["names"] = S.list

    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", out, os.path.getsize(out) // 1024, "KB")
    render_radar(data, os.path.join(os.path.dirname(out), "radar.webp"))


def render_radar(data, path, mpp=4.0):
    """Pre-render the minimap base image (drawing 50k footprints in a phone browser is slow)."""
    from PIL import Image, ImageDraw

    ss = 2  # supersample for anti-aliasing
    x0, z0, x1, z1 = data["bounds"]
    W, H = int(math.ceil((x1 - x0) / mpp)), int(math.ceil((z1 - z0) / mpp))
    img = Image.new("RGB", (W * ss, H * ss), (0x26, 0x30, 0x3d))
    d = ImageDraw.Draw(img)

    def pts(arr, unit):
        out, x, z = [], 0, 0
        for i in range(0, len(arr), 2):
            if i == 0:
                x, z = arr[0], arr[1]
            else:
                x += arr[i]
                z += arr[i + 1]
            out.append(((x * unit - x0) / mpp * ss, (z * unit - z0) / mpp * ss))
        return out

    greens = [(0x2f, 0x5b, 0x3c), (0x3c, 0x70, 0x48), (0x2a, 0x4f, 0x33), (0x5a, 0x54, 0x46)]
    for t, r in data["green"]:
        p = pts(r, 0.5)
        if len(p) > 2:
            d.polygon(p, fill=greens[t])
    for rings in data["water"]:
        p = pts(rings[0], 0.5)
        if len(p) > 2:
            d.polygon(p, fill=(0x1f, 0x6d, 0x8c))
        for h in rings[1:]:
            q = pts(h, 0.5)
            if len(q) > 2:
                d.polygon(q, fill=(0x26, 0x30, 0x3d))
    for b in data["buildings"]:
        p = pts(b[2:], 0.5)
        if len(p) > 2:
            d.polygon(p, fill=(0x32, 0x3d, 0x4c))
    for r in data["rail"]:
        d.line(pts(r, 0.1), fill=(0x8a, 0x6f, 0x5a), width=2)
    widths = [7, 6, 5, 4, 3, 2, 1]
    cols = [(0xf2, 0xd2, 0x7a), (0xe9, 0xe3, 0xd0), (0xd9, 0xd6, 0xcc), (0xc3, 0xc2, 0xbd), (0x9d, 0xa3, 0xad), (0x7d, 0x85, 0x91), (0x6a, 0x72, 0x80)]
    for cls in range(6, -1, -1):
        for e in data["edges"]:
            if e[2] != cls:
                continue
            p = pts(e[6:], 0.1)
            d.line(p, fill=cols[cls], width=widths[cls], joint="curve")
    img = img.resize((W, H), Image.LANCZOS)
    img.save(path, quality=86, method=6)
    print("wrote", path, os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
