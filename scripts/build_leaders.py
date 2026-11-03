"""Exact first-view summaries for the latest common periods and complete scopes."""
import collections,gzip,heapq,json
from package_data import CACHE,read,shift
from build_insights import known

def add(target,rows,mask):
    for m,p,n,g,q in rows:
        if mask&(1<<p):
            a=target.setdefault(n,[0,0]);a[0]+=g or 0;a[1]+=q or 0

def ranks(values,n=150):
    return heapq.nlargest(n,((name,g,q) for name,(g,q) in values.items() if known(name)),key=lambda r:r[1])

def compact(values,selected=None,include_rank=True):
    top=ranks(values,150 if selected is None else 5);names={r[0] for r in top}
    if selected:names.update(selected)
    kept=sorted([(n,*values[n]) for n in names if n in values and known(n)],key=lambda r:r[1],reverse=True)
    rank_map={n:i+1 for i,(n,g,q) in enumerate(ranks(values,len(values)))} if include_rank else {}
    result=[{'name':n,'g':g,'q':q,'rank':rank_map.get(n)} for n,g,q in kept]
    result.append({'name':'其他 Other','g':sum(a[0] for a in values.values())-sum(r['g'] for r in result),'q':0})
    return result

def build(only=None):
    last=read(CACHE/'industry-meta.json')['last'];folder=CACHE/'leaders';folder.mkdir(exist_ok=True)
    for scope in read(CACHE/'scopes.json'):
        if only and scope not in only:continue
        monthly={}
        for f in sorted((CACHE/'scopes'/'brand').glob(scope+'.*.json.gz')):
            month=int(f.name.split('.')[1])
            if shift(last,-23)<=month<=last:
                d=read(f);monthly[month]=[[r[0],r[1],d['labels'][r[2]],r[3],r[4]] for r in d['rows']]
        if not monthly:continue
        output={}
        for mask in range(1,8):
            maps={};monthly_summaries=[]
            for month,rows in monthly.items():
                v={};add(v,rows,mask);maps[month]=v
                top=ranks(v,5);monthly_summaries.append({'month':month,'ranks':[{'name':n,'g':g,'q':q} for n,g,q in top]+[{'name':'其他 Other','g':sum(a[0] for a in v.values())-sum(r[1] for r in top),'q':0}]})
            for mode,start in [('mat',shift(last,-11)),('ytd',last//100*100+1),('month',last)]:
                cur={};prev={}
                for month,v in maps.items():
                    target=cur if start<=month<=last else prev if shift(start,-12)<=month<=shift(last,-12) else None
                    if target is not None:
                        for n,(g,q) in v.items():
                            a=target.setdefault(n,[0,0]);a[0]+=g;a[1]+=q
                cr=compact(cur)
                pm={}
                for month,rows in monthly.items():
                    if start<=month<=last:
                        for _,p,n,g,q in rows:
                            if mask&(1<<p):pm[(n,p)]=pm.get((n,p),0)+(g or 0)
                for r in cr:
                    r['platforms']=[{'p':p,'g':pm.get((r['name'],p))} for p in range(3) if mask&(1<<p)] if r['name']!='其他 Other' else []
                detail_monthly=[]
                names={r['name'] for r in cr[:10]}
                for month,v in maps.items():detail_monthly.append({'month':month,'ranks':compact(v,names,False)})
                result={'cur':cr,'prev':compact(prev,{r['name'] for r in cr}),'knownCount':sum(known(n) for n in cur),'monthly':detail_monthly,'byCategory':[],'byPlatform':[],'yearly':[],'yearSame':[]}
                output[str(mask)+'|'+mode]=result
        (folder/(scope+'.json.gz')).write_bytes(gzip.compress(json.dumps(output,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0))
        print('leaders',scope,flush=True)
if __name__=='__main__':build()
