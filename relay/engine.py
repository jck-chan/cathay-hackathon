"""RELAY v2: decision orchestration with independent per-shipment uncertainty gates.

Planning-only research sandbox. An assessment is NOT a commitment, approval or booking.
"""
from __future__ import annotations
import uuid,time
from datetime import timedelta
from .state import project
from .schemas import ts,parse_time, EvaluationRequest
from .models import model1_placement,model2_pivot
from .routing import solve_global, candidate_routes, route_costs, scenarios
from .synthetic import END

DEFAULT_CLOCK=ts(END+timedelta(hours=1))


def _physical_diagnostics(state, ids, alpha):
    """Run each small bounded 2D diagnostic batch on a distinct synthetic ULD.

    Important: this does not certify simultaneous aircraft-level loading. Actual
    routing admission still requires separate per-shipment synthetic footprint checks.
    """
    pieces=[]
    for sid in ids:
        s=state['shipments'][sid]
        if s.get('dimension_conflict') or s['handling']=='DGR':
            continue
        pieces.extend(state['pieces'][pid] for pid in s['piece_ids'] if pid in state['pieces'])
    available=sorted((u for u in state['ulds'].values() if u['availability']=='AVAILABLE'),
                     key=lambda u:(-u['usable_length_cm']*u['usable_width_cm'],u['id']))
    batches=[]; used=set()
    for k in range(0,len(pieces),4):
        segment=pieces[k:k+4]
        best=None
        for u in available:
            if u['id'] in used:continue
            calc=model1_placement(segment,u,state['calibration'],alpha=alpha)
            if calc['status']=='EXACT_OPTIMUM_WITHIN_2D_CANDIDATE_LIBRARY':
                best=(u,calc);break
        if best:
            u,calc=best;used.add(u['id'])
            batches.append({'batch_id':len(batches)+1,'uld_id':u['id'],
                            'piece_ids':[p['id'] for p in segment],**calc})
        else:
            batches.append({'batch_id':len(batches)+1,'uld_id':None,
                            'piece_ids':[p['id'] for p in segment],
                            'status':'NO_COMPATIBLE_SYNTHETIC_2D_ULD','validity':'NOT_CERTIFIED'})
    success=[b for b in batches if b['status']=='EXACT_OPTIMUM_WITHIN_2D_CANDIDATE_LIBRARY']
    result=dict(success[0]) if success else {'status':'NO_FEASIBLE_2D_BATCH',
                                             'validity':'SYNTHETIC_2D_ONLY'}
    result['batches']=batches
    result['batch_count']=len(batches)
    result['candidate_piece_count']=len(pieces)
    result['diagnostically_placed_piece_count']=sum(len(b['piece_ids']) for b in success)
    result['unplaced_piece_ids']=[pid for b in batches if b not in success for pid in b['piece_ids']]
    result['coverage_fraction']=(result['diagnostically_placed_piece_count']/len(pieces) if pieces else None)
    result['aggregate_risk_improvement_units']=round(sum(b['baseline']['risk_objective_units']-
                b['risk_aware']['risk_objective_units'] for b in success),5)
    result['independent_batches_only']=True
    result['operational_load_certificate']=False
    result['scope_note']='Independent 2D exploratory ULD batches; no aircraft contour, stacking, shared ground-task or simultaneous load certificate.'
    return result


def _uncertainty_controller(state, ids, alpha):
    """Model II ONLY controls uncertain cases; never treats a good planning option as authority to load.

    The v1 bug evaluated one arbitrary certain shipment, returned HOLD and then
    proposed a network change to that same shipment. v2 uses per-case gates.
    """
    shipments=state['shipments']; uncertain=[sid for sid in ids if shipments[sid].get('dimension_conflict')]
    omega=scenarios(state['calibration']); weights=[o['probability'] for o in omega]
    def expectation(costs):return sum(p*c for p,c in zip(weights,costs))
    cases=[]
    for sid in uncertain:
        s=shipments[sid]; possible=dict(s);possible['dimension_conflict']=False
        paths=candidate_routes(possible,state['flights'],state['as_of'])
        booked=[p for p in paths if p[0]['id']==s.get('assigned_flight_id')]
        alt=[p for p in paths if p[0]['id']!=s.get('assigned_flight_id')]
        unresolved=expectation(route_costs(possible,[],omega))
        old=min((expectation(route_costs(possible,p,omega)) for p in booked),default=unresolved)
        alternative=min((expectation(route_costs(possible,p,omega)) for p in alt),default=unresolved)
        costs={'HOLD':[round(old,6),round(unresolved,6)],
               'ASSESS_RECOVERY':[round(alternative,6),round(alternative+6.,6)]}
        prior=min(.9,max(.015,state['calibration']['dimension_conflict_rate']*3))
        pivot=model2_pivot(prior=prior,
               sensitivity=state['calibration']['verification_sensitivity_assumed'],
               false_positive=state['calibration']['verification_false_positive_assumed'],
               expiry=min(.38,max(.03,state['calibration']['cancellation_rate']+state['calibration']['delay_rate'])),
               inspection_cost=4.,delay_cost=3.,costs=costs)
        cases.append({'shipment_id':sid,**pivot,
                      'route_gate':'BLOCKED_PENDING_INDEPENDENT_PHYSICAL_VERIFICATION',
                      'candidate_alternative_count':len(alt),
                      'counterfactual_costs_only':True, 'cost_scope':'LOCAL_ROUTE_PROXY_NOT_NETWORK_REOPTIMIZATION'})
    if not cases:
        return {'status':'NOT_TRIGGERED_NO_UNCERTAIN_SHIPMENTS','action':'NOT_REQUIRED',
                'affected_shipments':[],'cases':[],
                'route_gate':'NO_CASE_SPECIFIC_UNCERTAINTY_GATE_NEEDED',
                'note':'Do not interpret the absence of inspection as loading certification.'}
    return {'status':'PER_SHIPMENT_ONE_STEP_BAYES','action':'MIXED_CASE_SPECIFIC',
            'affected_shipments':uncertain,'cases':cases,
            'route_gate':'UNCERTAIN_SHIPMENTS_EXCLUDED_FROM_EXECUTABLE_ROUTE_SET',
            'note':'Each action is advisory. HOLD and VERIFY never authorize physical cargo movement.'}


def evaluate(store, req: EvaluationRequest):
    started=time.perf_counter()
    as_of=req.as_of or store.clock()
    state=project(store,as_of,include_all=False)
    shipments=state['shipments']
    active=sorted((s for s in shipments.values() if parse_time(s['accepted_at'])<=parse_time(as_of)
                   and s['custody_state']=='RECEIVED' and s['status']!='DLV'),
                  key=lambda s:(s['accepted_at'],s['id']))
    ids=req.shipment_ids or [s['id'] for s in active[:16]]
    if not ids:raise ValueError('no eligible accepted shipments at this time; advance simulation clock')
    if len(set(ids))!=len(ids):raise ValueError('duplicate shipment IDs')
    missing=[i for i in ids if i not in shipments]
    if missing:raise ValueError(f'unknown or not-yet-visible shipment IDs: {missing[:4]}')
    log=[{'stage':'SNAPSHOT','message':'receipt-time-bounded state reconstruction',
          'snapshot_version':state['snapshot_version'],'as_of':as_of,'shipment_count':len(ids),
          'calibration_training_cutoff':state['calibration']['training_cutoff']}]
    packing=_physical_diagnostics(state,ids,req.risk_alpha)
    log.append({'stage':'MODEL_I','message':'evaluated independent bounded 2D ULD diagnostic batches; no load certificate',
       'status':packing['status'],'batch_count':packing['batch_count'],
       'pieces_screened':packing['diagnostically_placed_piece_count'],
       'unplaced_piece_count':len(packing['unplaced_piece_ids']),
       'aggregate_risk_improvement_units':packing['aggregate_risk_improvement_units']})
    global_result=solve_global(state,ids,alpha=req.risk_alpha,
        risk_weight=req.risk_weight,time_limit_s=req.time_limit_s)
    log.append({'stage':'MODEL_III','message':'coupled itinerary assignment: synthetic, planning-only',
       'solver_status':global_result['status'],'candidate_columns':global_result.get('candidate_columns',0),
       'solve_ms':global_result['solve_ms'],'unresolved':global_result.get('metrics',{}).get('unresolved_count'),
       'mip_gap':global_result.get('solver',{}).get('mip_gap')})
    pivot=_uncertainty_controller(state,ids,req.risk_alpha)
    log.append({'stage':'MODEL_II','message':'per-shipment verification gate; no generic HOLD applied to unrelated cargo',
       'action':pivot['action'],'affected_shipments':pivot['affected_shipments'],
       'case_actions':{c['shipment_id']:c['action'] for c in pivot['cases']},
       'net_values':{c['shipment_id']:c['verification_net_value'] for c in pivot['cases']}})
    blocked=set(pivot['affected_shipments'])
    proposal=[]
    for x in global_result['plan']:
        sid=x['shipment_id'];s=shipments[sid]
        if x['route'] and x['route'][0]!=s.get('assigned_flight_id'):
            if sid in blocked:
                # Invariant: no HOLD/VERIFY case is ever sent as a recovery request.
                continue
            proposal.append({'shipment_id':sid,'from_assigned_flight_id':s.get('assigned_flight_id'),
                'route':x['route'],'route_status':'PROPOSAL_NOT_BOOKED',
                'proposal_kind':'REQUEST_CHANGE_PENDING_EXTERNAL_CONFIRMATION',
                'decision_basis':'MODEL_III_GLOBAL_PLAN_SUBJECT_TO_MODEL_II_CASE_GATE',
                'preconditions':['human approval','airline space reconfirmation',
                  'load/control validation','ground crew acknowledgement']})
    warnings=[{'shipment_id':sid,'reason':reason} for sid,reason in global_result['excluded'].items()]
    for sid in blocked:
        if not any(x.get('shipment_id')==sid and x['reason']=='EVIDENCE_REQUIRES_VERIFICATION' for x in warnings):
            warnings.append({'shipment_id':sid,'reason':'EVIDENCE_REQUIRES_VERIFICATION'})
    unresolved=global_result.get('metrics',{}).get('unresolved_count',0)
    if unresolved:warnings.append({'reason':'UNRESOLVED_SHIPMENTS_NEED_HUMAN_ESCALATION','count':unresolved})
    policy=store.policy()
    if proposal:
        action='PROPOSE_RECOVERY';status='PENDING_REVIEW' if policy['mode']!='ADVISORY' else 'ADVISORY_ONLY'
    elif blocked:
        action='VERIFY_OR_HOLD';status='ADVISORY_ONLY'
    else:
        action='MAINTAIN_OR_ESCALATE';status='ADVISORY_ONLY'
    review_required=bool(proposal and policy['mode']!='ADVISORY')
    plan_sid={x['shipment_id'] for x in global_result['plan']}
    invariant_checks={
       'every_proposal_in_global_plan':all(p['shipment_id'] in plan_sid for p in proposal),
       'no_uncertain_case_proposed_for_recovery':all(p['shipment_id'] not in blocked for p in proposal),
       'every_proposal_remains_unconfirmed':all(p['route_status']=='PROPOSAL_NOT_BOOKED' for p in proposal),
       'zero_real_operational_commands':True,
       'physical_certification_claimed':False}
    if not all(v for k,v in invariant_checks.items() if k!='physical_certification_claimed'):
        raise AssertionError('cross-model safety invariant failed')
    log.append({'stage':'CROSS_MODEL_GATE','message':'ensured no per-case HOLD/VERIFY is a recovery proposal',
        'uncertain_cases_blocked':sorted(blocked),'candidate_recovery_actions':len(proposal),
        'checks':invariant_checks})
    log.append({'stage':'GATE','message':'all route changes require simulation-only human review and external confirmation',
         'policy_mode':policy['mode'],'review_required':review_required,'approved':False})
    did='DEC-'+uuid.uuid4().hex[:16].upper()
    output={'id':did,'created_at':as_of,'snapshot_version':state['snapshot_version'],
        'input_evidence':{'as_of':as_of,'event_count_applied':state['evidence_applied_count'],
          'recent_evidence':state['recent_evidence'],'calibration':state['calibration'],'shipment_ids':ids},
        'process_logs':log,'model_i':packing,'model_ii':pivot,'model_iii':global_result,
        'action':action,'status':status,'review_required':review_required,'proposed_actions':proposal,
        'reason_codes':warnings,'plan':global_result['plan'],'cross_model_invariants':invariant_checks,
        'engine_runtime_ms':round((time.perf_counter()-started)*1000,3),
        'validity':'SYNTHETIC_DECISION_SUPPORT_ONLY_NEVER_AIRWORTHINESS_OR_BOOKING_CERTIFICATION',
        'real_commands_sent':False}
    return store.insert_decision(output)


def customer_track(store,awb,as_of=None):
    as_of=as_of or store.clock()
    s=next((s for s in store.catalog('shipment') if s['awb']==awb),None)
    if s is None:raise KeyError('AWB not found')
    if parse_time(s['created_at'])>parse_time(as_of):raise KeyError('AWB not visible as of requested time')
    state=project(store,as_of,include_all=True)
    s=state['shipments'][s['id']]
    f=state['flights'].get(s.get('assigned_flight_id'))
    milestones=state['milestones'].get(s['id'],[])
    eta=f['estimated_arrival'] if f else None
    sigma=int(1800+state['calibration']['delay_rate']*3*3600) if eta else None
    interval=[ts(parse_time(eta)-timedelta(seconds=sigma)),
              ts(parse_time(eta)+timedelta(seconds=2*sigma))] if eta else None
    # Only internally approved proposals. Never imply that a carrier accepted
    # the route, even after every synthetic department task reports DONE.
    approved=[]
    for dec in store.decisions(status='APPROVED_SIMULATION_ONLY',limit=10000):
        if parse_time(dec['created_at'])>parse_time(as_of):continue
        if any(a['shipment_id']==s['id'] for a in dec['proposed_actions']):
            approved.append({'decision_id':dec['id'],'status':'INTERNAL_APPROVAL_ONLY',
                'carrier_booking_status':'NOT_CONFIRMED_BY_THIS_APPROVAL',
                'message':'An alternative itinerary is under operational review; the carrier has not confirmed this change.'})
    return {'awb':s['awb'],'booking_reference':s['booking_id'],
       'origin':s['origin'],'destination':s['destination'],'status':s['status'],
       'observed_milestones':milestones,'estimated_arrival_utc':eta,
       'eta_uncertainty_window_utc':interval,'eta_status':'SYNTHETIC_FORECAST_NOT_SLA_GUARANTEE',
       'customer_service_message':('Your shipment is under operational review.' if s['dimension_conflict'] else
          'Shipment milestones and estimated arrival are being updated.'),
       'recovery_updates':approved,'as_of':as_of,
       'data_label':'SYNTHETIC_NON_REAL_AWB','no_operational_commitment':True}
