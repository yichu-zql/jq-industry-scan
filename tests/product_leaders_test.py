import unittest,sys
sys.path.insert(0,'scripts')
from product_leaders import category_points,merge
class ProductLeadersTest(unittest.TestCase):
 def test_prior_period_is_immutable(self):
  p=category_points('a',[(202401,[['tmall','1','A','B',100,100,1]]),(202402,[['tmall','1','A','B',100,50,1],['jd','2','C','D',100,200,2]])],202402)
  self.assertEqual(p['202401']['1']['top'][0]['g'],100)
  self.assertEqual(p['202402']['3']['total'],350)
  self.assertEqual(p['202402']['3']['top'][0]['id'],'2')
  self.assertEqual(merge([p['202402']['1'],p['202402']['2']]),p['202402']['3'])
 def test_top10_denominator_includes_all_products(self):
  p=category_points('a',[(202401,[['tmall',str(i),'SKU'+str(i),'B',100,100-i,1] for i in range(20)])],202401)['202401']['1']
  self.assertEqual(len(p['top']),10);self.assertEqual(p['products'],20)
  self.assertGreater(p['total'],sum(v['g'] for v in p['top']))
if __name__=='__main__':unittest.main()
