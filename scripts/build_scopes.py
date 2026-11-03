"""Exact global and first-level rollups, compact brand dictionaries, reusable by every filter."""
import collections,gzip,json,pathlib,hashlib,sqlite3,argparse
from package_data import CACHE,read,dump
def scope_id(path):return 'scope_'+hashlib.sha256(json.dumps(path,ensure_ascii=False).encode()).hexdigest()[:12]
def merge(dest,rows):
    for r in rows:
        key=tuple(r[:-2]);v=dest.get(key)
        if v is None:dest[key]=[r[-2] or 0,r[-1] or 0]
        else:v[0]+=r[-2] or 0;v[1]+=r[-1] or 0
def write(dest,kind,key,values):
    rows=[[*k,round(v[0],4),v[1]] for k,v in values.items()]
    rows.sort(key=lambda r:(r[0],r[1],str(r[2:-2])))
    folder=dest/kind;folder.mkdir(parents=True,exist_ok=True)
    if kind in ('brand','brandprice'):
        monthly=collections.defaultdict(list)
        for r in rows:monthly[r[0]].append(r)
        for month,part in monthly.items():
            labels=sorted({r[2] for r in part});lookup={n:i for i,n in enumerate(labels)}
            compact=[[r[0],r[1],lookup[r[2]],*r[3:]] for r in part]
            (folder/(key+'.'+str(month)+'.json.gz')).write_bytes(gzip.compress(json.dumps({'labels':labels,'rows':compact},ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0))
    else:
        (folder/(key+'.json.gz')).write_bytes(gzip.compress(json.dumps(rows,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    print('scope',kind,key,len(rows),'rows',flush=True)
def build(kinds=None):
    cats=read(CACHE/'industry.json.gz')['categories'];roots=sorted({c['path'][0] for c in cats});scope={}
    for root in roots:scope[scope_id([root])]={'name':root,'ids':[c['id'] for c in cats if c['path'][0]==root]}
    scope['scope_all']={'name':'全部类目','ids':[c['id'] for c in cats]}
    dest=CACHE/'scopes'
    for kind in (kinds or ['price','brand','brandprice']):
        db=sqlite3.connect(CACHE/('scope-'+kind+'.sqlite'))
        db.execute('PRAGMA journal_mode=OFF');db.execute('PRAGMA synchronous=OFF');db.execute('PRAGMA cache_size=-32768')
        db.execute('DROP TABLE IF EXISTS rollups')
        db.execute('CREATE TABLE rollups (k TEXT PRIMARY KEY,m INTEGER,g REAL,q REAL) WITHOUT ROWID')
        for root in roots:
            values={};k=scope_id([root])
            for cid in scope[k]['ids']:
                f=CACHE/kind/(cid+'.json.gz')
                if not f.exists():continue
                rows=read(f);merge(values,rows)
            if kind!='brandprice':write(dest,kind,k,values)
            else:
                from build_price_leaders import summarize_scope
                summarize_scope(([*key,*v] for key,v in values.items()),k,read(CACHE/'industry-meta.json')['last'])
            db.executemany('INSERT INTO rollups(k,m,g,q) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET g=g+excluded.g,q=q+excluded.q',((json.dumps(key,ensure_ascii=False,separators=(',',':')),key[0],v[0],v[1]) for key in sorted(values) for v in [values[key]]))
            db.commit()
        db.execute('CREATE INDEX by_month ON rollups(m)')
        if kind=='price':
            values={tuple(json.loads(k)):[g,q] for k,g,q in db.execute('SELECT k,g,q FROM rollups')}
            write(dest,kind,'scope_all',values)
        else:
            for (month,) in db.execute('SELECT DISTINCT m FROM rollups ORDER BY m').fetchall():
                values={tuple(json.loads(k)):[g,q] for k,g,q in db.execute('SELECT k,g,q FROM rollups WHERE m=?',(month,))}
                write(dest,kind,'scope_all',values)
        db.close()
        if kind=='brandprice':
            from build_price_leaders import global_scope
            global_scope(read(CACHE/'industry-meta.json')['last'])
        dump(dest/(kind+'-complete.json'),{'source':hashlib.sha256((CACHE/(kind+'-meta.json')).read_bytes()).hexdigest()})
    dump(CACHE/'scopes.json',scope)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--kind',choices=['brand','price','brandprice']);a=p.parse_args();build([a.kind] if a.kind else None)
