"""Validate local snapshots and publish only a consistent aggregate bundle."""
import argparse, collections, datetime, gzip, hashlib, json, pathlib, shutil, os, math
ROOT=pathlib.Path(__file__).resolve().parents[1]
CACHE=pathlib.Path(os.environ.get('JQ_CACHE_DIR',str(ROOT/'.cache')))
DATA=ROOT/'data'
def read(p):
    return json.loads(gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes())
def dump(p,data):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
def shift(m,n):
    k=m//100*12+(m%100-1)+n
    return k//12*100+k%12+1
def collected(path):
    return datetime.datetime.fromtimestamp(path.stat().st_mtime,datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M:%S')

def valid_amount(v):
    return v is None or (isinstance(v,(int,float)) and math.isfinite(v))
def build(preview=False):
    kinds=['brand','price','brandprice','shop']
    if not preview:
        for k in kinds+['mapping']:
            assert (CACHE/(k+'-meta.json' if k!='mapping' else 'mapping.json')).exists(),f'{k} extraction incomplete'
    if not preview:
        for kind in ['brand','price','brandprice']:
            marker=CACHE/'scopes'/(kind+'-complete.json')
            assert marker.exists() and read(marker)['source']==hashlib.sha256((CACHE/(kind+'-meta.json')).read_bytes()).hexdigest(),f'{kind} scope build incomplete or stale'
    ind=read(CACHE/'industry.json.gz');meta=read(CACHE/'industry-meta.json')
    assert meta['conflicts']==0
    seen=set();totals=collections.defaultdict(float);coverage=collections.defaultdict(set)
    last=meta['last'];start=shift(last,-11)
    for cid,m,p,g,q in ind['rows']:
        key=(cid,m,p);assert key not in seen,f'duplicate monthly key {key}';seen.add(key)
        assert valid_amount(g) and valid_amount(q),f'negative industry amount {key}'
        if start<=m<=last:
            totals[cid]+=g or 0;coverage[cid].add((m,p))
    files={};sources={'industry':{**meta,'collected':collected(CACHE/'industry-meta.json'),'table':'spider.jq_sale_industry_m','use':'行业规模、销量、增长档位'}}
    brand_categories=collections.defaultdict(list)
    checks={};sizes={};negative_counts={};missing_counts={};brand_matches=price_matches=compared=0
    DATA.mkdir(exist_ok=True)
    pack_map_path=CACHE/'packed-files.json'
    pack_map=read(pack_map_path) if pack_map_path.exists() else {}
    def copy(src,kind,rows=None):
        payload=src.read_bytes()
        source_key=kind+':'+hashlib.sha256(payload).hexdigest()+(':dict' if rows is not None and kind in ('brand','brandprice') else '')
        cached=pack_map.get(source_key)
        if cached and (DATA/cached).exists():return cached
        if rows is not None and kind in ('brand','brandprice'):
            labels=sorted({r[2] for r in rows});lookup={n:i for i,n in enumerate(labels)}
            compact=[[r[0],r[1],lookup[r[2]],*r[3:]] for r in rows]
            payload=gzip.compress(json.dumps({'labels':labels,'rows':compact},ensure_ascii=False,separators=(',',':')).encode(),compresslevel=6,mtime=0)
        digest=hashlib.sha256(payload).hexdigest()[:16]
        target=DATA/'files'/kind/(digest+'.json.gz');target.parent.mkdir(parents=True,exist_ok=True)
        if not target.exists(): target.write_bytes(payload)
        rel=target.relative_to(DATA).as_posix();pack_map[source_key]=rel
        if len(pack_map)%100==0:dump(pack_map_path,pack_map)
        return rel
    industry_path=copy(CACHE/'industry.json.gz','industry')
    for kind in kinds:
        files[kind]={};comparisons=[];size=0;negative_counts[kind]=0;missing_counts[kind]=0
        metadata=CACHE/(kind+'-meta.json')
        if not metadata.exists():
            if preview: continue
            raise RuntimeError(kind+' incomplete')
        km=read(metadata)
        sources[kind]={**km,'collected':collected(metadata),'table':{'brand':'spider.jq_sale_brand_m','price':'spider.jq_sale_item_m','brandprice':'spider.jq_sale_item_m','shop':'spider.jq_sale_shop_m'}[kind], 'use':{'brand':'品牌排名与CR5','price':'价格带','brandprice':'品牌价格结构','shop':'店铺表总量核验'}[kind]}
        for f in sorted((CACHE/kind).glob('*.json.gz')):
            cid=f.name.split('.')[0];rows=read(f)
            if kind=='brand':
                for name in {r[2] for r in rows}:brand_categories[name].append(cid)
            assert all(valid_amount(r[-2]) and valid_amount(r[-1]) for r in rows),f'{kind}/{cid} nonfinite amount'
            negative_counts[kind]+=sum(1 for r in rows if (r[-2] or 0)<0 or (r[-1] or 0)<0)
            missing_counts[kind]+=sum(1 for r in rows if r[-2] is None or r[-1] is None)
            if kind=='brandprice':
                expected_path=CACHE/'price'/(cid+'.json.gz')
                assert expected_path.exists(),f'brand-price category absent from price snapshot: {cid}'
                expected={tuple(r[:3]):r[-2:] for r in read(expected_path)}
                actual=collections.defaultdict(lambda:[0,0])
                for r in rows:
                    a=actual[(r[0],r[1],r[3])];a[0]+=r[-2] or 0;a[1]+=r[-1] or 0
                assert set(actual)==set(expected),f'price band monthly coverage mismatch: {cid}'
                for k,(g,q) in expected.items():
                    assert abs(actual[k][0]-(g or 0))<=max(1,abs(g or 0)*1e-9) and actual[k][1]==(q or 0),f'price band brand totals mismatch: {cid}/{k}'
            if kind!='shop':
                files[kind][cid]=copy(f,kind,rows);size+=f.stat().st_size
            g=sum((r[-2] or 0) for r in rows if start<=r[0]<=last)
            if len(coverage[cid])==36 and totals[cid]>0:
                diff=g/totals[cid]-1
                comparisons.append({'id':cid,'ratio':round(g/totals[cid],6),'passed':abs(diff)<=.01})
        sizes[kind]=size;checks[kind]=comparisons
    scopes=read(CACHE/'scopes.json') if (CACHE/'scopes.json').exists() else {}
    for kind in ['brand','price','brandprice']:
        for f in sorted((CACHE/'scopes'/kind).glob('*.json.gz')):
            parts=f.name.split('.')
            if parts[1].isdigit():files[kind].setdefault(parts[0],[]).append({'path':copy(f,kind),'month':int(parts[1])})
            else:files[kind][parts[0]]=copy(f,kind)
    brand_index=CACHE/'brand-index.json.gz'
    brand_index.write_bytes(gzip.compress(json.dumps(brand_categories,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
    brand_index_path=copy(brand_index,'brand-index')
    mapping=read(CACHE/'mapping.json') if (CACHE/'mapping.json').exists() else {'ambiguities':{}}
    sources['mapping']={'table':'spider.jq_plat_cate_map','use':'映射歧义审核，不关联放大事实表','loaded':mapping.get('loaded'),'collected':collected(CACHE/'mapping.json') if (CACHE/'mapping.json').exists() else None,'sourceRows':mapping.get('sourceRows')}
    audit={'industryConflicts':meta['conflicts'],'mappingAmbiguities':sum(mapping['ambiguities'].values()),'brandMatched':sum(r['passed'] for r in checks.get('brand',[])),'brandCompared':len(checks.get('brand',[])),'priceMatched':sum(r['passed'] for r in checks.get('price',[])),'priceCompared':len(checks.get('price',[])),'negativeRows':negative_counts,'missingAmountRows':missing_counts,'summary':'精确行业键无冲突；源数据负值保留并计数，不能解释为零；缺月保留缺失，份额按当前筛选动态对账。','checks':checks,'sizes':sizes}
    insights={}
    for f in sorted((CACHE/'insights').glob('*.json.gz')):
        insights[f.name.split('.')[0]]=copy(f,'insights')
    leaders={f.name.split('.')[0]:copy(f,'leaders') for f in sorted((CACHE/'leaders').glob('*.json.gz'))}
    price_leaders={f.name.split('.')[0]:copy(f,'price-leaders') for f in sorted((CACHE/'price-leaders').glob('*.json.gz'))}
    if not preview:assert price_leaders,'Price matrix summaries required before release'
    if not preview:assert leaders,'Common-period summaries required before release'
    if not preview:assert insights,'Overview insight bundles required before release'
    update_status=read(ROOT/'.private'/'schedule.json')['description'] if (ROOT/'.private'/'schedule.json').exists() else '手动更新流程已提供；自动调度尚未启用。'
    fingerprint=hashlib.sha256(json.dumps([industry_path,files,{k:{f:v for f,v in source.items() if f!='collected'} for k,source in sources.items()},insights,leaders,price_leaders,update_status],sort_keys=True).encode()).hexdigest()[:12]
    existing=DATA/'manifest.json'
    if existing.exists() and read(existing).get('fingerprint')==fingerprint and read(existing).get('preview') is False and not preview:
        print('UNCHANGED: aggregate fingerprint unchanged');return False
    now=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
    manifest={'version':'2.0.0-'+fingerprint,'fingerprint':fingerprint,'built':now.strftime('%Y-%m-%d %H:%M:%S'),'first':meta['first'],'last':last,'industry':industry_path,'files':files,'sources':sources,'insights':insights,'leaders':leaders,'priceLeaders':price_leaders,'scopes':scopes,'brandIndex':brand_index_path,'audit':{k:v for k,v in audit.items() if k not in ['checks','sizes']},'preview':preview,'updateStatus':update_status}
    dump(DATA/'audit.json',audit);dump(DATA/'manifest.json',manifest);dump(pack_map_path,pack_map)
    # Retain rollback in Git history; remove only unreferenced generated hash blobs.
    referenced={industry_path,brand_index_path,*insights.values(),*leaders.values(),*price_leaders.values()}
    for mapping_files in files.values():
        for entry in mapping_files.values():
            referenced.update(x['path'] for x in entry) if isinstance(entry,list) else referenced.add(entry)
    blob_root=(DATA/'files').resolve()
    for f in blob_root.rglob('*.json.gz'):
        assert f.resolve().is_relative_to(blob_root)
        if f.relative_to(DATA.resolve()).as_posix() not in referenced and len(f.name.split('.')[0])==16:
            f.unlink()
    print(json.dumps({'version':manifest['version'],'categories':len(ind['categories']),'bytes':sizes,'audit':manifest['audit']},ensure_ascii=False))
    return True
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--preview',action='store_true');args=p.parse_args();build(args.preview)
