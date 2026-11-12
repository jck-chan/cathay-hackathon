"""Typed canonical contracts. Times are second-resolution UTC ISO-8601."""
from __future__ import annotations
from datetime import datetime, timezone
from typing import Literal, Any
from pydantic import BaseModel, Field, field_validator, model_validator

UTC = timezone.utc

def parse_time(t: str) -> datetime:
    dt = datetime.fromisoformat(t.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('UTC offset is mandatory')
    return dt.astimezone(UTC)

def ts(dt: datetime) -> str:
    return dt.astimezone(UTC).replace(microsecond=0).isoformat().replace('+00:00','Z')

class Flight(BaseModel):
    id: str
    carrier: str = 'CX'                 # synthetic, not a published Cathay schedule
    flight_number: str
    origin: str
    destination: str
    scheduled_departure: str
    scheduled_arrival: str
    estimated_departure: str
    estimated_arrival: str
    status: Literal['Scheduled','OutGate','InAir','Landed','InGate','Canceled','Diverted'] = 'Scheduled'
    # Available CAPACITY is a synthetic operator inventory value, NEVER OAG cargoTonnage
    remaining_kg: int = Field(ge=0)
    cool_remaining_kg: int = Field(ge=0)
    unit_slots_remaining: int = Field(ge=0)
    revision: int = 1
    capacity_authority: str = 'SYNTHETIC_INVENTORY'
    @model_validator(mode='after')
    def valid(self):
        if parse_time(self.scheduled_arrival) <= parse_time(self.scheduled_departure):
            raise ValueError('arrival must follow departure')
        if parse_time(self.estimated_arrival) <= parse_time(self.estimated_departure):
            raise ValueError('estimated arrival must follow estimated departure')
        if self.cool_remaining_kg > self.remaining_kg:
            raise ValueError('cool capacity cannot exceed remaining capacity')
        return self

class Piece(BaseModel):
    id: str
    shipment_id: str
    weight_kg: int = Field(gt=0)
    length_cm: int = Field(gt=0)
    width_cm: int = Field(gt=0)
    height_cm: int = Field(gt=0)
    special_handling: Literal['GENERAL','COL','DGR'] = 'GENERAL'
    dimensions_verified: bool = True

class Shipment(BaseModel):
    id: str
    awb: str
    booking_id: str
    client_id: str
    origin: str
    destination: str
    created_at: str
    accepted_at: str
    deadline: str
    weight_kg: int = Field(gt=0)
    piece_ids: list[str]
    service: Literal['STANDARD','PRIORITY','CRITICAL'] = 'STANDARD'
    handling: Literal['GENERAL','COL','DGR'] = 'GENERAL'
    status: str = 'RCS'
    booked_flight_id: str | None = None
    assigned_flight_id: str | None = None
    custody_state: Literal['RECEIVED','BUILDING','SEALED','LOADED','DEPARTED','ARRIVED','DELIVERED'] = 'RECEIVED'
    revision: int = 1
    consent_to_split: bool = False
    @model_validator(mode='after')
    def valid(self):
        if not (parse_time(self.created_at) <= parse_time(self.accepted_at) < parse_time(self.deadline)):
            raise ValueError('invalid shipment lifecycle times')
        return self

class ULD(BaseModel):
    id: str
    uld_type: str
    usable_length_cm: int = Field(gt=0)
    usable_width_cm: int = Field(gt=0)
    max_gross_kg: int = Field(gt=0)
    tare_kg: int = Field(ge=0)
    availability: Literal['AVAILABLE','DAMAGED','MAINTENANCE','SEALED'] = 'AVAILABLE'
    zone: str = 'HKG-EXPORT'
    model_scope: str = 'SYNTHETIC_2D_FLOOR_ONLY_NOT_AIRCRAFT_CERTIFIED'

EVENT_TYPES = Literal[
    'flight_delay','flight_cancelled','flight_restored','flight_state_update','capacity_changed',
    'terminal_congestion','weather_disruption','shipment_dimension_conflict',
    'shipment_dimension_verified','uld_unavailable','uld_restored',
    'shipment_milestone','booking_change','customer_priority_update',
    'ground_task_ack','customs_hold','customs_released'
]
class EventIn(BaseModel):
    event_id: str = Field(min_length=3)
    event_type: EVENT_TYPES
    entity_type: Literal['flight','shipment','uld','terminal','task']
    entity_id: str
    event_time: str
    received_at: str
    source: str
    source_revision: int = Field(ge=1)
    trusted: bool = False
    payload: dict[str, Any] = Field(default_factory=dict)
    @model_validator(mode='after')
    def valid(self):
        parse_time(self.event_time); parse_time(self.received_at)
        if parse_time(self.event_time) > parse_time(self.received_at):
            raise ValueError('event_time later than received_at; provide actual recorded times')
        return self

class EvaluationRequest(BaseModel):
    as_of: str | None = None
    shipment_ids: list[str] = Field(default_factory=list, max_length=24)
    risk_alpha: float = Field(default=0.90, gt=0.5, lt=1)
    risk_weight: float = Field(default=0.12, ge=0, le=1)
    time_limit_s: float = Field(default=3.0, ge=0.05, le=30)
    @field_validator('as_of')
    @classmethod
    def valid_as_of(cls, v):
        if v: parse_time(v)
        return v

class ReviewIn(BaseModel):
    decision: Literal['approve','reject']
    reviewer: str = Field(min_length=2)
    expected_snapshot_version: int = Field(ge=0)
    idempotency_key: str = Field(min_length=5)
    reason: str = ''

class TaskAckIn(BaseModel):
    worker: str = Field(min_length=2)
    status: Literal['ACKNOWLEDGED','DONE','FAILED']
    idempotency_key: str = Field(min_length=5)

class AutonomyPolicy(BaseModel):
    mode: Literal['ADVISORY','HUMAN_APPROVAL','BOUNDED_AUTO'] = 'HUMAN_APPROVAL'
    # This app NEVER sends actual booking/load/cancel commands, regardless of mode.
    max_auto_cost_units: float = Field(default=0, ge=0)
    allow_simulated_dispatch: bool = True
