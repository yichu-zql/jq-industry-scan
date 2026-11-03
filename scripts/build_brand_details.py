"""Brand-oriented aggregates for common brand drilldowns; no raw item data."""
import collections, gzip, hashlib, json
from package_data import CACHE, read, dump

def build():
    names=set()
    for f in (CACHE/'leaders').glob('*.json.gz'):
        for d in read(f).values():
            names.update(r['name'] for r in d['cur'] if r['name']!='其他 Other')
    index={}
    for kind in ['brand','brandprice']:
        grouped=collections.defaultdict(list)
        for i,f in enumerate(sorted((CACHE/kind).glob('*.json.gz'))):
            cid=f.name.split('.')[0]
            d=read(f)
            rows=d if isinstance(d,list) else [[r[0],r[1],d['labels'][r[2]],*r[3:]] for r in d['rows']]
            totals=collections.defaultdict(float)
            if kind=='brand':
                for r in rows:totals[(r[0],r[1])]+=r[3] or 0
            for r in rows:
                if r[2] in names:
                    grouped[r[2]].append([*r,cid,*([totals[(r[0],r[1])]] if kind=='brand' else [])])
            if i%250==0:print(kind,i,flush=True)
        index[kind]={}
        folder=CACHE/'brand-details'/kind
        folder.mkdir(parents=True,exist_ok=True)
        for name,rows in grouped.items():
            key=hashlib.sha256(name.encode()).hexdigest()[:20]+'.json.gz'
            (folder/key).write_bytes(gzip.compress(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0))
            index[kind][name]=key
        print(kind,len(grouped),'brands',flush=True)
    dump(CACHE/'brand-details-index.json',index)

if __name__=='__main__':build()
