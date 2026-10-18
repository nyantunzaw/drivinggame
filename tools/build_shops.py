"""Real shops for Chinatown (Latha): every named place between Lanmadaw Road and Latha Road,
from Strand Road up to Bogyoke Aung San Road, taken from the Overture Maps places theme.

Usage:
    pip install pyarrow shapely python-myanmar myanmartools
    python tools/build_shops.py tools/raw data/shops.json

Output: {"attribution": ..., "shops": [[x, z, kind, line1, line2, upper], ...]}
  x, z   metres from Sule Pagoda (same projection as build_map.py)
  kind   simplified category used to pick the shopfront (gold, food, tea, phone, ...)
  line1  main sign text, line2 secondary text (other script) or ""
  upper  1 if the business is usually upstairs (clinics, schools, gyms): banner sign, no shopfront
"""
import json
import math
import os
import re
import sys

import pyarrow.parquet as pq
from shapely import wkb

LAT0, LON0 = 16.77437, 96.15877          # Sule Pagoda (must match build_map.py)
MLAT = 110600.0
MLON = 111320.0 * math.cos(math.radians(LAT0))

# Lanmadaw Road .. Latha Road (with a margin for the buildings facing them), Strand Rd .. Bogyoke Rd
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = 96.1472, 96.1508, 16.7716, 16.7812
MIN_CONFIDENCE = 0.35

KINDS = [
    ('gold', ['jewelry', 'gold', 'watch']),
    ('tea', ['cafe', 'coffee', 'tea', 'juice', 'smoothie']),
    ('icecream', ['ice_cream', 'dessert', 'bakery', 'patisserie', 'cake', 'donut']),
    ('bar', ['bar', 'pub', 'lounge', 'beer', 'night_club', 'karaoke']),
    ('food', ['restaurant', 'food', 'diner', 'noodle', 'eatery', 'hot_pot', 'barbecue', 'buffet']),
    ('phone', ['mobile_phone', 'electronic', 'computer', 'telecommunications', 'camera', 'appliance']),
    ('pharmacy', ['pharmacy', 'drugstore', 'medical_supply', 'herbal']),
    ('clinic', ['dental', 'clinic', 'doctor', 'health', 'laboratory', 'physical_therapy', 'optometrist', 'hospital', 'medical']),
    ('hotel', ['hotel', 'hostel', 'guest_house', 'motel', 'inn', 'lodging']),
    ('bank', ['bank', 'atm', 'currency', 'financial', 'money', 'insurance']),
    ('beauty', ['beauty', 'spa', 'hair', 'nail', 'barber', 'massage', 'cosmetic']),
    ('grocery', ['grocery', 'convenience', 'supermarket', 'warehouse', 'market', 'liquor', 'tobacco']),
    ('clothes', ['clothing', 'fashion', 'shoe', 'textile', 'fabric', 'tailor', 'bag', 'accessor']),
    ('school', ['school', 'education', 'tutor', 'college', 'university', 'training', 'language']),
    ('gym', ['gym', 'fitness', 'martial', 'dance', 'yoga', 'sports', 'recreation', 'billiard']),
    ('office', ['service', 'agency', 'office', 'travel', 'tour', 'advertis', 'consult', 'legal', 'real_estate', 'event']),
    ('shop', ['store', 'shop', 'supplier', 'wholesale', 'hardware', 'furniture', 'flower', 'gift', 'book', 'stationery', 'packing', 'printing']),
]
# Not shopfronts: big institutions and places of worship (the temples are modelled separately)
SKIP = ['place_of_worship', 'religious', 'temple', 'church', 'mosque', 'monastery', 'historic', 'landmark',
        'park', 'city', 'township', 'neighborhood', 'bus_station', 'parking', 'government', 'structure']
UPSTAIRS = {'clinic', 'school', 'gym', 'office'}

CJK = re.compile(r'[㐀-鿿豈-﫿]+')
MY = re.compile(r'[က-႟ꩠ-ꩿꧠ-꧿]+(?:[\sက-႟]*[က-႟])?')
LAT = re.compile(r"[A-Za-z0-9][A-Za-z0-9&'.,()\-/+ ]*[A-Za-z0-9).]|[A-Za-z]")


NAME_KINDS = [
    ('tea', r'tea ?shop|tea house|lahpet|လက်ဖက်ရည်'),
    ('gold', r'gold|jewel'),
    ('phone', r'mobile|phone|\btelecom'),
    ('pharmacy', r'pharmacy|ဆေးဆိုင်|drug'),
    ('hotel', r'\bhotel\b|guest ?house|\bhostel\b|\binn\b'),
    ('bank', r'\bbank\b'),
]


def kind_of(cat, name):
    for kind, pat in NAME_KINDS:
        if re.search(pat, name, re.I):
            return kind
    cat = (cat or '').lower()
    for s in SKIP:
        if s in cat:
            return None
    if cat == 'hospital' and not re.search(r'clinic|poly|dental|medical centre|medical center', name, re.I):
        return None  # Yangon General Hospital etc: whole buildings, not shopfronts
    for kind, keys in KINDS:
        if any(k in cat for k in keys):
            return kind
    if not cat:
        n = name.lower()
        for kind, keys in KINDS:
            if any(k in n for k in keys):
                return kind
        return 'shop'
    return 'shop'


def fix_burmese(text, detector, converter):
    """Many Yangon listings are typed in the legacy Zawgyi encoding: convert to Unicode."""
    if not text or not re.search(r'[က-႟]', text):
        return text
    if detector.get_zawgyi_probability(text) > 0.9:
        return converter.convert(text, 'zawgyi', 'unicode')
    return text


def clean(name):
    """Drop branch suffixes: 'Eco Bar - 19th Street', 'Kyay Oh Bayin (Sint Oh Dan Street)'."""
    name = re.sub(r'\s*[\(\[][^)\]]*[\)\]]', '', name)
    name = re.sub(r'\s+[-–|]\s+.*(street|st\b|branch|chinatown|china town|yangon|latha|lanmadaw|road|rd\b).*$', '', name, flags=re.I)
    return name.strip(' -–,')


def shorten(text, n):
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(' ', 1)[0]
    cut = cut if len(cut) > n * 0.5 else text[:n]
    return re.sub(r'(\s+(and|&|of|the|-|–))+$', '', cut, flags=re.I).rstrip(' ,&-')


def lines_for(names, kind):
    """Split names into scripts and lay out a two-line sign the way Yangon shops do."""
    text = ' '.join(clean(n) for n in names if n)
    zh = ''.join(CJK.findall(text))
    my = ' '.join(m.strip() for m in MY.findall(text)).strip()
    lat = max(LAT.findall(text), key=len, default='').strip()
    if lat.lower() in ('no', 'the'):
        lat = ''
    chinese_first = kind in ('gold', 'food', 'tea', 'pharmacy', 'shop', 'grocery') and zh
    order = [zh, lat, my] if chinese_first else [lat, my, zh] if lat else [my, zh, lat]
    order = [o for o in order if o]
    if not order:
        return None, None
    line1 = shorten(order[0], 30)
    line2 = shorten(order[1], 40) if len(order) > 1 else ''
    return line1, line2


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'raw')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'data', 'shops.json')
    import myanmartools
    from myanmar import converter
    detector = myanmartools.ZawgyiDetector()

    rows = pq.read_table(os.path.join(src, 'places_place.parquet'),
                         columns=['geometry', 'names', 'taxonomy', 'basic_category', 'confidence']).to_pylist()
    picked = []
    for r in rows:
        p = wkb.loads(r['geometry'])
        if not (LON_MIN <= p.x <= LON_MAX and LAT_MIN <= p.y <= LAT_MAX):
            continue
        conf = r['confidence'] or 0
        if conf < MIN_CONFIDENCE:
            continue
        names = r['names'] or {}
        primary = fix_burmese(names.get('primary') or '', detector, converter)
        if not primary:
            continue
        common = [fix_burmese(v, detector, converter) for _, v in (names.get('common') or [])]
        cat = (r['taxonomy'] or {}).get('primary') or r['basic_category']
        kind = kind_of(cat, primary)
        if not kind:
            continue
        line1, line2 = lines_for([primary] + common, kind)
        if not line1:
            continue
        x, z = (p.x - LON0) * MLON, -(p.y - LAT0) * MLAT
        picked.append([round(x, 1), round(z, 1), kind, line1, line2, 1 if kind in UPSTAIRS else 0, conf])

    # drop duplicates (same business listed twice nearby), keep the most confident
    picked.sort(key=lambda s: -s[6])
    kept = []
    for s in picked:
        if any(k[3] == s[3] and math.hypot(k[0] - s[0], k[1] - s[1]) < 30 for k in kept):
            continue
        kept.append(s)
    kept = [s[:6] for s in kept]
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'attribution': 'Places: Overture Maps Foundation (CDLA-Permissive-2.0)', 'shops': kept},
                  f, ensure_ascii=False, separators=(',', ':'))
    from collections import Counter
    print(len(kept), 'shops', dict(Counter(s[2] for s in kept)))


if __name__ == '__main__':
    main()
