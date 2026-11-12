"""Model III: time-expanded typed itineraries + shared-capacity stochastic MILP.

Exact relative to enumerated paths + modeled synthetic constraints. No operational certification.
"""
from __future__ import annotations
from collections import defaultdict
from datetime import timedelta
from time import perf_counter
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix
from .schemas import parse_time
from .models import PRIORITY,cvar


def scenarios(calibration):
    w=min(.27,max(.045,calibration['delay_rate']*1.5+calibration['cancellation_rate']))
    g=min(.22,max(.045,calibration['dimension_conflict_rate']*1.3))
    return [{'name':'NORMAL','probability':1-w-g},{'name':'CORRELATED_WEATHER','probability':w},
            {'name':'GROUND_CONGESTION','probability':g}]


def candidate_routes(s, flights, now, max_paths=12):
    """Enumerate time-expanded paths (<=2 flight legs), preserving cutoff/connection feasibility."""
    acc=parse_time(s['accepted_at']); cutoff=parse_time(now)
    if s.get('custody_state') in ('SEALED','LOADED','DEPARTED','ARRIVED','DELIVERED') or s.get('customs_hold') or s['handling']=='DGR':
        return []
    earliest=max(acc+timedelta(minutes=45),cutoff+timedelta(minutes=40))
    f0=[]
    for f in flights.values():
        dep=parse_time(f['estimated_departure'])
        if f['origin']!=s['origin'] or f['status'] in ('Canceled','Diverted','OutGate','InAir','Landed','InGate'):continue
        if dep<earliest or dep>cutoff+timedelta(days=2):continue
        if f['remaining_kg']<s['weight_kg']:continue
        if s['handling']=='COL' and f['cool_remaining_kg']<s['weight_kg']:continue
        f0.append(f)
    paths=[]
    for f in sorted(f0,key=lambda f:f['estimated_departure']):
        if f['destination']==s['destination']:paths.append([f])
        for g in flights.values():
            if g['origin']!=f['destination'] or g['destination']!=s['destination'] or g['id']==f['id']:continue
            if g['status'] in ('Canceled','Diverted','OutGate','InAir','Landed','InGate'):continue
            td=parse_time(g['estimated_departure'])-parse_time(f['estimated_arrival'])
            if not timedelta(hours=2)<=td<=timedelta(hours=22):continue
            if g['remaining_kg']<s['weight_kg']:continue
            if s['handling']=='COL' and g['cool_remaining_kg']<s['weight_kg']:continue
            paths.append([f,g])
    paths.sort(key=lambda path:(parse_time(path[-1]['estimated_arrival']),len(path),path[0]['id']))
    return paths[:max_paths]


def route_costs(s,path,scens):
    weight=PRIORITY[s['service']]; dl=parse_time(s['deadline'])
    if not path:
        base={'STANDARD':300.,'PRIORITY':590.,'CRITICAL':990.}[s['service']]
        return [base]*len(scens)
    end=parse_time(path[-1]['estimated_arrival']); duration_h=(end-parse_time(s['accepted_at'])).total_seconds()/3600
    lateness=max(0,(end-dl).total_seconds()/3600)
    switched=(s['booked_flight_id']!=path[0]['id'])
    transfer=(len(path)-1)
    base=(4. + 0.35*duration_h + 7*transfer + 10*switched + lateness*24*weight +
          (5 if s['handling']=='COL' else 0))
    costs=[]
    for scen in scens:
        if scen['name']=='NORMAL': extra=0
        elif scen['name']=='CORRELATED_WEATHER':
            affected=sum(1 for f in path if f['origin'] in ('HKG','SIN','NRT','BKK'))
            extra=affected*(15+14*weight)+(16*weight if lateness else 0)
        else:extra=(9+14*weight)*len(path)+(9 if s['handling']=='COL' else 0)
        costs.append(round(base+extra,4))
    return costs


def risk_score(all_losses,scens,alpha,weight):
    probs=[s['probability'] for s in scens]
    exp=sum(p*loss for p,loss in zip(probs,all_losses))
    return exp+weight*cvar(all_losses,probs,alpha)


def solve_global(snapshot,selected_ids,alpha=.90,risk_weight=.12,time_limit_s=3.0):
    tic=perf_counter(); flights=snapshot['flights']; now=snapshot['as_of'];shipments=snapshot['shipments'];
    eligible=[]; excluded={}
    for sid in selected_ids:
        if sid not in shipments:excluded[sid]='NOT_PRESENT_IN_SNAPSHOT';continue
        s=shipments[sid]
        if parse_time(s['accepted_at'])>parse_time(now):excluded[sid]='NOT_YET_ACCEPTED';continue
        if s['status']=='DLV':excluded[sid]='ALREADY_DELIVERED';continue
        if s['handling']=='DGR':excluded[sid]='DGR_RULES_NOT_CERTIFIED';continue
        if s.get('dimension_conflict'):excluded[sid]='DIMENSIONS_UNVERIFIED_VERIFY_FIRST';continue
        if s.get('customs_hold'):excluded[sid]='CUSTOMS_HOLD';continue
        if s['custody_state']!='RECEIVED':excluded[sid]='CUSTODY_ACTION_LOCKED';continue
        # Model I -> III interface: a strictly *synthetic* local footprint screen.
        # If physical records are supplied, missing/invalid pieces cannot be planned as verified.
        if 'pieces' in snapshot and 'ulds' in snapshot:
            pts=[snapshot['pieces'].get(pid) for pid in s.get('piece_ids',[])]
            if not pts or any(p is None or not p.get('dimensions_verified',False) for p in pts):
                excluded[sid]='PHYSICAL_PIECE_DATA_MISSING_OR_UNVERIFIED';continue
            eligible_uld=[]
            for u in snapshot['ulds'].values():
                if u['availability']!='AVAILABLE' or len(pts)>4:continue
                if sum(p['weight_kg'] for p in pts)+u['tare_kg']>u['max_gross_kg']:continue
                if all(p['length_cm']<=u['usable_length_cm']/2 and p['width_cm']<=u['usable_width_cm']/2 for p in pts):
                    eligible_uld.append(u['id'])
            if not eligible_uld:
                excluded[sid]='NO_SYNTHETIC_2D_ULD_CANDIDATE';continue
        eligible.append(s)
    scens=scenarios(snapshot['calibration'])
    candidates=[]; by_sid=defaultdict(list)
    for s in eligible:
        for path in candidate_routes(s,flights,now):
            x={'shipment_id':s['id'],'route':[f['id'] for f in path],
               'airports':[s['origin']]+[f['destination'] for f in path],
               'arrival_utc':path[-1]['estimated_arrival'], 'kind':'TENTATIVE_ROUTING',
               'weight_kg':s['weight_kg'],'handling':s['handling'],
               'scenario_losses':route_costs(s,path,scens)}
            by_sid[s['id']].append(len(candidates));candidates.append(x)
        un={'shipment_id':s['id'],'route':[],'airports':[s['origin']],
            'arrival_utc':None,'kind':'UNRESOLVED_ESCALATION','weight_kg':0,
            'handling':s['handling'],'scenario_losses':route_costs(s,[],scens)}
        by_sid[s['id']].append(len(candidates));candidates.append(un)
    if not eligible:return {'status':'NO_ELIGIBLE_SHIPMENTS','excluded':excluded,'plan':[],
                'solve_ms':round((perf_counter()-tic)*1000,3),'scenario_probabilities':scens}
    n=len(candidates); m=n+1+len(scens);eta=n
    A=[];lo=[];hi=[]
    for s in eligible:
        row={j:1 for j in by_sid[s['id']]};A.append(row);lo.append(1.);hi.append(1.)
    # Exact same shared leg capacity in every shipment route (global coupling).
    for flight in flights.values():
        members=[j for j,c in enumerate(candidates) if flight['id'] in c['route']]
        if not members:continue
        row={j:float(candidates[j]['weight_kg']) for j in members}
        A.append(row);lo.append(-np.inf);hi.append(float(flight['remaining_kg']))
        row_c={j:float(candidates[j]['weight_kg']) for j in members if candidates[j]['handling']=='COL'}
        if row_c:A.append(row_c);lo.append(-np.inf);hi.append(float(flight['cool_remaining_kg']))
    # Synthetic terminal work-cell constraint: hourly HKG export pick slots, not a real Cathay rule.
    by_hour=defaultdict(list)
    for j,c in enumerate(candidates):
        if c['route']:
            dep=flights[c['route'][0]]['estimated_departure'][:13]
            by_hour[dep].append(j)
    hourly_limit=max(1,int(10*float(snapshot.get('terminal_capacity_fraction',1.0))))
    for key,members in by_hour.items():
        A.append({j:1.0 for j in members});lo.append(-np.inf);hi.append(hourly_limit)
    probs=np.array([s['probability'] for s in scens]);loss=np.array([x['scenario_losses'] for x in candidates],dtype=float)
    for k in range(len(scens)):
        row={j:loss[j,k] for j in range(n)}
        row[eta]=-1;row[eta+1+k]=-1
        A.append(row);lo.append(-np.inf);hi.append(0.)
    mat=lil_matrix((len(A),m),dtype=float)
    for i,row in enumerate(A):
        for j,v in row.items():mat[i,j]=v
    objective=np.zeros(m,float);objective[:n]=loss@probs
    objective[eta]=risk_weight
    objective[eta+1:]=risk_weight*probs/(1-alpha)
    ub=np.array([1.]*n+[1e8]*(1+len(scens)))
    lb=np.zeros(m)
    result=milp(c=objective,integrality=np.array([1]*n+[0]*(m-n)),
                bounds=Bounds(lb,ub),constraints=LinearConstraint(mat.tocsc(),np.array(lo),np.array(hi)),
                options={'time_limit':time_limit_s,'mip_rel_gap':1e-4,'disp':False})
    # Always return a safe labelled candidate; no assertion of optimality for a timed-out solve.
    if result.x is not None:
        indices=[max(by_sid[s['id']],key=lambda j:result.x[j]) for s in eligible]
        if any(result.x[j]<.5 for j in indices):
            indices=[]
    else:indices=[]
    def validate(sel):
        if len(sel)!=len(eligible):return False
        use=defaultdict(float);cool=defaultdict(float);work=defaultdict(int)
        for j in sel:
            c=candidates[j]
            if c['route']:
                work[flights[c['route'][0]]['estimated_departure'][:13]]+=1
            for fid in c['route']:
                use[fid]+=c['weight_kg']
                if c['handling']=='COL':cool[fid]+=c['weight_kg']
        return (all(use[fid]<=flights[fid]['remaining_kg']+1e-7 and cool[fid]<=flights[fid]['cool_remaining_kg']+1e-7 for fid in use)
                and all(v<=hourly_limit for v in work.values()))
    if not validate(indices):indices=[]
    solver_valid=bool(indices)
    if not indices:
        # Universal safe planning fallback: unresolved, never an unsafe unverified route.
        indices=[by_sid[s['id']][-1] for s in eligible]
    # Baseline FCFS heuristic against IDENTICAL synthetic demand/capacity.
    rem={k:{'kg':f['remaining_kg'],'cool':f['cool_remaining_kg']} for k,f in flights.items()}
    baseline_work=defaultdict(int)
    base=[]
    for s in sorted(eligible,key=lambda x:x['accepted_at']):
        opts=sorted(by_sid[s['id']],key=lambda j:sum(probs*np.array(candidates[j]['scenario_losses'])))
        chosen=by_sid[s['id']][-1]
        for j in opts:
            c=candidates[j]
            if (all(rem[fid]['kg']>=c['weight_kg'] and (c['handling']!='COL' or rem[fid]['cool']>=c['weight_kg']) for fid in c['route'])
                and (not c['route'] or baseline_work[flights[c['route'][0]]['estimated_departure'][:13]]<hourly_limit)):
                chosen=j;break
        base.append(chosen)
        c=candidates[chosen]
        if c['route']:baseline_work[flights[c['route'][0]]['estimated_departure'][:13]]+=1
        for fid in c['route']:
            rem[fid]['kg']-=c['weight_kg']
            if c['handling']=='COL':rem[fid]['cool']-=c['weight_kg']
    def metrics(sel):
        L=np.sum(loss[sel],axis=0).tolist()
        return {'expected_cost_units':round(float(np.dot(probs,L)),4),
          'cvar_cost_units':round(float(cvar(L,probs,alpha)),4),
          'risk_adjusted_objective':round(float(risk_score(L,scens,alpha,risk_weight)),4),
          'unresolved_count':sum(not candidates[j]['route'] for j in sel),
          'scenario_system_losses':{scens[i]['name']:round(float(L[i]),4) for i in range(len(L))}}
    chosen_metrics=metrics(indices);base_metrics=metrics(base)
    outputs=[{k:v for k,v in candidates[j].items() if k!='scenario_losses'} for j in indices]
    constraints_used={'flight_remaining_kg':True,'synthetic_terminal_hourly_work_slots':True,'flight_cool_remaining_kg':True,'unique_route_per_shipment':True,
       'time_expanded_departure_and_connections':True,'irreversible_custody_locks':True,
       'synthetic_2d_piece_uld_gate':('pieces' in snapshot and 'ulds' in snapshot),
       'certified_3D_ULD_contour':False,'hazmat_certification':False,'operator_booking_confirmation':False}
    if result.status==0 and solver_valid:status='OPTIMAL_ENUMERATED_MILP'
    elif result.x is not None and solver_valid:status='FEASIBLE_UNPROVEN_MILP'
    else:status='FALLBACK_ALL_UNRESOLVED'
    capacity_use={}
    for f in flights.values():
        kg=sum(candidates[j]['weight_kg'] for j in indices if f['id'] in candidates[j]['route'])
        if kg:capacity_use[f['id']]={'allocated_kg':kg,'remaining_kg_before':f['remaining_kg'],
            'remaining_kg_after':f['remaining_kg']-kg,'cool_allocation_kg':sum(candidates[j]['weight_kg'] for j in indices if f['id'] in candidates[j]['route'] and candidates[j]['handling']=='COL')}
    return {'status':status,'validity':'PLANNING_ONLY_REQUIRES_REAL_OPERATIONAL_CERTIFICATION',
     'plan':outputs,'excluded':excluded,'metrics':chosen_metrics,'baseline_fcfs':base_metrics,
     'capacity_usage':capacity_use,'scenario_probabilities':scens,
     'candidate_columns':n,'constraints_checked':constraints_used,
     'solver':{'name':'SciPy HiGHS MILP','status_code':int(result.status),
       'message':str(result.message),'mip_gap':float(getattr(result,'mip_gap',float('nan'))) if result.x is not None else None,
       'mip_dual_bound':float(getattr(result,'mip_dual_bound',float('nan'))) if result.x is not None else None},
     'solve_ms':round((perf_counter()-tic)*1000,3)}
