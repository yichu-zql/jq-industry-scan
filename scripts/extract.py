"""Read-only Jiuqian extraction. Credentials arrive on stdin or environment, never in artifacts."""
import argparse, collections, datetime, gzip, hashlib, json, os, pathlib, sys, time, unicodedata, zlib
try:
    import pymysql
except ImportError:
    sys.path.insert(0, str(pathlib.Path(os.environ.get('JQ_DEPENDENCIES', ''))))
    import pymysql

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path(os.environ.get('JQ_CACHE_DIR', str(ROOT / '.cache')))
DATA = ROOT / 'data'
PLATS = {'tmall': 0, 'jd': 1, 'douyin': 2}
CAT = 'jq_cate1,jq_cate2,jq_cate3'
KEY = 'y_m,plat,' + CAT + ',cate1,cate2,cate3,cate4'
KEY_GROUP = 'y_m,' + ','.join('BINARY '+s for s in KEY.split(',')[1:])

def cid(parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()[:16]

def put(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()
    if path.suffix == '.gz':
        path.write_bytes(gzip.compress(raw, compresslevel=6, mtime=0))
    else:
        path.write_bytes(raw)

def connect(config):
    c = pymysql.connect(**config, charset='utf8mb4', connect_timeout=20, read_timeout=1800,
                        cursorclass=pymysql.cursors.SSCursor)
    with c.cursor() as q:
        q.execute('SET SESSION TRANSACTION READ ONLY')
        q.execute('SET SESSION MAX_EXECUTION_TIME=1500000')
        q.execute('SET SESSION net_write_timeout=300')
    return c

def query(c, sql):
    with c.cursor() as q:
        q.execute(sql)
        while True:
            rows = q.fetchmany(100)
            if not rows:
                break
            yield from rows

def scalar(c, sql):
    return list(query(c, sql))

def industry(c):
    # Preserve rows with different platform-category paths. Collapse only identical business keys.
    conflicts = scalar(c, 'SELECT COUNT(*) FROM (SELECT '+KEY+',COUNT(DISTINCT gmv) ng,COUNT(DISTINCT sales_num) nq FROM jq_sale_industry_m GROUP BY '+KEY_GROUP+' HAVING ng>1 OR nq>1) x')[0][0]
    if conflicts:
        raise RuntimeError(f'{conflicts} conflicting industry keys: manual review required')
    sql = 'SELECT '+CAT+',y_m,plat,SUM(gmv),SUM(sales_num),SUM(n),SUM(valid_g),SUM(valid_q) FROM (SELECT '+KEY+',MAX(gmv) gmv,MAX(sales_num) sales_num,COUNT(*) n,MAX(gmv IS NOT NULL) valid_g,MAX(sales_num IS NOT NULL) valid_q FROM jq_sale_industry_m GROUP BY '+KEY_GROUP+') t GROUP BY '+CAT+',y_m,plat'
    cats, rows = {}, []
    for r in query(c, sql):
        path = list(r[:3]); k = cid(path)
        if r[4] not in PLATS or not all(path):
            continue
        cats[k] = {'id': k, 'path': path}
        rows.append([k, int(r[3]), PLATS[r[4]], round(float(r[5]), 4) if r[5] is not None else None,
                     int(r[6]) if r[6] is not None else None])
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    result = {'categories': sorted(cats.values(), key=lambda c: c['path']), 'rows': rows}
    put(CACHE/'industry.json.gz', result)
    meta = scalar(c, 'SELECT MIN(y_m),MAX(y_m),MAX(insert_time),COUNT(*) FROM jq_sale_industry_m')[0]
    put(CACHE/'industry-meta.json', {'first': meta[0], 'last': meta[1], 'loaded': str(meta[2]), 'sourceRows': meta[3], 'conflicts': conflicts})
    print('industry', len(cats), 'categories', len(rows), 'monthly rows', flush=True)

def grouped(c, kind):
    # SQL groups in category order so memory stays bounded to one category.
    band = 'CASE WHEN asp IS NULL OR asp<=0 THEN -1 WHEN asp<50 THEN 0 WHEN asp<100 THEN 1 WHEN asp<200 THEN 2 WHEN asp<400 THEN 3 WHEN asp<600 THEN 4 WHEN asp<1000 THEN 5 WHEN asp<2000 THEN 6 WHEN asp<5000 THEN 7 ELSE 8 END'
    if kind == 'brand':
        table = 'jq_sale_brand_m'; extra = 'brand_name'; dims = extra
    elif kind == 'price':
        table = 'jq_sale_item_m'; extra = band+' band'; dims = 'band'
    elif kind == 'brandprice':
        table = 'jq_sale_item_m'; extra = 'brand_name,'+band+' band'; dims = 'brand_name,band'
    elif kind == 'shop':
        table = 'jq_sale_shop_m'; extra = 'COUNT(*)'; dims = ''
    catalog=json.loads(gzip.decompress((CACHE/'industry.json.gz').read_bytes()))['categories']
    roots=sorted({x['path'][0] for x in catalog})
    if kind in ('price','shop'):roots=['__ALL__']
    checkpoint=CACHE/(kind+'-roots.json')
    done=json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else []
    count,nfiles=0,0
    for root in roots:
        if root in done:
            print(kind,'cached',root,flush=True);continue
        print(kind, 'query', root, flush=True)
        if kind=='shop':extra='COUNT(*) n';jsoncols='n'
        else:jsoncols={'brand':'brand_name','price':'band','brandprice':'brand_name,band'}[kind]
        where='' if root=='__ALL__' else ' WHERE jq_cate1='+c.escape(root)
        inner='SELECT '+CAT+',y_m,plat,'+extra+',SUM(gmv) gmv_sum,SUM(sales_num) sales_sum FROM '+table+where+' GROUP BY '+CAT+',y_m,plat'+(','+dims if dims else '')
        sql='SELECT '+CAT+',y_m,COMPRESS(JSON_ARRAYAGG(JSON_ARRAY(y_m,plat,'+jsoncols+',gmv_sum,sales_sum))) FROM ('+inner+') x GROUP BY '+CAT+',y_m ORDER BY '+CAT+',y_m'
        current=None;category_rows=[]
        for r in query(c,sql):
            if not all(r[:3]):continue
            k=cid(list(r[:3]));raw=json.loads(zlib.decompress(r[4][4:]));part=[]
            if current is not None and current!=k:
                put(CACHE/kind/(current+'.json.gz'),category_rows);count+=len(category_rows);nfiles+=1;category_rows=[]
            current=k
            for row in raw:
                if row[1] not in PLATS:continue
                row[1]=PLATS[row[1]]
                if kind in ('brand','brandprice'):
                    row[2]=unicodedata.normalize('NFKC',row[2] or '未识别品牌').strip().casefold()
                row[-2]=round(float(row[-2]),4) if row[-2] is not None else None
                part.append(row)
            part.sort(key=lambda x:(x[0],x[1],str(x[2:-2])))
            category_rows.extend(part)
        if current is not None:
            put(CACHE/kind/(current+'.json.gz'),category_rows);count+=len(category_rows);nfiles+=1
        done.append(root);put(checkpoint,done)
        print(kind,'finished',root,nfiles,'categories',count,'rows',flush=True)
    allfiles=list((CACHE/kind).glob('*.json.gz'))
    nfiles=len(allfiles)
    count=sum(len(json.loads(gzip.decompress(f.read_bytes()))) for f in allfiles)
    meta = scalar(c, 'SELECT MIN(y_m),MAX(y_m),MAX(insert_time) FROM '+table)[0]
    put(CACHE/(kind+'-meta.json'), {'first': meta[0], 'last': meta[1], 'loaded': str(meta[2]), 'rows': count, 'categories': nfiles})
    print(kind, 'DONE', nfiles, count, flush=True)

def mapping(c):
    rows = scalar(c, 'SELECT platform,COUNT(*) FROM (SELECT platform,cate1,cate2,cate3,cate4 FROM jq_plat_cate_map GROUP BY platform,cate1,cate2,cate3,cate4 HAVING COUNT(DISTINCT jq_cate1,jq_cate2,jq_cate3)>1) a GROUP BY platform')
    meta=scalar(c,'SELECT MAX(insert_time),COUNT(*) FROM jq_plat_cate_map')[0]
    put(CACHE/'mapping.json', {'loaded':str(meta[0]),'sourceRows':meta[1],'ambiguities': dict(rows), 'policy': 'Use jq_cate1/2/3 already present on fact tables; never multiply facts through mapping joins.'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('kind', choices=['industry','brand','price','brandprice','shop','mapping'])
    args = parser.parse_args()
    config = json.load(sys.stdin)
    CACHE.mkdir(parents=True,exist_ok=True)
    c = connect(config)
    try:
        if args.kind == 'industry': industry(c)
        elif args.kind == 'mapping': mapping(c)
        else: grouped(c, args.kind)
    finally:
        c.close()
