"""Precompute exact rolling-year top-five summaries for all month/platform choices.
This avoids downloading millions of brand rows just to draw the overview table.
"""
import collections,gzip,heapq,json,re
from package_data import shift
UNKNOWN=re.compile(r'^(其他(?:\s*Other)?|Other|未识别品牌|无品牌|未知|无)$',re.I)
def known(name):return bool(name and not UNKNOWN.match(name.strip()))
def summarize(maps,mask):
    merged=collections.defaultdict(float)
    for p in range(3):
        if mask&(1<<p):
            for name,g in maps[p].items():merged[name]+=g
    total=sum(merged.values())
    top=heapq.nlargest(5,((n,g) for n,g in merged.items() if g>1e-6 and known(n)),key=lambda x:x[1])
    return {'total':round(total,4),'top':[[n,round(g,4)] for n,g in top]}
def add(maps,rows,factor):
    for r in rows:
        p,name,g=r[1],r[2],r[3] or 0
        v=maps[p].get(name,0)+g*factor
        if abs(v)<1e-6:maps[p].pop(name,None)
        else:maps[p][name]=v
def build(cache,first,last):
    byend={};m=shift(first,23)
    while m<=last:byend[m]={};m=shift(m,1)
    for i,f in enumerate(sorted((cache/'brand').glob('*.json.gz'))):
        cid=f.name.split('.')[0];rows=json.loads(gzip.decompress(f.read_bytes()));monthly=collections.defaultdict(list)
        for r in rows:monthly[r[0]].append(r)
        cur=[{} for _ in range(3)];prev=[{} for _ in range(3)]
        m=first
        while m<=last:
            add(cur,monthly[m],1);add(cur,monthly[shift(m,-12)],-1)
            add(prev,monthly[shift(m,-12)],1);add(prev,monthly[shift(m,-24)],-1)
            if m in byend:byend[m][cid]={mask:{'cur':summarize(cur,mask),'prev':summarize(prev,mask)} for mask in range(1,8)}
            m=shift(m,1)
        if i%100==0:print('insights',i,'categories',flush=True)
    dest=cache/'insights';dest.mkdir(exist_ok=True)
    for m,contents in byend.items():
        (dest/(str(m)+'.json.gz')).write_bytes(gzip.compress(json.dumps(contents,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    print('insights done',len(byend),'month bundles',flush=True)
if __name__=='__main__':
    from package_data import CACHE,read
    meta=read(CACHE/'industry-meta.json');build(CACHE,meta['first'],meta['last'])
