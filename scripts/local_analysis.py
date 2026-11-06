"""Local-only SQL analysis service. Credentials supplied on stdin, never written."""
import sys,os,json,gzip,pathlib,hashlib,unicodedata,threading,urllib.parse,http.server,collections,concurrent.futures
sys.path.insert(0,os.environ.get('JQ_DEPENDENCIES',''))
import pymysql
ROOT=pathlib.Path(__file__).resolve().parents[1]
PREFIX='jq_custom_'
LOCK=threading.Lock()
def norm(s): return ''.join(unicodedata.normalize('NFKC',str(s or '')).lower().split())
def connection(cfg):
    cfg={**cfg,'database':'ulike_tmp'}
    return pymysql.connect(**cfg,charset='utf8mb4',connect_timeout=20,read_timeout=600,autocommit=False)
def initialize(cfg):
    with connection(cfg) as c:
        with c.cursor() as q:
            q.execute('''CREATE TABLE IF NOT EXISTS jq_custom_shards_v1 (category CHAR(16) NOT NULL, yr INT NOT NULL, digest CHAR(64) NOT NULL, records BIGINT NOT NULL, PRIMARY KEY(category,yr)) ENGINE=InnoDB''')
            q.execute('''CREATE TABLE IF NOT EXISTS jq_custom_sales_v1 (category CHAR(16) NOT NULL, yr INT NOT NULL, seq INT NOT NULL, month INT NOT NULL, platform TINYINT NOT NULL, item_id VARCHAR(255), name TEXT, name_norm TEXT COLLATE utf8mb4_bin, brand TEXT, asp DOUBLE NULL, gmv DOUBLE NULL, qty DOUBLE NULL, PRIMARY KEY(category,yr,seq), KEY query_scope(category,month,platform)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4''')
        c.commit()
def ensure(c,category,part):
    year=part['first']//100
    with c.cursor() as q:
        q.execute('SELECT digest FROM jq_custom_shards_v1 WHERE category=%s AND yr=%s',(category,year))
        found=q.fetchone()
        if found and found[0]==part['sha256']:return
        data=(ROOT/'.cache/product-public'/part['path']).read_bytes()
        if hashlib.sha256(data).hexdigest()!=part['sha256']:raise ValueError('商品快照校验失败')
        d=json.loads(gzip.decompress(data));rows=[]
        for n,r in enumerate(d['rows']):
            item,name,brand=d['items'][r[2]]
            rows.append((category,year,n,r[0],r[1],item,name,norm(name),brand,r[3],r[4],r[5]))
        q.execute('DELETE FROM jq_custom_sales_v1 WHERE category=%s AND yr=%s',(category,year))
        sql='INSERT INTO jq_custom_sales_v1 VALUES ('+','.join(['%s']*12)+')'
        for offset in range(0,len(rows),1000):q.executemany(sql,rows[offset:offset+1000])
        q.execute('REPLACE INTO jq_custom_shards_v1 VALUES (%s,%s,%s,%s)',(category,year,part['sha256'],len(rows)))
    c.commit()
def validated(f,index):
    ids=sorted(set(f['ids']));plats=sorted(set(f['plats']))
    if not ids or len(ids)>1400 or any(i not in index['files'] for i in ids):raise ValueError('类目范围没有完整商品数据')
    if not plats or any(type(p)!=int or p not in [0,1,2] for p in plats):raise ValueError('平台无效')
    start,end,cut=[f[k] for k in ['startYear','endYear','cutoff']]
    if not all(type(v)==int for v in [start,end,cut]) or not 2022<=start<=end<=index['last']//100 or not 1<=cut<=12:raise ValueError('时段无效')
    if end*100+cut>index['last']:raise ValueError('所选月份尚未入库')
    rule=f.get('rule') or {};mode=rule.get('mode','all')
    if mode not in ['all','any']:raise ValueError('匹配模式无效')
    inc,exc=rule.get('include',[]),rule.get('exclude',[])
    if any(not isinstance(v,list) or len(v)>30 for v in [inc,exc]) or any(not isinstance(t,str) or not norm(t) or len(t)>100 for t in inc+exc):raise ValueError('打标词无效')
    return ids,plats,(min(start-1,end-1)*100+1),end*100+cut,inc,exc,mode

def query(cfg,index,f):
    ids,plats,lo,hi,inc,exc,mode=validated(f,index)
    # Bound parallel imports; each shard commits atomically, completed shards are reused.
    with LOCK:
        tasks=[]
        unavailable=[]
        for cid in ids:
            parts=[p for p in index['files'][cid] if p['last']>=lo and p['first']<=hi]
            if not parts:unavailable.append(cid)
            tasks.extend((cid,p) for p in parts)
        if not tasks:raise ValueError('所选时段全部类目均无商品数据，请调整类目或年份')
        eligible=[(cid,p['first']//100) for cid,p in tasks]
        with connection(cfg) as db:
            with db.cursor() as q:
                q.execute('SELECT category,yr,digest FROM jq_custom_shards_v1 WHERE category IN ('+','.join(['%s']*len(ids))+')',ids)
                ready={(cid,yr):digest for cid,yr,digest in q.fetchall()}
        tasks=[(cid,p) for cid,p in tasks if ready.get((cid,p['first']//100))!=p['sha256']]
        def prepare(task):
            with connection(cfg) as db:ensure(db,*task)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(prepare,tasks))
    with connection(cfg) as c:
        base='category IN ('+','.join(['%s']*len(ids))+') AND month BETWEEN %s AND %s AND platform IN ('+','.join(['%s']*len(plats))+')'
        args=ids+[lo,hi]+plats
        base+=' AND (category,yr) IN ('+','.join(['(%s,%s)']*len(eligible))+')'
        args += [v for pair in eligible for v in pair]
        with c.cursor() as q:
            q.execute('SELECT category,month,platform,COUNT(*) FROM jq_custom_sales_v1 WHERE '+base+' GROUP BY category,month,platform',args)
            coverage=q.fetchall()
            clauses=[];terms=[]
            def term(t):return '%'+norm(t).replace('!','!!').replace('%','!%').replace('_','!_')+'%'
            if inc:
                clauses.append('(' + (' OR ' if mode=='any' else ' AND ').join(["name_norm LIKE %s ESCAPE '!' "]*len(inc))+')');terms.extend(map(term,inc))
            for t in exc:clauses.append("name_norm NOT LIKE %s ESCAPE '!'");terms.append(term(t))
            where=base+(' AND '+' AND '.join(clauses) if clauses else '')
            q.execute('SELECT category,month,platform,item_id,name,brand,asp,gmv,qty FROM jq_custom_sales_v1 WHERE '+where+' ORDER BY category,month,platform,seq',args+terms)
            rows=q.fetchall()
        c.commit()
    return {'rows':rows,'coverage':coverage,'sourceUpdated':index['sourceUpdated'],'version':hashlib.sha256(json.dumps(index,sort_keys=True).encode()).hexdigest(),'matchedRecords':len(rows),'unavailableCategories':unavailable}

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*args):pass
    def safe(self):return self.headers.get('Host') in ['127.0.0.1:8765','localhost:8765']
    def output(self,status,obj):
        b=json.dumps(obj,ensure_ascii=False,allow_nan=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_GET(self):
        if not self.safe():self.send_error(403);return
        path=urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path=='/api/health':self.output(200,{'mode':'local-sql','sourceUpdated':self.server.index['sourceUpdated']});return
        allowed=path in ['/','/index.html','/app.js','/styles.css'] or path.startswith(('/lib/','/data/'))
        target=(ROOT/path.lstrip('/')).resolve()
        if not allowed or not target.is_relative_to(ROOT) or target.relative_to(ROOT).parts[:1] in [('.private',),('.cache',),('.git',)] or any(p.startswith('.') for p in pathlib.PurePosixPath(path).parts):self.send_error(404);return
        super().do_GET()
    def do_POST(self):
        if not self.safe() or self.path!='/api/products' or self.headers.get('Origin') not in [None,'http://127.0.0.1:8765','http://localhost:8765'] or self.headers.get('Content-Type')!='application/json':self.send_error(403);return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=100000:raise ValueError('请求过大')
            f=json.loads(self.rfile.read(length));result=query(self.server.cfg,self.server.index,f)
            self.output(200,result)
        except ValueError as e:self.output(400,{'error':str(e)})
        except Exception:self.output(500,{'error':'本机数据库查询失败，请检查数据库连接或本地快照；未返回不完整结果'})

def main():
    cfg=json.loads(sys.stdin.readline());initialize(cfg)
    index=json.loads((ROOT/'.cache/product-public/index.json').read_text())
    server=http.server.ThreadingHTTPServer(('127.0.0.1',8765),Handler);server.cfg=cfg;server.index=index
    print('Local SQL dashboard: http://127.0.0.1:8765/#trends',flush=True)
    server.serve_forever()
if __name__=='__main__':main()
