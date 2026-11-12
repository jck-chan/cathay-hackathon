"""Conservative three-dimensional AABB *preflight* using synthetic data.

Not the 3-D certified placement library from Model I paper; no aircraft contour,
restraint, centre of mass, support, tie-down or physical loading sequence. Because
ULD catalog has no certified height profile, caller must explicitly choose a
synthetic test envelope. No stacking is permitted: all solids have z=0.
"""
from itertools import permutations

def no_overlap(a,b):
    return a['x_cm']+a['length_cm']<=b['x_cm'] or b['x_cm']+b['length_cm']<=a['x_cm'] or \
           a['y_cm']+a['width_cm']<=b['y_cm'] or b['y_cm']+b['width_cm']<=a['y_cm'] or \
           a['z_cm']+a['height_cm']<=b['z_cm'] or b['z_cm']+b['height_cm']<=a['z_cm']

def preflight(pieces,uld,height_cm=145,clearance_cm=2,max_pieces=7):
    if not isinstance(height_cm,(int,float)) or not 50<=height_cm<=300:
        raise ValueError('synthetic ULD height must be within [50,300] cm')
    if not 0<=clearance_cm<=10:raise ValueError('clearance must be within [0,10] cm')
    selected=list(pieces)[:max_pieces]
    area_l,area_w=uld['usable_length_cm'],uld['usable_width_cm']
    available_mass=uld['max_gross_kg']-uld['tare_kg']
    used_mass=0.;boxes=[];not_fit=[]
    for p in sorted(selected,key=lambda p:-(p['length_cm']*p['width_cm'])):
        weight=p['weight_kg']
        if used_mass+weight>available_mass:
            not_fit.append({'piece_id':p['id'],'reason':'SYNTHETIC_ULD_WEIGHT_LIMIT'});continue
        length,width,height=p['length_cm'],p['width_cm'],p['height_cm']
        if height>height_cm:
            not_fit.append({'piece_id':p['id'],'reason':'ASSUMED_ENVELOPE_HEIGHT_EXCEEDED'});continue
        candidates=[]
        for l,w in sorted(set([(length,width),(width,length)])):
            xs={0}|{round(q['x_cm']+q['length_cm']+clearance_cm,5) for q in boxes}
            ys={0}|{round(q['y_cm']+q['width_cm']+clearance_cm,5) for q in boxes}
            for x in xs:
                for y in ys:
                    candidate={'piece_id':p['id'],'x_cm':x,'y_cm':y,'z_cm':0,
                        'length_cm':l,'width_cm':w,'height_cm':height,'weight_kg':weight}
                    if x+l>area_l or y+w>area_w:continue
                    padded={**candidate,'length_cm':l+clearance_cm,'width_cm':w+clearance_cm}
                    if all(no_overlap(padded,q) for q in boxes):candidates.append(candidate)
        if not candidates:
            not_fit.append({'piece_id':p['id'],'reason':'NO_FLOOR_RECTANGLE_AVAILABLE'});continue
        chosen=min(candidates,key=lambda q:(q['x_cm']+q['y_cm'],q['y_cm'],q['x_cm']))
        boxes.append(chosen);used_mass+=weight
    return {'status':'SYNTHETIC_3D_AXIS_ALIGNED_ENVELOPE_PREFLIGHT',
      'uld_id':uld['id'],'envelope_cm':[area_l,area_w,height_cm],
      'height_source':'USER_ASSUMPTION_NOT_CERTIFIED_AIRCRAFT_CONTOUR',
      'placements':boxes,'excluded':not_fit,
      'mass_kg':round(used_mass,3), 'mass_limit_kg':available_mass,
      'no_overlap':all(no_overlap(a,b) for i,a in enumerate(boxes) for b in boxes[i+1:]),
      'all_on_floor':True,'rotation_scope':'XY_90_DEGREES_ONLY',
      'independent_real_aircraft_certification':False,
      'validity':'PRELIMINARY_GEOMETRIC_ENVELOPE_ONLY_NOT_OPERATIONAL_OR_AIRWORTHINESS_CERTIFICATION',
      'not_checked':['aircraft contour','stacking/restraint','cargo load balance','side clearance and tie down','loading path','DGR compatibility','floor loading stress']}
