"""Audit SKU shards against the existing same-source price totals, without printing item data."""
import pathlib,json,gzip,collections,math,sys,hashlib
root=pathlib.Path(__file__).resolve().parents[1];folder=root/'.cache/product-snapshot';index=json.loads((folder/'index.json').read_text(encoding='utf-8'));manifest=json.loads((root/'data/manifest.json').read_text(encoding='utf-8'))
from product_leaders import category_points,write_leader,merge
leaders={}
plats={'tmall':0,'jd':1,'douyin':2};total=0;verified=0
for cid,parts in index['files'].items():
 if cid not in manifest['files']['price']:continue
 expected=collections.defaultdict(float);source=manifest['files']['price'][cid]
 for r in json.loads(gzip.decompress((root/'data'/source).read_bytes())):
  if r[3] is not None:expected[(r[0],r[1])]+=r[3]
 actual=collections.defaultdict(float)
 def decoded():
  global total
  for part in sorted(parts,key=lambda v:v['month']):
   payload=(folder/part['path']).read_bytes();assert hashlib.sha256(payload).hexdigest()==part['sha256']
   rows=json.loads(gzip.decompress(payload));assert len(rows)==part['rows'];total+=len(rows)
   for r in rows:
    p=plats.get(r[0],r[0] if isinstance(r[0],int) else None)
    if p is not None and r[5] is not None:actual[(part['month'],p)]+=float(r[5])
   yield part['month'],rows
 points=category_points(cid,decoded(),index['last']);leaders[cid]=write_leader(folder,cid,points)
 for key,g in actual.items():assert math.isclose(g,expected.get(key,0),rel_tol=1e-8,abs_tol=1),f'Product/price mismatch {cid} {key}'
 for key,g in expected.items():assert math.isclose(g,actual.get(key,0),rel_tol=1e-8,abs_tol=1),f'Missing product total {cid} {key}'
 verified+=1
 if verified%100==0:print('Audited',verified,'categories',total,'rows',flush=True)
print('PASS source reconciliation',verified,'categories',total,'rows',flush=True)

for key,scope in manifest['scopes'].items():
 merged={}
 for cid in scope['ids']:
  if cid not in leaders:continue
  leaf=json.loads(gzip.decompress((folder/leaders[cid]['path']).read_bytes()))['points']
  for month,masks in leaf.items():
   if month not in merged:merged[month]={}
   for mask,p in masks.items():
    merged[month][mask]=merge([merged[month][mask],p]) if mask in merged[month] else p
 leaders[key]=write_leader(folder,key,merged)
index['leaders']=leaders
(folder/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print('Exact SKU leader indexes built',len(leaders),flush=True)
