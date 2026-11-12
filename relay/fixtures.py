"""Independently understandable rigorous two-case scarcity example."""
from __future__ import annotations
from datetime import datetime,timezone,timedelta
from .routing import solve_global

def scarcity():
    flights={'F1':{'id':'F1','origin':'HKG','destination':'LHR',
         'scheduled_departure':'2026-11-09T04:00:00Z','estimated_departure':'2026-11-09T04:00:00Z',
         'scheduled_arrival':'2026-11-09T18:00:00Z','estimated_arrival':'2026-11-09T18:00:00Z',
         'status':'Scheduled','remaining_kg':150,'cool_remaining_kg':0}}
    def s(id,service,minute):
        return {'id':id,'awb':f'SYN-{id}','booking_id':f'BOOK-{id}','origin':'HKG','destination':'LHR',
          'accepted_at':f'2026-11-09T01:{minute:02d}:00Z',
          'deadline':'2026-11-10T00:00:00Z','weight_kg':140,'handling':'GENERAL',
          'service':service,'custody_state':'RECEIVED','status':'RCS','booked_flight_id':'F1',
          'assigned_flight_id':'F1','dimension_conflict':False,'customs_hold':False}
    ss={'LOW':s('LOW','STANDARD',5),'HIGH':s('HIGH','CRITICAL',20)}
    state={'as_of':'2026-11-09T02:00:00Z','flights':flights,'shipments':ss,
       'calibration':{'delay_rate':.1,'cancellation_rate':.03,'dimension_conflict_rate':.05},
       'terminal_capacity_fraction':1.0}
    result=solve_global(state,['LOW','HIGH'],time_limit_s=1)
    return {'story':'Two 140kg shipments share one confirmed-synthetic planning slot of 150kg.',
            'expected_optimal_choice':'HIGH on F1; LOW unresolved',
            'result':result}
