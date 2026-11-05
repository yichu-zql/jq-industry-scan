"""Exact reusable first-level brand/price cubes, split by price band (no TOP truncation)."""
import collections,gzip,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
def read(p):return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
def build():
 data=ROOT/'data';m=read(data/'manifest.json')
 source=hashlib.sha256(json.dumps([m['files']['brandprice'],m['scopes']],sort_keys=True).encode()).hexdigest()
 old=m.get('competitionCubes',{})
 if old.get('source')==source and old.get('sourceVersion')==m['version'] and all((data/p).exists() for v in old.get('scopes',{}).values() for p in v.values()):
  print('Competition cubes unchanged');return
 dest=data/'files'/'competition';dest.mkdir(parents=True,exist_ok=True);scopes={}
 for key,scope in m['scopes'].items():
  if key=='scope_all':continue
  bands=collections.defaultdict(dict)
  for cid in scope['ids']:
   entry=m['files']['brandprice'].get(cid)
   paths=[v['path'] for v in entry] if isinstance(entry,list) else [entry] if entry else []
   for path in paths:
    d=read(data/path);labels=None if isinstance(d,list) else d['labels']
    for month,p,name,b,g,q in d if isinstance(d,list) else d['rows']:
     name=name if labels is None else labels[name];k=(month,p,name);v=bands[b].setdefault(k,[0,0]);v[0]+=g or 0;v[1]+=q or 0
  out={}
  for b,values in bands.items():
   labels=sorted({k[2] for k in values});lookup={n:i for i,n in enumerate(labels)}
   rows=[[month,p,lookup[n],b,*v] for (month,p,n),v in sorted(values.items())]
   payload=gzip.compress(json.dumps({'labels':labels,'rows':rows},ensure_ascii=False,separators=(',',':'),allow_nan=False).encode(),compresslevel=6,mtime=0)
   target=dest/(hashlib.sha256(payload).hexdigest()[:16]+'.json.gz');target.write_bytes(payload);out[str(b)]=target.relative_to(data).as_posix()
  scopes[key]=out;print('Competition cube:',key,len(out),'bands',flush=True)
 m['competitionCubes']={'sourceVersion':m['version'],'source':source,'scopes':scopes}
 (data/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 print('Competition compressed bytes',sum((data/p).stat().st_size for v in scopes.values() for p in v.values()),flush=True)
if __name__=='__main__':build()
