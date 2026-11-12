"""Models I / II / III. Executable bounded approximations with explicit validity scopes."""
from __future__ import annotations
import itertools, math, time
import numpy as np
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import lil_matrix
from .schemas import parse_time

PRIORITY={'STANDARD':1.0,'PRIORITY':1.8,'CRITICAL':3.0}

def cvar(losses,probs,alpha=.9):
    """Exact discrete upper-tail CVaR including probability atoms."""
    assert len(losses)==len(probs) and abs(sum(probs)-1)<1e-8
    vals=sorted(set(float(x) for x in losses))
    return min(eta+sum(p*max(0,l-eta) for l,p in zip(losses,probs))/(1-alpha) for eta in vals)


def model1_placement(pieces, uld, calibr, alpha=.9, nominal_budget=2.5):
    """Exact exhaustive 2x2 FLOOR-SLOT model (never a 3D loading certificate).
    Front row y=0 blocks access to rear in the SAME column.
    All hard constraints checked within this intentionally restricted geometry.
    """
    t0=time.perf_counter()
    pp=list(pieces[:4]); n=len(pp)
    if n==0:return {'status':'NO_PIECES','validity':'SIMULATED_2D_ONLY'}
    if uld['availability']!='AVAILABLE':
        return {'status':'UNAVAILABLE_ULD','validity':'NOT_CERTIFIED'}
    max_per_slot=uld['usable_length_cm']/2
    width_per_slot=uld['usable_width_cm']/2
    if any(p['length_cm']>max_per_slot or p['width_cm']>width_per_slot for p in pp) or sum(p['weight_kg'] for p in pp)+uld['tare_kg']>uld['max_gross_kg']:
        return {'status':'INFEASIBLE_2D','reason':'piece floor footprint or mass limit',
              'validity':'NOT_CERTIFIED'}
    slots=[{'slot':i,'col':i%2,'row':i//2,'x_cm':(i%2)*max_per_slot,'y_cm':(i//2)*width_per_slot} for i in range(4)]
    # A disturbance may require urgent access to any piece. The probabilities are synthetic empirical heuristics.
    conflict_p=float(calibr.get('dimension_conflict_rate',.08))
    risks=np.array([(1.0+(.6 if p['special_handling']=='COL' else 0)+conflict_p) for p in pp],float)
    probabilities=(risks/risks.sum()).tolist()
    perms=[]
    for indices in itertools.permutations(range(4),n):
        nominal=0.8*sum(abs(i-indices[i]) for i in range(n))
        location={pp[i]['id']:indices[i] for i in range(n)}
        losses=[]
        for target in pp:
            loc=location[target['id']]
            blockers=sum(1 for j in range(n) if indices[j]%2==loc%2 and indices[j]//2 < loc//2)
            # synthetic seconds-equivalent work units; no real-world safety claim
            losses.append(3+11*blockers+(.8*(indices[pp.index(target)]//2)))
        risk=cvar(losses,probabilities,alpha)+.20*sum(p*l for p,l in zip(probabilities,losses))
        perms.append((nominal,risk,indices,losses))
    min_nominal=min(v[0] for v in perms)
    nominal=min((v for v in perms if abs(v[0]-min_nominal)<1e-9), key=lambda r:(r[1],r[2]))
    choices=[v for v in perms if v[0]<=min_nominal+nominal_budget+1e-10]
    chosen=min(choices,key=lambda r:(r[1],r[0],r[2]))
    def view(v):
        return {'nominal_handling_cost_units':round(v[0],4),'risk_objective_units':round(v[1],4),
         'access_scenario_losses_units':[round(float(x),3) for x in v[3]],
         'placements':[{'piece_id':p['id'],**slots[v[2][i]],'length_cm':p['length_cm'],'width_cm':p['width_cm']} for i,p in enumerate(pp)]}
    return {'status':'EXACT_OPTIMUM_WITHIN_2D_CANDIDATE_LIBRARY',
      'validity':'SYNTHETIC_2D_FLOOR_ONLY_NOT_AIRCRAFT_CERTIFIED',
      'nominal_budget_units':nominal_budget,'baseline':view(nominal),'risk_aware':view(chosen),
      'relative_risk_improvement_pct':round(100*(nominal[1]-chosen[1])/max(nominal[1],1e-9),3),
      'options_evaluated':len(perms),'solve_ms':round((time.perf_counter()-t0)*1000,3),
      'hard_checks':['2D floor slots','no overlap','gross ULD mass','ULD availability'],
      'not_checked':['real aircraft contour','support and restraint','dangerous goods','load balance','tie-down','physical motion path']}


def model2_pivot(prior, sensitivity=.9, false_positive=.2, expiry=.15, inspection_cost=4., delay_cost=3., costs=None):
    """Exact one-step Theorem 3.1 decomposition, explicit observation+expiry joint distribution.
    IMPORTANT: HOLD and ASSESS are non-physical policy alternatives, not permission to load.
    """
    assert 0<=prior<=1 and 0<=sensitivity<=1 and 0<=false_positive<=1 and 0<=expiry<=1
    states=['ALIGNED','MISALIGNED']; p_state=[1-prior,prior]
    actions=['HOLD','ASSESS_RECOVERY']
    l0=costs if costs is not None else {'HOLD':[5.,76.],'ASSESS_RECOVERY':[24.,32.]}
    if set(l0)!={'HOLD','ASSESS_RECOVERY'} or any(len(v)!=2 or any(c<0 for c in v) for v in l0.values()):
        raise ValueError('two nonnegative downstream losses required for each action')
    d0=min(actions,key=lambda d:sum(p*l for p,l in zip(p_state,l0[d])))
    R0=sum(p*l for p,l in zip(p_state,l0[d0]))
    I=A=B=post=0.; observations=[]
    for signal in ('POSITIVE','NEGATIVE'):
        likelihood=[false_positive,sensitivity] if signal=='POSITIVE' else [1-false_positive,1-sensitivity]
        ps=sum(p*l for p,l in zip(p_state,likelihood))
        if ps<1e-12:continue
        posterior=[p*l/ps for p,l in zip(p_state,likelihood)]
        for expired in (False,True):
            pz=ps*(expiry if expired else 1-expiry)
            available=['HOLD'] if expired else actions
            def risk(d,offset):return sum(p*(l+offset) for p,l in zip(posterior,l0[d]))
            baseline_condition=risk(d0,0)
            informed=min(risk(d,0) for d in actions)
            available_best=min(risk(d,0) for d in available)
            after={d:risk(d,delay_cost+(2. if expired else 0.)) for d in available}
            action_after=min(available,key=lambda d:after[d]); postcost=after[action_after]
            I+=pz*(baseline_condition-informed)
            A+=pz*(available_best-informed)
            B+=pz*(postcost-available_best)
            post+=pz*postcost
            observations.append({'signal':signal,'option_expired':expired,'joint_probability':round(pz,7),
                'posterior_misaligned':round(posterior[1],7),'best_post_inspection_action':action_after,
                'post_inspection_cost':round(postcost,4)})
    J=inspection_cost+post
    advantage=R0-J
    assert abs(advantage-(I-A-B-inspection_cost))<1e-7
    preferred='VERIFY' if advantage>1e-8 else d0
    return {'status':'EXACT_FINITE_ONE_STEP_BAYES','prior_misalignment':round(prior,6),
      'action':preferred,'immediate_best':d0,'cost_immediate':round(R0,5),
      'cost_verify':round(J,5),'verification_net_value':round(advantage,5),
      'identity':{'information_value_I':round(I,5),'option_loss_A':round(A,5),
         'delay_loss_B':round(B,5),'inspection_cost_c':inspection_cost,
         'I_minus_A_minus_B_minus_c':round(I-A-B-inspection_cost,5)},
      'options_after_verification':observations,
      'downstream_action_cost_matrix_units':l0,
      'downstream_cost_provenance':'LOCAL_CANDIDATE_ROUTE_COST_PROXY_NOT_JOINT_MILP' if costs is not None else 'SYNTHETIC_DEMONSTRATION_DEFAULT',
      'assumptions':{'sensitivity':sensitivity,'false_positive':false_positive,'expiry_probability':expiry,
                     'delay_cost':delay_cost,'sensor_calibration':'ASSUMED_SYNTHETIC'},
      'safety_note':'Probability never overrides required physical certification or approval.'}


def cluster_exchange_fixture():
    """Exact integer check of Model III paper composite mutation example; not a scalable Graver solver."""
    M=np.array([[1,1,1,0],[1,2,1,1]],dtype=int)
    v=np.array([1,0,0,0],dtype=int)
    g1=np.array([-1,1,0,-1]);g2=np.array([0,-1,1,1]);composite=g1+g2
    w=np.array([8,5,2,0])
    assert np.array_equal(M@g1,np.zeros(2,int)) and np.array_equal(M@g2,np.zeros(2,int))
    assert any(v+g1<0) and any(v+g2<0)
    assert np.array_equal(M@(v+composite),M@v) and min(v+composite)>=0
    assert int(w@composite)==-6
    return {'status':'EXACT_INTEGER_FIXTURE','primitive_moves_infeasible':True,
            'composite_mutation_direction':composite.tolist(),'objective_delta':-6,
            'not_proven':'This fixture does not compute complete Graver bases for real airline networks.'}
