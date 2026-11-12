"""Auditable v5 shadow control tower built on the user's working v4 canonical simulator.

No real operational integrations. External flight feeds remain *observational*.
"""
from __future__ import annotations
import json, math, collections
from pathlib import Path
from relay.schemas import parse_time
from relay.state import project
from relay.models import cvar
from relay.store import Conflict
from unified_lab import UnifiedLab
from oag_bridge import synthetic_v2_sample, observations_for_demo

DATA=Path(__file__).resolve().parent/'data'

class AuditedLab(UnifiedLab):
    def _init(self,seed):
        self.oag_observations={}
        self.oag_revision=0
        self.oag_decision_revision=0
        self.oag_log=[]
        self.last_scope={'eligible':0,'evaluated':0,'out_of_scope_ids':[]}
        super()._init(seed)

    def _evaluate(self):
        # Reproducible v4 math evaluation with a transparent, conservative scope selection.
        # v4 helper limits to 24 by lexicographic ID; reorder the admitted IDs by
        # at-risk/near-deadline priority before making the finite candidate batch.
        from relay.engine import evaluate
        from relay.schemas import EvaluationRequest
        from relay.state import project
        import time
        state=project(self.store,self.store.clock())
        candidates=[sid for sid in self.admitted if sid in state['shipments'] and
                    state['shipments'][sid]['custody_state']=='RECEIVED']
        def priority(sid):
            s=state['shipments'][sid]
            risk=bool(s.get('dimension_conflict') or s.get('customs_hold'))
            return (not risk, parse_time(s['deadline']),parse_time(s['accepted_at']),sid)
        candidates.sort(key=priority)
        included=candidates[:24]
        self.last_scope={'eligible':len(candidates),'evaluated':len(included),
                         'out_of_scope_ids':candidates[24:],
                         'selection':'BLOCKED_FIRST_THEN_EARLIEST_DEADLINE',
                         'global_optimality_scope':'SELECTED_SUBSET_ONLY'}
        t=time.perf_counter()
        try:
            d=evaluate(self.store,EvaluationRequest(shipment_ids=included,time_limit_s=2.0))
            self.latest=d
            self.oag_decision_revision=self.oag_revision
            self._log('MODEL',f"I {d['model_i']['status']} | II {d['model_ii']['action']} | III {d['model_iii']['status']} | scope {len(included)}/{len(candidates)}",'V5_SCOPED_THREE_MODEL_EVALUATION',d['id'])
            self._log('DECISION',d['action']+' / '+d['status']+f" / {len(d['proposed_actions'])} proposals",'VERSIONED_DECISION',d['id'])
            if len(candidates)>24:self._log('LIMITATION',f'{len(candidates)-24} active shipment(s) excluded from this MILP; not a whole-network optimality claim','MODEL_SCOPE')
        except (ValueError,Conflict) as e:
            self.latest=None
            self._log('ERROR',str(e),'SOLVER')
        return round((time.perf_counter()-t)*1000,2)

    def sample_oag(self):
        # Snapshot selection never contains real OAG records; no key or web fetch.
        state=project(self.store,self.store.clock())
        upcoming=sorted((f for f in state['flights'].values() if
                 parse_time(f['estimated_departure'])>=parse_time(state['as_of'])),
                 key=lambda f:(f['estimated_departure'],f['id']))
        if not upcoming:upcoming=sorted(state['flights'].values(),key=lambda f:f['estimated_departure'])
        return synthetic_v2_sample(upcoming[:12],12)

    def observe_demo(self,flight_id,status):
        # THIS IS NOT AN AIRLINE FLIGHT STATUS MUTATION. It creates a cautionary
        # market-observation layer and revokes the current decision review snapshot.
        if status not in ('Canceled','Delayed','Scheduled'):
            raise ValueError('status must be Canceled, Delayed or Scheduled')
        with self.lock:
            sample=self.sample_oag()
            links={x['synthetic_relay_flight_id'] for x in sample['demoMappings']}
            if flight_id not in links:
                raise ValueError('select a flight from the current OAG schema demonstration')
            self.oag_revision+=1
            self.oag_observations[flight_id]={'flight_id':flight_id,'state':status,
                'observation_version':self.oag_revision,'observed_at':self.store.clock(),
                'source':'SYNTHETIC_OAG_SHAPED_UNVERIFIED',
                'authority':'EXTERNAL_INDICATOR_ONLY','inventory_mutated':False,
                'operator_confirmation':False}
            self.oag_log.append(self.oag_observations[flight_id])
            self._log('EXTERNAL',f'OAG-schema illustrative observation {flight_id} → {status}; carrier inventory unchanged',
                      'OAG_SHAPED_SYNTHETIC_NOT_AUTHORITATIVE',flight_id)
            return self.snapshot()

    def external_review_conflicts(self):
        if not self.latest:return []
        issues=[]
        for proposal in self.latest.get('proposed_actions',[]):
            for fid in proposal.get('route',[]):
                obs=self.oag_observations.get(fid)
                if obs and obs['state'] in ('Canceled','Delayed'):
                    issues.append({'shipment_id':proposal['shipment_id'],'flight_id':fid,
                                   'observed_state':obs['state'],
                                   'required_action':'INDEPENDENT_AIRLINE_VERIFICATION_FIRST'})
        return issues

    def review(self,choice,decision_id,expected_snapshot_version):
        with self.lock:
            if choice=='approve':
                if self.oag_decision_revision!=self.oag_revision:
                    raise Conflict('external observations changed after evaluation; rerun models and inspect evidence')
                if self.external_review_conflicts():
                    raise Conflict('external flight evidence conflicts with proposed route; independent airline verification required')
            return super().review(choice,decision_id,expected_snapshot_version)

    def evidence(self):
        with self.lock:
            state=project(self.store,self.store.clock())
            current=self.latest
            return {'decision_id':current['id'] if current else None,
             'snapshot_version':state['snapshot_version'], 'as_of':state['as_of'],
             'model_scope':self.last_scope,
             'process_logs':current.get('process_logs',[]) if current else [],
             'input_evidence':current.get('input_evidence',{}) if current else {},
             'cross_model_invariants':current.get('cross_model_invariants',{}) if current else {},
             'external_observations':list(self.oag_observations.values()),
             'external_review_conflicts':self.external_review_conflicts(),
             'oag_source':'SCHEMA_SHAPED_SYNTHETIC_NO_CREDENTIALS',
             'nonclaims':['No actual OAG data','No cargo inventory confirmation','No 3D loading certificate',
                          'No Graver full-basis search','No sequential POMDP','No calibrated ROI']}

    def snapshot(self):
        out=super().snapshot()
        conflict=self.external_review_conflicts()
        out['version']='5.0'
        out['mode']='CANONICAL_SYNTHETIC_AUDITABLE_SHADOW'
        out['decision_scope']=self.last_scope
        out['external_evidence_revision']=self.oag_revision
        out['external_evidence']={'observations':list(self.oag_observations.values()),
           'approval_conflicts':conflict,'stale_since_observation':self.oag_decision_revision!=self.oag_revision,
           'authority':'FLIGHT_INFO_OBSERVATION_ONLY_NOT_CAPACITY_OR_BOOKING'}
        if out.get('decision'):
            out['decision']['approval_blocked_external_evidence']=bool(conflict or self.oag_decision_revision!=self.oag_revision)
            out['decision']['stale']=out['decision']['stale'] or self.oag_decision_revision!=self.oag_revision
            if conflict:
                out['decision']['warnings'].append({'reason':'INDEPENDENT_FLIGHT_STATUS_VERIFICATION_REQUIRED','count':len(conflict)})
        return out


def data_quality_report():
    names=['flights','shipments','pieces','ulds','historical_events']
    files={n:[json.loads(x) for x in (DATA/(n+'.jsonl')).read_text().splitlines() if x.strip()] for n in names}
    fs={x['id']:x for x in files['flights']};ss={x['id']:x for x in files['shipments']};ps={x['id']:x for x in files['pieces']}
    ev=files['historical_events']
    checks={
       'id_uniqueness':all(len({r.get('id',r.get('event_id')) for r in rows})==len(rows) for rows in files.values()),
       'piece_to_shipment_links':all(p['shipment_id'] in ss for p in ps.values()),
       'shipment_piece_references':all(pid in ps and ps[pid]['shipment_id']==s['id'] for s in ss.values() for pid in s['piece_ids']),
       'shipment_weight_consistency':all(sum(ps[pid]['weight_kg'] for pid in s['piece_ids'])==s['weight_kg'] for s in ss.values()),
       'booked_flight_link':all(s['booked_flight_id'] in fs and s['assigned_flight_id'] in fs for s in ss.values()),
       'booked_flight_origin':all(fs[s['booked_flight_id']]['origin']==s['origin'] for s in ss.values()),
       'flight_temporal_order':all(parse_time(f['scheduled_departure'])<parse_time(f['scheduled_arrival']) for f in fs.values()),
       'event_receipt_after_occurrence':all(parse_time(e['event_time'])<=parse_time(e['received_at']) for e in ev),
       'positive_piece_geometry_and_mass':all(all(p[z]>0 for z in ('weight_kg','length_cm','width_cm','height_cm')) for p in ps.values()),
       'cargo_inventory_synthetic_not_oag':all(f.get('capacity_authority')=='SYNTHETIC_INVENTORY' for f in fs.values()),
    }
    return {'checks':checks,'pass_count':sum(checks.values()),'check_count':len(checks),
       'catalog_counts':{k:len(v) for k,v in files.items()},
       'calibration':'SYNTHETIC_NOT_EMPIRICALLY_VALIDATED',
       'limitations':['No actual OAG data','No real airline cargo inventory','No independent data accuracy ground truth',
                      'No real aircraft load-control / dangerous goods safety validation',
                      'Generated event distributions are not empirically validated Cathay distributions']}


def audit_lab(lab:AuditedLab):
    """Fast non-mutating online assertions; offline property tests in tests/test_v5_audit.py."""
    with lab.lock:
        snap=lab.snapshot();d=lab.latest; data=data_quality_report()
        checks=[]
        def add(id,passed,detail,scope='RUNTIME'):
            checks.append({'id':id,'passed':bool(passed),'detail':detail,'scope':scope})
        add('one_canonical_catalog',all(j['id'] in lab.admitted for j in snap['shipment_objects']),
            'Every rendered shipment has a canonical admitted ID')
        add('both_policies_same_admissions',all(set(j['id'] for j in p['waiting'])|set(a['job']['id'] for a in p['active'])|set(p['completed'])==lab.admitted for p in lab.policies.values()),
            'FCFS and RELAY receive the same admitted job IDs, regardless of task status')
        add('no_unsafe_task_dispatch',all(p['unsafe_dispatches']==0 for p in lab.policies.values()),
            'No knowingly blocked job was selected by staging dispatcher')
        add('model_i_not_3d_certified',not d or d['model_i'].get('operational_load_certificate') is False,
            '2D candidate library never returns an airworthiness claim')
        add('model_ii_local_counterfactual_labeled',not d or all(
           c.get('downstream_cost_provenance')=='LOCAL_CANDIDATE_ROUTE_COST_PROXY_NOT_JOINT_MILP'
           for c in d['model_ii'].get('cases',[])), 'Verification costs explicitly disclosed as local candidate route proxies')
        add('model_ii_bayes_identity',not d or all(abs(c['cost_immediate']-c['cost_verify']-c['verification_net_value'])<2e-4 for c in d['model_ii'].get('cases',[])),
            'Bayesian information-value identity matches computed costs to rounding tolerance')
        blocked={c['shipment_id'] for c in (d or {}).get('model_ii',{}).get('cases',[])}
        add('cross_model_uncertainty_gate',not d or all(p['shipment_id'] not in blocked for p in d['proposed_actions']),
            'No conflicting-dimension case appears in a recovery proposal')
        add('all_proposals_tentative',not d or all(p.get('route_status')=='PROPOSAL_NOT_BOOKED' for p in d['proposed_actions']),
            'No internal route proposal is mislabeled booked')
        add('zero_external_commands',not d or d.get('real_commands_sent') is False,
            'Engine made no real airline, ground crew or booking calls')
        add('milp_scope_disclosed',snap['decision_scope']['evaluated']<=24 and
            snap['decision_scope']['eligible']>=snap['decision_scope']['evaluated'],
            'Scope of finite MILP candidate set reported explicitly')
        add('external_oag_not_capacity_authority',all(x.get('inventory_mutated') is False for x in lab.oag_observations.values()),
            'OAG-style external observations never overwrite synthetic booking/remaining kg')
        add('flight_evidence_review_gate',not (lab.external_review_conflicts() and
            not snap['decision'].get('approval_blocked_external_evidence')) if snap.get('decision') else True,
            'Conflicting external flight evidence blocks operator approval')
        for k,v in data['checks'].items():add('data_'+k,v,'Canonical dataset integrity check','INPUT')
        add('model_i_3d_operational_certified',False,'Missing real aircraft geometry, support, tie-down and load-control authority','PRODUCTION_GAP')
        add('model_ii_sequential_controller',False,'Finite one-step Bayesian controller, not general finite-horizon belief MDP','PRODUCTION_GAP')
        add('model_iii_graver_search_integrated',False,'Graver/cluster appears as proof fixture, not global production solver','PRODUCTION_GAP')
        add('empirical_cathay_validation',False,'Synthetic demand/cost/probability only; no carrier field calibration','PRODUCTION_GAP')
        runnable=[x for x in checks if x['scope']!='PRODUCTION_GAP']
        return {'overall':'RESEARCH_SHADOW_READY_NOT_PRODUCTION_CERTIFIED',
          'runtime_pass':sum(x['passed'] for x in runnable), 'runtime_total':len(runnable),
          'production_gaps':len([x for x in checks if x['scope']=='PRODUCTION_GAP' and not x['passed']]),
          'checks':checks,'data':data,
          'as_of':snap['clock'],'snapshot_version':snap['snapshot_version'],
          'scope':snap['decision_scope'],
          'truth_labels':{'stage':'SYNTHETIC_3D_SCHEMATIC','model_i':'2D_DIAGNOSTIC',
              'model_ii':'ONE_STEP_BAYES_LOCAL_COST_PROXY','model_iii':'ENUMERATED_MILP',
              'oag':'PUBLIC_SCHEMA_SHAPED_SYNTHETIC','customer':'SYNTHETIC_PROJECTED_STATUS'}}
