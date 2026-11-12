"""SQLite transactional event store for standalone local sandbox (not production security)."""
from __future__ import annotations
import sqlite3,json,hashlib
from contextlib import contextmanager
from pathlib import Path
from .synthetic import load_jsonl

# Event-type authority is explicit; a trusted source for tracking may NOT mutate inventory.
EVENT_AUTHORITIES = {
 'flight_delay':('flight',{'SYNTHETIC_FLIGHT_OPS'}),
 'flight_cancelled':('flight',{'SYNTHETIC_FLIGHT_OPS'}),
 'flight_restored':('flight',{'SYNTHETIC_FLIGHT_OPS'}),
 'flight_state_update':('flight',{'SYNTHETIC_FLIGHT_OPS'}),
 'capacity_changed':('flight',{'SYNTHETIC_INVENTORY'}),
 'terminal_congestion':('terminal',{'SYNTHETIC_GROUND_OPS'}),
 'weather_disruption':('terminal',set()),
 'shipment_dimension_conflict':('shipment',{'SYNTHETIC_MEASUREMENT'}),
 'shipment_dimension_verified':('shipment',{'SYNTHETIC_MEASUREMENT'}),
 'uld_unavailable':('uld',{'SYNTHETIC_ULD_OPS'}),
 'uld_restored':('uld',{'SYNTHETIC_ULD_OPS'}),
 'shipment_milestone':('shipment',{'SYNTHETIC_TRACK_TRACE'}),
 'booking_change':('shipment',{'SYNTHETIC_BOOKING'}),
 'customer_priority_update':('shipment',{'SYNTHETIC_BOOKING'}),
 'ground_task_ack':('task',{'SYNTHETIC_GROUND_OPS'}),
 'customs_hold':('shipment',{'SYNTHETIC_CUSTOMS'}),
 'customs_released':('shipment',{'SYNTHETIC_CUSTOMS'})
}
ALLOWED_TRUSTED=set().union(*(src for _,src in EVENT_AUTHORITIES.values()))

def payload_valid(e):
    k=e['event_type'];p=e['payload']
    if k=='flight_delay':return isinstance(p.get('delay_seconds'),int) and 0<=p['delay_seconds']<=86400
    if k=='flight_state_update':return p.get('state') in ('Scheduled','OutGate','InAir','Landed','InGate','Canceled','Diverted')
    if k=='capacity_changed':
        kg=p.get('remaining_kg');cold=p.get('cool_remaining_kg')
        return isinstance(kg,int) and 0<=kg<=5000 and (cold is None or (isinstance(cold,int) and 0<=cold<=kg))
    if k=='terminal_congestion':
        x=p.get('capacity_fraction');d=p.get('duration_seconds',10800)
        return isinstance(x,(int,float)) and .2<=x<=1 and isinstance(d,int) and 0<d<=86400
    if k=='shipment_milestone':return p.get('code') in ('BKD','RCS','DEP','ARR','RCF','NFD','DLV')
    if k=='booking_change':return p.get('confirmation') in ('REQUESTED','HELD','CONFIRMED','REJECTED') and isinstance(p.get('flight_id'),str)
    if k=='shipment_dimension_verified':
        ds=p.get('dimensions_cm');return isinstance(p.get('piece_id'),str) and isinstance(ds,list) and len(ds)==3 and all(isinstance(x,int) and 0<x<600 for x in ds)
    if k=='customer_priority_update':return p.get('service') in ('STANDARD','PRIORITY','CRITICAL')
    return True


class Conflict(Exception): pass
class Missing(Exception): pass

class Store:
    def __init__(self,path: str):
        self.path=str(path)
        Path(self.path).parent.mkdir(parents=True,exist_ok=True)
        self.init()

    @contextmanager
    def tx(self,write=False):
        con=sqlite3.connect(self.path,timeout=10,isolation_level=None)
        con.row_factory=sqlite3.Row
        con.execute('PRAGMA busy_timeout=10000')
        con.execute('PRAGMA journal_mode=WAL')
        try:
            con.execute('BEGIN IMMEDIATE' if write else 'BEGIN')
            yield con
            con.commit()
        except Exception:
            con.rollback();raise
        finally:con.close()

    def init(self):
        with self.tx(True) as con:
            con.executescript('''
            CREATE TABLE IF NOT EXISTS catalog (kind TEXT,id TEXT,body TEXT NOT NULL,PRIMARY KEY(kind,id));
            CREATE TABLE IF NOT EXISTS events (
               event_id TEXT PRIMARY KEY, body TEXT NOT NULL,
               event_type TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,
               event_time TEXT NOT NULL, received_at TEXT NOT NULL,
               disposition TEXT NOT NULL, reason TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_ev_received ON events(received_at);
            CREATE INDEX IF NOT EXISTS idx_ev_entity ON events(entity_type,entity_id);
            CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,body TEXT NOT NULL, status TEXT NOT NULL,
              snapshot_version INTEGER NOT NULL,created_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, at TEXT, ref TEXT, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,decision_id TEXT,body TEXT NOT NULL,status TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, outcome TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT OR IGNORE INTO meta(key,value) VALUES('version','0');
            INSERT OR IGNORE INTO meta(key,value) VALUES('policy','{"mode":"HUMAN_APPROVAL","max_auto_cost_units":0,"allow_simulated_dispatch":true}');
            ''')

    def load_demo(self,folder):
        # This is idempotent: only load first time; avoids overriding event modifications.
        with self.tx(True) as con:
            if con.execute('SELECT 1 FROM catalog LIMIT 1').fetchone(): return False
            for kind,fn in [('flight','flights.jsonl'),('shipment','shipments.jsonl'),('piece','pieces.jsonl'),('uld','ulds.jsonl')]:
                for row in load_jsonl(Path(folder)/fn):
                    con.execute('INSERT INTO catalog VALUES(?,?,?)',(kind,row['id'],json.dumps(row,separators=(',',':'))))
            for e in load_jsonl(Path(folder)/'historical_events.jsonl'):
                con.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)',
                    (e['event_id'],json.dumps(e),e['event_type'],e['entity_type'],e['entity_id'],e['event_time'],e['received_at'],
                     'ACCEPTED' if e['trusted'] and e['source'] in EVENT_AUTHORITIES[e['event_type']][1] else 'OBSERVED_UNVERIFIED',
                     'historical synthetic event'))
            con.execute('UPDATE meta SET value=? WHERE key="version"',('1',))
            return True

    def version(self,con=None):
        if con:return int(con.execute('SELECT value FROM meta WHERE key="version"').fetchone()[0])
        with self.tx() as c:return self.version(c)
    def increment(self,con):con.execute('UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key="version"')

    def catalog(self,kind,ids=None):
        with self.tx() as con:
            if ids is None:rows=con.execute('SELECT body FROM catalog WHERE kind=?',(kind,)).fetchall()
            else:
                if not ids:return []
                q=','.join('?'*len(ids))
                rows=con.execute(f'SELECT body FROM catalog WHERE kind=? AND id IN ({q})',(kind,*ids)).fetchall()
        return [json.loads(x[0]) for x in rows]
    def get_catalog(self,kind,id):
        with self.tx() as con:
            row=con.execute('SELECT body FROM catalog WHERE kind=? AND id=?',(kind,id)).fetchone()
        if not row:raise Missing(f'{kind} {id} not found')
        return json.loads(row[0])

    def events(self,until=None,limit=None,entity_id=None):
        conditions=[]; args=[]
        if until:conditions.append('received_at<=?');args.append(until)
        if entity_id:conditions.append('entity_id=?');args.append(entity_id)
        sql='SELECT body,disposition,reason FROM events'+(' WHERE '+' AND '.join(conditions) if conditions else '')+' ORDER BY received_at,event_id'
        if limit:sql+=' LIMIT ?';args.append(limit)
        with self.tx() as con:rows=con.execute(sql,args).fetchall()
        return [{**json.loads(x[0]),'disposition':x[1],'disposition_reason':x[2]} for x in rows]

    def append_event(self,e):
        body=e.model_dump() if hasattr(e,'model_dump') else e
        raw=json.dumps(body,sort_keys=True,separators=(',',':'))
        # trusted requires more than caller-provided boolean; this demo relies on whitelisted synthetic source.
        entity_expected,allowed=EVENT_AUTHORITIES[body['event_type']]
        disposition='ACCEPTED' if body['trusted'] and body['source'] in allowed else 'OBSERVED_UNVERIFIED'
        reason='trusted synthetic field-specific authority' if disposition=='ACCEPTED' else 'unverified or unauthorized source; no authoritative mutation'
        if body['entity_type']!=entity_expected or not payload_valid(body):
            disposition='QUARANTINED';reason='event entity type or payload fails typed policy'
        if body['entity_type'] != 'terminal' and body['entity_type'] != 'task':
            try:self.get_catalog(body['entity_type'],body['entity_id'])
            except Missing:disposition='QUARANTINED';reason='unknown referenced entity'
        with self.tx(True) as con:
            old=con.execute('SELECT body,disposition FROM events WHERE event_id=?',(body['event_id'],)).fetchone()
            if old:
                if json.dumps(json.loads(old[0]),sort_keys=True,separators=(',',':'))!=raw:
                    raise Conflict('same event_id with different content')
                return {'event_id':body['event_id'],'disposition':old[1],'duplicate':True,'snapshot_version':self.version(con)}
            con.execute('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)',
                (body['event_id'],raw,body['event_type'],body['entity_type'],body['entity_id'],body['event_time'],body['received_at'],disposition,reason))
            self.increment(con)
            ver=self.version(con)
            con.execute('INSERT INTO logs(category,at,ref,body) VALUES(?,?,?,?)',
               ('INPUT',body['received_at'],body['event_id'],json.dumps({'event_type':body['event_type'],'entity_id':body['entity_id'],
                'source':body['source'],'event_time':body['event_time'],'received_at':body['received_at'],
                'disposition':disposition,'reason':reason})))
            return {'event_id':body['event_id'],'disposition':disposition,'duplicate':False,'snapshot_version':ver,'reason':reason}

    def insert_decision(self,body):
        with self.tx(True) as con:
            if self.version(con)!=body['snapshot_version']:raise Conflict('snapshot advanced during evaluation; rerun')
            con.execute('INSERT INTO decisions VALUES(?,?,?,?,?)',(body['id'],json.dumps(body),body['status'],body['snapshot_version'],body['created_at']))
            for log in body['process_logs']:
                con.execute('INSERT INTO logs(category,at,ref,body) VALUES(?,?,?,?)',('PROCESS',body['created_at'],body['id'],json.dumps(log)))
            con.execute('INSERT INTO logs(category,at,ref,body) VALUES(?,?,?,?)',
                ('DECISION',body['created_at'],body['id'],json.dumps({'action':body['action'],'status':body['status'],
                   'plan':body['plan'],'review_required':body['review_required'],'reason_codes':body['reason_codes']})))
        return body

    def get_decision(self,id):
        with self.tx() as con:r=con.execute('SELECT body,status FROM decisions WHERE id=?',(id,)).fetchone()
        if not r:raise Missing('decision not found')
        d=json.loads(r[0]); d['status']=r[1];return d

    def review(self,id,req,at):
        with self.tx(True) as con:
            idem=con.execute('SELECT outcome FROM idempotency WHERE key=?',(req.idempotency_key,)).fetchone()
            if idem:
                cached=json.loads(idem[0])
                if cached.get('decision_id')!=id or cached.get('_request')!=req.model_dump():
                    raise Conflict('idempotency key reused with different decision or review content')
                return {k:v for k,v in cached.items() if k!='_request'}
            r=con.execute('SELECT body,status,snapshot_version FROM decisions WHERE id=?',(id,)).fetchone()
            if not r:raise Missing('decision not found')
            if r[1]!='PENDING_REVIEW':raise Conflict('decision already reviewed')
            if req.expected_snapshot_version!=self.version(con) or int(r[2])!=self.version(con):
                raise Conflict('stale state: new events or decisions since evaluation; must reevaluate')
            d=json.loads(r[0])
            if req.decision=='approve' and (d['action'] in ('ESCALATE','VERIFY','HOLD') or not d['proposed_actions']):
                raise Conflict('no executable work proposed; this is a diagnostic/verification decision')
            status='APPROVED_SIMULATION_ONLY' if req.decision=='approve' else 'REJECTED'
            con.execute('UPDATE decisions SET status=? WHERE id=?',(status,id))
            task_ids=[]
            if req.decision=='approve':
                # Multiple bounded departmental threads; NO real notifications sent.
                workflow=[('CARGO_NETWORK_CONTROL','RECONFIRM_BOOKABLE_CAPACITY'),
                          ('WAREHOUSE_PLANNING','CHECK_ULD_AND_BUILDUP_FEASIBILITY'),
                          ('GROUND_HANDLING','PREPARE_CHANGE_REQUEST_NO_PHYSICAL_MOVE'),
                          ('CUSTOMER_SERVICE','PREPARE_CUSTOMER_EXPLANATION_NOT_SEND')]
                for j,a in enumerate(d['proposed_actions']):
                    previous=None
                    for k,(team,kind) in enumerate(workflow):
                        tid=f'{id}-S{j+1:02d}-T{k+1:02d}'
                        task={'id':tid,'decision_id':id,'shipment_id':a['shipment_id'],
                            'proposed_route':a['route'],'team':team,'task_type':kind,
                            'sequence':k+1,'depends_on_task_id':previous,
                            'status':'QUEUED_SIMULATED',
                            'dispatch_status':'NOT_SENT_TO_REAL_OPERATIONS',
                            'approved_at':at,'requires_external_booking_confirmation':True,
                            'physical_execution_permitted':False}
                        con.execute('INSERT INTO tasks VALUES(?,?,?,?)',(tid,id,json.dumps(task),'QUEUED_SIMULATED'))
                        task_ids.append(tid)
                        previous=tid
            out={'decision_id':id,'status':status,'task_ids':task_ids,'human_reviewer':req.reviewer,
                 'real_world_execution':False,'at':at}
            con.execute('INSERT INTO idempotency VALUES(?,?)',(req.idempotency_key,json.dumps({**out,'_request':req.model_dump()})))
            con.execute('INSERT INTO logs(category,at,ref,body) VALUES(?,?,?,?)',('DECISION',at,id,json.dumps({'review':out,'reason':req.reason})))
            self.increment(con)
            return out

    def tasks(self,decision_id=None):
        with self.tx() as con:
            if decision_id:r=con.execute('SELECT body,status FROM tasks WHERE decision_id=?',(decision_id,)).fetchall()
            else:r=con.execute('SELECT body,status FROM tasks').fetchall()
        return [{**json.loads(x[0]),'status':x[1]} for x in r]

    def ack_task(self,id,req,at):
        with self.tx(True) as con:
            old=con.execute('SELECT outcome FROM idempotency WHERE key=?',(req.idempotency_key,)).fetchone()
            if old:return json.loads(old[0])
            r=con.execute('SELECT body,status FROM tasks WHERE id=?',(id,)).fetchone()
            if not r:raise Missing('task not found')
            if r[1] not in ('QUEUED_SIMULATED','ACKNOWLEDGED'):raise Conflict('task already terminal')
            if r[1]=='ACKNOWLEDGED' and req.status=='ACKNOWLEDGED':raise Conflict('already acknowledged')
            t=json.loads(r[0])
            if req.status=='DONE' and t.get('depends_on_task_id'):
                dep=con.execute('SELECT status FROM tasks WHERE id=?',(t['depends_on_task_id'],)).fetchone()
                if not dep or dep[0]!='DONE':raise Conflict('prerequisite task not yet complete')
            t.update({'status':req.status,'worker':req.worker,'updated_at':at})
            con.execute('UPDATE tasks SET body=?,status=? WHERE id=?',(json.dumps(t),req.status,id))
            out={'task_id':id,'status':req.status,'simulation_only':True}
            con.execute('INSERT INTO idempotency VALUES(?,?)',(req.idempotency_key,json.dumps({**out,'_request':req.model_dump()})))
            con.execute('INSERT INTO logs(category,at,ref,body) VALUES(?,?,?,?)',('OUTPUT',at,id,json.dumps(out)))
            self.increment(con)
            return out

    def logs(self,category=None,limit=60):
        with self.tx() as con:
            if category:r=con.execute('SELECT * FROM logs WHERE category=? ORDER BY id DESC LIMIT ?',(category,limit)).fetchall()
            else:r=con.execute('SELECT * FROM logs ORDER BY id DESC LIMIT ?',(limit,)).fetchall()
        return [{'sequence':x['id'],'category':x['category'],'at':x['at'],'ref':x['ref'],**json.loads(x['body'])} for x in reversed(r)]

    def logs_since(self,after=0,limit=200):
        """Ascending cursor semantics: never silently discard older unconsumed messages."""
        with self.tx() as con:
            rows=con.execute('SELECT * FROM logs WHERE id>? ORDER BY id ASC LIMIT ?',
                             (after,limit)).fetchall()
        return [{'sequence':x['id'],'category':x['category'],'at':x['at'],
                 'ref':x['ref'],**json.loads(x['body'])} for x in rows]

    def policy(self):
        with self.tx() as con:r=con.execute('SELECT value FROM meta WHERE key="policy"').fetchone()
        return json.loads(r[0])
    def set_policy(self,v):
        with self.tx(True) as con:
            con.execute('UPDATE meta SET value=? WHERE key="policy"',(json.dumps(v),));self.increment(con)
        return v

    def clock(self):
        with self.tx() as con:
            r=con.execute('SELECT value FROM meta WHERE key="clock"').fetchone()
            return r[0] if r else '2026-11-09T01:00:00Z'
    def set_clock(self,at):
        with self.tx(True) as con:
            old=con.execute('SELECT value FROM meta WHERE key="clock"').fetchone()
            if old and at<old[0]:raise Conflict('simulation clock cannot go backwards')
            con.execute('INSERT INTO meta(key,value) VALUES("clock",?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(at,))
            self.increment(con)
        return at

    def decisions(self,status=None,limit=100):
        with self.tx() as con:
            if status:rows=con.execute('SELECT body,status FROM decisions WHERE status=? ORDER BY created_at DESC, rowid DESC LIMIT ?',(status,limit)).fetchall()
            else:rows=con.execute('SELECT body,status FROM decisions ORDER BY created_at DESC, rowid DESC LIMIT ?',(limit,)).fetchall()
        return [{**json.loads(r[0]),'status':r[1]} for r in rows]
