"""Aircraft types, per-type cargo policy and the airport/fleet configuration.

Every number here is a synthetic planning proxy for the demonstrator. They are
shaped after public type characteristics (belly ULD positions, bulk-only narrowbody
holds, heated holds for live animals) but they are NOT Cathay loading manuals,
weight-and-balance data or dangerous-goods permissions.
"""
from __future__ import annotations

from dataclasses import dataclass, field

CATS = ('GEN', 'FRESH', 'PHARMA', 'AVI', 'DG', 'VALUABLE')
CATEGORY_NAMES = {
    'GEN': 'General cargo', 'FRESH': 'Perishables', 'PHARMA': 'Pharma (temp-controlled)',
    'AVI': 'Live animals', 'DG': 'Dangerous goods', 'VALUABLE': 'Valuables',
}


@dataclass(frozen=True)
class AircraftType:
    code: str                 # ICAO-ish type code used as the registry key
    name: str                 # display name
    length_m: float           # used to scale the 3D model
    span_m: float
    uld_positions: int        # synthetic belly positions offered to this simulation
    payload_kg: int           # synthetic belly payload proxy
    max_piece_kg: int         # heaviest single piece the hold/door accepts
    categories: tuple         # special-handling codes this type can accept
    hold: str                 # 'ULD' (containerised lower deck), 'MAIN' (freighter main deck) or 'BULK'
    notes: dict = field(default_factory=dict)  # category -> human reason when refused
    model: str = 'a330-300.glb'  # 3D asset under static/assets/aircraft (scaled to length/span)
    weight: float = 1.0       # default fleet mix weight


# 3D assets live in static/assets/aircraft (credits: assets_src/aircraft/ASSET_CREDITS.md).
# The loader turns each model nose-forward and stretches it to the type's real length/span,
# so one airframe can stand in for a sibling (A350-900/-1000) or a type with no model yet.
FALLBACK_MODEL = 'a330-300.glb'

AIRCRAFT_TYPES: dict[str, AircraftType] = {t.code: t for t in (
    AircraftType('A333', 'Airbus A330-300', 63.7, 60.3, 10, 7000, 500, CATS, 'ULD',
                 model='a330-300.glb', weight=.20),
    AircraftType('A359', 'Airbus A350-900', 66.8, 64.8, 12, 8400, 500, CATS, 'ULD',
                 model='a350-cathay.glb', weight=.25),
    AircraftType('A35K', 'Airbus A350-1000', 73.8, 64.8, 14, 9800, 500, CATS, 'ULD',
                 model='a350-cathay.glb', weight=.13),
    AircraftType('B77W', 'Boeing 777-300ER', 73.9, 64.8, 16, 11500, 500, CATS, 'ULD',
                 model='b777-300er.glb', weight=.20),
    AircraftType('B748F', 'Boeing 747-8F', 76.3, 68.4, 30, 26000, 500, CATS, 'MAIN',
                 model='b747-8f.glb', weight=.08),
    AircraftType('B744F', 'Boeing 747-400ERF', 70.7, 64.4, 26, 22000, 500, CATS, 'MAIN',
                 model='b747-400erf.glb', weight=.06),
    AircraftType('A21N', 'Airbus A321neo', 44.5, 35.8, 4, 2600, 200, ('GEN', 'FRESH', 'AVI', 'VALUABLE'), 'BULK',
                 notes={'PHARMA': 'bulk-only hold has no position for an active temperature-controlled container',
                        'DG': 'synthetic policy: no dangerous goods in the narrowbody bulk hold'},
                 model=FALLBACK_MODEL, weight=.08),  # no A321neo model yet: scaled A330 stand-in
)}

DEFAULT_ENABLED_TYPES = ('A333', 'A359', 'A35K', 'B77W', 'B748F', 'B744F', 'A21N')

ROUTES = {
    'LHR': 'London', 'NRT': 'Tokyo Narita', 'SYD': 'Sydney', 'LAX': 'Los Angeles',
    'SIN': 'Singapore', 'FRA': 'Frankfurt', 'JFK': 'New York', 'BKK': 'Bangkok',
    'TPE': 'Taipei', 'DXB': 'Dubai', 'AMS': 'Amsterdam', 'ICN': 'Seoul',
}
# Narrowbodies serve regional routes only.
REGIONAL = ('NRT', 'SIN', 'BKK', 'TPE', 'ICN')


@dataclass
class AirportConfig:
    """Class-level knobs for the simulated apron. The frontend reads everything from state."""
    stands: int = 5
    enabled_types: tuple = DEFAULT_ENABLED_TYPES
    turnaround_min: tuple = (150, 215)   # on-stand time range
    stand_gap_min: tuple = (18, 32)      # pushback -> next arrival on the same stand
    cutoff_before_departure: int = 40
    shipments_per_flight: float = 2.8    # mean at load 1.0
    staging: int = 26                    # physical accumulation-area positions (hard cap)
    outside_limit: int = 18              # inbound line capacity before red zone
    exception_limit: int = 40
    workers: int = 4
    specialists: int = 1

    def types(self) -> list[AircraftType]:
        out = [AIRCRAFT_TYPES[c] for c in self.enabled_types if c in AIRCRAFT_TYPES]
        if not out:
            raise ValueError('no enabled aircraft types')
        return out


def type_refusal(t: AircraftType, category: str, kg: int) -> tuple[str, str] | None:
    """Per-type policy guard. Returns (code, human message) when the aircraft type refuses."""
    if category not in t.categories:
        why = t.notes.get(category, 'not accepted on this type')
        return 'TYPE_CATEGORY', f'{t.name} cannot take {CATEGORY_NAMES[category].lower()}: {why}'
    if kg > t.max_piece_kg:
        return 'TYPE_PIECE_WEIGHT', f'{kg} kg exceeds the {t.name} {t.hold.lower()}-hold piece limit of {t.max_piece_kg} kg'
    return None
