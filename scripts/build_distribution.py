"""Build small exact CR5 snapshots for every hierarchy node/month/platform mask.
Reads only the already published immutable aggregates; no source DB access.
Run after package_data.py so summaries and manifest always refer to the same source.
"""
import collections, gzip, hashlib, heapq, json, pathlib, re
from package_data import shift
ROOT=pathlib.Path(__file__).resolve().parents[1]
UNKNOWN=re.compile(r'^(其他(?:\s*Other)?|Other|未识别品牌|无品牌|未知|无)$',re.I)
def read(p): return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
def decode(p):
    d=read(p)
    if isinstance(d,list): return d
    return [[r[0],r[1],d['labels'][r[2]],*r[3:]] for r in d['rows']]
def merge(dest, src):
    for m, platforms in src.items():
        for p, brands in platforms.items():
            for name,g in brands.items(): dest[m][p][name]+=g

def monthly_map(): return collections.defaultdict(lambda:collections.defaultdict(lambda:collections.defaultdict(float)))
def rolling_cr5(monthly, first, last):
    maps=[collections.defaultdict(float) for _ in range(3)]; result={};m=first
    while m<=last:
        for month,sign in [(m,1),(shift(m,-12),-1)]:
            for p,brands in monthly.get(month,{}).items():
                for name,g in brands.items():
                    maps[p][name]+=sign*g
                    if abs(maps[p][name])<1e-7: del maps[p][name]
        values=[]
        for mask in range(1,8):
            merged=collections.defaultdict(float)
            for p in range(3):
                if mask&(1<<p):
                    for name,g in maps[p].items(): merged[name]+=g
            total=sum(merged.values())
            top=heapq.nlargest(5,(g for n,g in merged.items() if n and not UNKNOWN.fullmatch(n.strip())))
            values.append(round(sum(top)/total,12) if total>0 else None)
        result[m]=values;m=shift(m,1)
    return result

def build(data=ROOT/'data'):
    manifest=read(data/'manifest.json');industry=read(data/manifest['industry'])
    source=hashlib.sha256(json.dumps([manifest['industry'],manifest['files']['brand']],sort_keys=True).encode()).hexdigest()
    old=manifest.get('distribution',{})
    if old.get('sourceVersion')==manifest['version'] and old.get('source')==source and all((data/p).exists() for p in old.get('months',{}).values()) and old.get('months'):
        print('Distribution summaries unchanged',flush=True);return
    byend={};first,last=manifest['first'],manifest['last']
    def save(path,monthly):
        key=json.dumps(path,ensure_ascii=False,separators=(',',':'))
        for m,values in rolling_cr5(monthly,first,last).items():byend.setdefault(m,{})[key]=values
    roots=collections.defaultdict(list)
    for c in industry['categories']:roots[c['path'][0]].append(c)
    for root,cats in roots.items():
        root_monthly=monthly_map();seconds=collections.defaultdict(list)
        for c in cats:seconds[c['path'][1]].append(c)
        for second,leaves in seconds.items():
            second_monthly=monthly_map()
            for c in leaves:
                monthly=monthly_map();entry=manifest['files']['brand'].get(c['id'])
                paths=[e['path'] for e in entry] if isinstance(entry,list) else [entry] if entry else []
                for p in paths:
                    for month,platform,name,g,*_ in decode(data/p):monthly[month][platform][name]+=g or 0
                save(c['path'],monthly);merge(second_monthly,monthly)
            save([root,second],second_monthly);merge(root_monthly,second_monthly)
        save([root],root_monthly)
        print('Distribution root complete:',root,flush=True)
    dest=data/'files'/'distribution';dest.mkdir(parents=True,exist_ok=True);paths={}
    for m,nodes in byend.items():
        payload=gzip.compress(json.dumps(nodes,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode(),mtime=0)
        p=dest/(hashlib.sha256(payload).hexdigest()[:16]+'.json.gz');p.write_bytes(payload);paths[str(m)]=p.relative_to(data).as_posix()
    manifest['distribution']={'source':source,'sourceVersion':manifest['version'],'months':paths}
    (data/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print('Distribution ready:',len(paths),'months;',len(next(iter(byend.values()))),'nodes; total compressed bytes',sum((data/p).stat().st_size for p in paths.values()),flush=True)
if __name__=='__main__':build()
