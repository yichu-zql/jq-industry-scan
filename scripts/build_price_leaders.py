"""Small exact price/brand matrices for common scopes, periods and platform masks."""
import collections,gzip,heapq,json
from package_data import CACHE,read,shift
from build_insights import known

def summarize_scope(rows,scope,last):
    maps={(mode,p):{} for mode in ['mat','ytd','month'] for p in range(3)}
    for m,p,n,b,g,q in rows:
        if m<shift(last,-11) or m>last:continue
        modes=['mat']+(['ytd'] if m//100==last//100 else [])+(['month'] if m==last else [])
        for mode in modes:
            a=maps[(mode,p)].setdefault(n,{})
            pair=a.setdefault(b,[0,0]);pair[0]+=g or 0;pair[1]+=q or 0
    output={}
    leader_path=CACHE/'leaders'/(scope+'.json.gz')
    brand_leaders=read(leader_path) if leader_path.exists() else {}
    for mode in ['mat','ytd','month']:
        for mask in range(1,8):
            merged={};bins=collections.defaultdict(lambda:[0,0])
            for p in range(3):
                if not mask&(1<<p):continue
                for n,bandmap in maps[(mode,p)].items():
                    a=merged.setdefault(n,{})
                    for b,(g,q) in bandmap.items():
                        pair=a.setdefault(b,[0,0]);pair[0]+=g;pair[1]+=q;bins[b][0]+=g;bins[b][1]+=q
            prepared=[(n,bandmap,sum(v[0] for v in bandmap.values()),sum(v[1] for v in bandmap.values())) for n,bandmap in merged.items() if known(n)]
            for band in [None,*range(9),-1]:
                selected=heapq.nlargest(20,prepared,key=lambda r:r[2]) if band is None else heapq.nlargest(20,(r for r in prepared if band in r[1]),key=lambda r:r[1][band][0])
                top=[{'name':n,'g':g if band is None else bm[band][0],'q':q if band is None else bm[band][1],'bands':{b:v[0] for b,v in bm.items() if band is None or b==band},'bandQty':{b:v[1] for b,v in bm.items() if band is None or b==band}} for n,bm,g,q in selected]
                main_bands={}
                if band is None:
                    for leader in brand_leaders.get(str(mask)+'|'+mode,{}).get('cur',[]):
                        bm=merged.get(leader['name'])
                        if bm:main_bands[leader['name']]=max(bm,key=lambda b:bm[b][0])
                result={'mainBands':main_bands,'bandLeaders':{b:[{'name':r[0],'bands':{b:r[1][b][0]}} for r in heapq.nlargest(2,(r for r in prepared if b in r[1]),key=lambda r:r[1][b][0])] for b in bins},'top':top,'bins':[{'name':b,'g':g,'q':q} for b,(g,q) in bins.items() if band is None or band==b]}
                output[str(mask)+'|'+mode+'|'+('all' if band is None else str(band))]=result
    folder=CACHE/'price-leaders';folder.mkdir(exist_ok=True)
    (folder/(scope+'.json.gz')).write_bytes(gzip.compress(json.dumps(output,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0))
    print('price leaders',scope,flush=True)

def global_scope(last):
    def rows():
        for f in sorted((CACHE/'scopes'/'brandprice').glob('scope_all.*.json.gz')):
            if not shift(last,-11)<=int(f.name.split('.')[1])<=last:continue
            d=read(f)
            for r in d['rows']:yield [r[0],r[1],d['labels'][r[2]],*r[3:]]
    summarize_scope(rows(),'scope_all',last)

def rebuild():
    scopes=read(CACHE/'scopes.json');last=read(CACHE/'industry-meta.json')['last']
    for scope,meta in scopes.items():
        if scope=='scope_all':global_scope(last);continue
        def rows():
            for cid in meta['ids']:
                f=CACHE/'brandprice'/(cid+'.json.gz')
                if f.exists():yield from read(f)
        summarize_scope(rows(),scope,last)
if __name__=='__main__':rebuild()
