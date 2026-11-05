"""One-page price evidence: exact leaf/month/platform/band records, grouped for fast loading."""
import gzip,hashlib,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
def build():
 d=ROOT/'data';m=json.loads((d/'manifest.json').read_text(encoding='utf-8'));out={}
 for key,s in m['scopes'].items():
  if key=='scope_all':continue
  rows=[]
  for cid in s['ids']:
   path=m['files']['price'].get(cid)
   if path:
    for r in json.loads(gzip.decompress((d/path).read_bytes())):rows.append([cid,*r])
  payload=gzip.compress(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
  path='files/report/'+hashlib.sha256(payload).hexdigest()[:16]+'.json.gz'
  (d/path).parent.mkdir(parents=True,exist_ok=True);(d/path).write_bytes(payload);out[key]=path
 m['report']={'sourceVersion':m['version'],'prices':out}
 (d/'manifest.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 print('Report bundles',len(out),'bytes',sum((d/p).stat().st_size for p in out.values()))
if __name__=='__main__':build()
