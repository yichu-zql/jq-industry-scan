"""Exact YTD SKU leaders. A top ten of disjoint category/platform sets can be merged exactly."""
import heapq,json,gzip,hashlib
PLATS={'tmall':0,'jd':1,'douyin':2}
def rank(values):return heapq.nsmallest(10,values,key=lambda v:(-v['g'],v['category']+'|'+str(v['p'])+'|'+str(v['id'] or v['name'])))
def merge(points):
 return {'top':rank([v for p in points for v in p['top']]),'total':sum(p['total'] for p in points),'products':sum(p['products'] for p in points)}
def category_points(cid,parts,last):
 points={};acc=[{}, {}, {}];year=None
 def emit(m):
  plat=[{'top':[dict(v) for v in rank(list(a.values()))],'total':sum(v['g'] for v in a.values()),'products':len(a)} for a in acc]
  points[str(m)]={str(mask):merge([plat[p] for p in range(3) if mask&(1<<p)]) for mask in range(1,8)}
 previous=None
 for month,rows in parts:
  if previous is not None:
   stop=(previous//100)*100+(last%100 if previous//100==last//100 else 12)
   for m in range(previous+1,min(month,stop+1)):emit(m)
  if year!=month//100:acc=[{}, {}, {}];year=month//100
  for r in rows:
   p=PLATS.get(r[0],r[0] if isinstance(r[0],int) else None)
   if p is None or r[5] is None:continue
   name=r[2] or '未命名商品';item=r[1] or '';key=str(item or name)
   if key not in acc[p]:acc[p][key]={'id':item,'category':cid,'p':p,'name':name,'brand':r[3] or '未识别品牌','g':0,'q':0,'valid':True}
   v=acc[p][key];v['g']+=float(r[5]);v['q']+=r[6] or 0;v['valid']=v['valid'] and r[6] is not None;v['name']=name;v['brand']=r[3] or '未识别品牌'
  emit(month);previous=month
 if previous:
  stop=(previous//100)*100+(last%100 if previous//100==last//100 else 12)
  for month in range(previous+1,stop+1):emit(month)
 return points

def write_leader(folder,key,points):
 raw=json.dumps({'points':points},ensure_ascii=False,separators=(',',':')).encode();blob=gzip.compress(raw,mtime=0);rel='leaders/'+key+'.json.gz';p=folder/rel;p.parent.mkdir(exist_ok=True);p.write_bytes(blob)
 return {'path':rel,'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob)}
