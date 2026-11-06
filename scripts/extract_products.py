"""Read-only offline SKU snapshots. Year batches avoid repeated scans on an unindexed source."""
import sys,json,pathlib,zlib,hashlib,datetime,collections,struct,concurrent.futures,threading
from extract import connect,scalar,cid
root=pathlib.Path(__file__).resolve().parents[1];out=root/'.cache/product-snapshot';out.mkdir(parents=True,exist_ok=True)
config=json.load(sys.stdin)
c=connect(config)
try:
 monthly=scalar(c,'SELECT y_m,MAX(insert_time),COUNT(*) FROM jq_sale_item_m GROUP BY y_m')
 meta=(min(r[0] for r in monthly),max(r[0] for r in monthly),max(r[1] for r in monthly),sum(r[2] for r in monthly))
finally:c.close()
print('Source rows',meta[3],flush=True)
checkpoint=out/'progress.json'
progress=json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {}
signatures={str(r[0]):[str(r[1]),r[2]] for r in monthly}
if progress.get('sourceUpdated')!=str(meta[2]) or progress.get('sourceRows')!=meta[3]:
 progress['months']={m:v for m,v in progress.get('months',{}).items() if progress.get('monthSignatures',{}).get(m)==signatures.get(m)}
progress.update(sourceUpdated=str(meta[2]),sourceRows=meta[3],monthSignatures=signatures)
progress.setdefault('months',{})
months=[y*100+m for y in range(meta[0]//100,meta[1]//100+1) for m in range(1,13) if meta[0]<=y*100+m<=meta[1]]
lock=threading.Lock()
def complete(month,parts):
 with lock:
  progress['months'][str(month)]=parts
  temp=checkpoint.with_suffix('.tmp');temp.write_text(json.dumps(progress,ensure_ascii=False,separators=(',',':')),encoding='utf-8');temp.replace(checkpoint)
  print('Month',month,'rows',sum(p['rows'] for p in parts),'completed',len(progress['months']),len(months),flush=True)
def extract_batch(batch):
 connection=connect(config)
 try:
  with connection.cursor() as cursor:
   cursor.execute('SET SESSION MAX_EXECUTION_TIME=3600000')
   cursor.execute(f'''SELECT y_m,jq_cate1,jq_cate2,jq_cate3,COMPRESS(JSON_ARRAYAGG(JSON_ARRAY(plat,CAST(item_id AS CHAR),item_name,brand_name,asp,gmv,sales_num))),COUNT(*) FROM jq_sale_item_m WHERE y_m IN ({','.join(map(str,batch))}) AND jq_cate1 IS NOT NULL AND jq_cate2 IS NOT NULL AND jq_cate3 IS NOT NULL GROUP BY y_m,jq_cate1,jq_cate2,jq_cate3 ORDER BY y_m,jq_cate1,jq_cate2,jq_cate3''')
   current=None;parts=[];seen=set()
   for row in cursor:
    month=row[0]
    if current is not None and current!=month:complete(current,parts);seen.add(current);parts=[]
    current=month;key=cid(list(row[1:4]));compressed=row[4][4:];decoder=zlib.decompressobj();raw=decoder.decompress(compressed)+decoder.flush()
    if decoder.unused_data:compressed=compressed[:-len(decoder.unused_data)]
    assert len(raw)==struct.unpack('<I',row[4][:4])[0]
    blob=b'\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\xff'+compressed[2:-4]+struct.pack('<II',zlib.crc32(raw),len(raw)&0xffffffff)
    rel=f'{key}/{month}.json.gz';target=out/rel;target.parent.mkdir(exist_ok=True);target.write_bytes(blob)
    parts.append({'id':key,'month':month,'path':rel,'rows':row[5],'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob)})
   if current is not None:complete(current,parts);seen.add(current)
   for month in batch:
    if month not in seen:complete(month,[])
 finally:connection.close()
pending=[m for m in months if str(m) not in progress['months']]
batches=[[m for m in pending if m//100==year] for year in sorted({m//100 for m in pending})]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 for future in concurrent.futures.as_completed([pool.submit(extract_batch,b) for b in batches]):future.result()
files=collections.defaultdict(list);count=size=0
for month in months:
 for v in progress['months'][str(month)]:
  v=dict(v);key=v.pop('id');size+=v.pop('bytes');count+=v['rows'];files[key].append(v)
info={'schema':2,'first':meta[0],'last':meta[1],'sourceUpdated':str(meta[2]),'sourceRows':meta[3],'rows':count,'bytes':size,'collected':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':dict(files)}
(out/'index.json').write_text(json.dumps(info,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print('DONE',count,size,flush=True)
