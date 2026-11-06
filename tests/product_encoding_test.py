import unittest,tempfile,pathlib,sys,json,gzip,hashlib
sys.path.insert(0,'scripts')
import compact_products as compact
class ProductEncodingTest(unittest.TestCase):
 def test_roundtrip_and_reuse(self):
  pathlib.Path('.cache').mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=pathlib.Path('.cache').resolve()) as temp:
   base=pathlib.Path(temp);source=base/'source';out=base/'out';source.mkdir();out.mkdir();previous=(compact.source,compact.out);compact.source=source;compact.out=out
   try:
    parts=[];expected=[]
    for month,rows in [(202501,[['tmall','1','精华','A',100.1234,200.55555,2],['jd',None,None,None,None,0,None]]),(202502,[['tmall','1','精华','A',120,300,3]])]:
     raw=gzip.compress(json.dumps(rows,ensure_ascii=False).encode());path=str(month)+'.gz';(source/path).write_bytes(raw);parts.append({'month':month,'rows':len(rows),'path':path,'sha256':hashlib.sha256(raw).hexdigest()})
     expected.extend([[month,{'tmall':0,'jd':1}[r[0]],*r[1:]] for r in rows])
    first=compact.compact_category(('a',parts));p=out/first[1][0]['path'];before=p.stat().st_mtime_ns;d=json.loads(gzip.decompress(p.read_bytes()));actual=[[r[0],r[1],*d['items'][r[2]],*r[3:]] for r in d['rows']]
    self.assertEqual(sorted(map(json.dumps,actual)),sorted(map(json.dumps,expected)));self.assertEqual(len(d['items']),2)
    self.assertEqual(compact.compact_category(('a',parts)),first);self.assertEqual(p.stat().st_mtime_ns,before)
   finally:compact.source,compact.out=previous
if __name__=='__main__':unittest.main()
