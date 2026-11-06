"""Lossless annual SKU dictionaries; source monthly shards remain local build inputs."""
import pathlib,json,gzip,hashlib,collections,shutil,concurrent.futures
root=pathlib.Path(__file__).resolve().parents[1];source=root/'.cache/product-snapshot';out=root/'.cache/product-public'
def compact_category(task):
 cid,parts=task;groups=collections.defaultdict(list);result=[];count=size=0
 for p in parts:groups[p['month']//100].append(p)
 for year,group in sorted(groups.items()):
  group=sorted(group,key=lambda p:p['month']);signature=hashlib.sha256(json.dumps(group,sort_keys=True).encode()).hexdigest()
  rel=f'{cid}/{year}.json.gz';target=out/rel
  cached=None
  if target.exists():
   try:
    old=json.loads(gzip.decompress(target.read_bytes()))
    if old.get('source')==signature:cached=old
   except (OSError,ValueError,EOFError):pass
  if cached is None:
   items=[];lookup={};rows=[]
   for p in group:
    original=json.loads(gzip.decompress((source/p['path']).read_bytes()))
    for row in original:
     platform,item,name,brand,asp,g,q=row;platform={'tmall':0,'jd':1,'douyin':2}.get(platform,platform);key=(item,name,brand)
     if key not in lookup:lookup[key]=len(items);items.append(list(key))
     rows.append([p['month'],platform,lookup[key],asp,g,q])
   rows.sort(key=lambda r:(str(r[1]),r[2],r[0]))
   assert len(rows)==sum(p['rows'] for p in group)
   payload={'schema':3,'source':signature,'items':items,'rows':rows}
   blob=gzip.compress(json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode(),compresslevel=6,mtime=0)
   target.parent.mkdir(exist_ok=True);temporary=target.with_suffix('.tmp');temporary.write_bytes(blob);temporary.replace(target);row_count=len(rows)
  else:blob=target.read_bytes();row_count=len(cached['rows'])
  result.append({'first':group[0]['month'],'last':group[-1]['month'],'path':rel,'rows':row_count,'sha256':hashlib.sha256(blob).hexdigest()})
  count+=row_count;size+=len(blob)
 return cid,result,count,size

def main():
 out.mkdir(exist_ok=True);index=json.loads((source/'index.json').read_text(encoding='utf-8'));files={};count=size=0
 with concurrent.futures.ProcessPoolExecutor(max_workers=3) as pool:
  for n,(cid,parts,rows,byte_count) in enumerate(pool.map(compact_category,index['files'].items()),1):
   files[cid]=parts;count+=rows;size+=byte_count
   if n%100==0:print('Encoded',n,'categories',count,'rows',round(size/1048576,1),'MB',flush=True)
 assert count==index['rows']
 for v in index['leaders'].values():
  target=out/v['path'];target.parent.mkdir(exist_ok=True);shutil.copyfile(source/v['path'],target)
 index.update(schema=3,files=files,bytes=size)
 (out/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print('DONE lossless encoding',count,size,flush=True)
if __name__=='__main__':main()
