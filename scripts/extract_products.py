"""Read-only resumable monthly SKU snapshots, with no credentials in published files."""
import sys,json,pathlib,zlib,hashlib,datetime,collections,struct,concurrent.futures,time
from extract import connect,scalar,cid
root=pathlib.Path(__file__).resolve().parents[1];out=root/'.cache/product-snapshot';out.mkdir(parents=True,exist_ok=True)
config=json.load(sys.stdin);c=connect(config)
try:
 meta=scalar(c,'SELECT MIN(y_m),MAX(y_m),MAX(insert_time),COUNT(*) FROM jq_sale_item_m')[0]
 print('Source rows',meta[3],flush=True)
 checkpoint=out/'progress.json'
 progress=json.loads(checkpoint.read_text(encoding='utf-8')) if checkpoint.exists() else {}
 if progress.get('sourceUpdated')!=str(meta[2]) or progress.get('sourceRows')!=meta[3]:progress={'sourceUpdated':str(meta[2]),'sourceRows':meta[3],'months':{}}
 months=[y*100+m for y in range(meta[0]//100,meta[1]//100+1) for m in range(1,13) if meta[0]<=y*100+m<=meta[1]]
 # Three bounded read-only connections; only completed months become checkpoints.
 def extract_month(month):
  connection=connect(config)
  try:
    sql=f'''SELECT jq_cate1,jq_cate2,jq_cate3,COMPRESS(JSON_ARRAYAGG(JSON_ARRAY(plat,CAST(item_id AS CHAR),item_name,brand_name,asp,gmv,sales_num))),COUNT(*) FROM jq_sale_item_m WHERE y_m={month} AND jq_cate1 IS NOT NULL AND jq_cate2 IS NOT NULL AND jq_cate3 IS NOT NULL GROUP BY jq_cate1,jq_cate2,jq_cate3'''
    parts=[]
    with connection.cursor() as cursor:
     cursor.execute(sql)
     for row in cursor:
      key=cid(list(row[:3]));compressed=row[3][4:];decoder=zlib.decompressobj();raw=decoder.decompress(compressed)+decoder.flush()
      if decoder.unused_data:compressed=compressed[:-len(decoder.unused_data)]
      assert len(raw)==struct.unpack('<I',row[3][:4])[0]
      blob=b'\x1f\x8b\x08\x00\x00\x00\x00\x00\x00\xff'+compressed[2:-4]+struct.pack('<II',zlib.crc32(raw),len(raw)&0xffffffff)
      rel=f'{key}/{month}.json.gz';target=out/rel;target.parent.mkdir(exist_ok=True);target.write_bytes(blob)
      parts.append({'id':key,'month':month,'path':rel,'rows':row[4],'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob)})
    return parts
  finally:connection.close()
 pending=[m for m in months if str(m) not in progress['months']]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  futures={pool.submit(extract_month,m):m for m in pending}
  for future in concurrent.futures.as_completed(futures):
   month=futures[future];parts=future.result();progress['months'][str(month)]=parts
   temp=checkpoint.with_suffix('.tmp');temp.write_text(json.dumps(progress,ensure_ascii=False,separators=(',',':')),encoding='utf-8');temp.replace(checkpoint)
   print('Month',month,'rows',sum(p['rows'] for p in parts),'completed',len(progress['months']),len(months),flush=True)
 files=collections.defaultdict(list);count=size=0
 for month in months:
  for v in progress['months'][str(month)]:
   v=dict(v);key=v.pop('id');size+=v.pop('bytes');count+=v['rows'];files[key].append(v)
 info={'schema':2,'first':meta[0],'last':meta[1],'sourceUpdated':str(meta[2]),'sourceRows':meta[3],'rows':count,'bytes':size,'collected':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':dict(files)}
 (out/'index.json').write_text(json.dumps(info,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print('DONE',count,size,flush=True)
finally:c.close()
