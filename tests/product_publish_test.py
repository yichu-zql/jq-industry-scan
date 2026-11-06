import unittest,tempfile,pathlib,sys,subprocess
sys.path.insert(0,'scripts')
import publish_products as publish
class PublicationTreeTest(unittest.TestCase):
 def test_staged_roots_form_complete_final_tree(self):
  pathlib.Path('.cache').mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=pathlib.Path('.cache').resolve()) as temp:
   root=pathlib.Path(temp);folder=root/'files';folder.mkdir();(folder/'a').write_text('first');(folder/'b').write_text('second')
   subprocess.run(['git','init','-q',str(root)],check=True)
   previous=(publish.root,publish.folder);publish.root=root;publish.folder=folder
   try:
    one=publish.commit('stage-one','one',[],paths=[folder/'a']);two=publish.commit('stage-two','two',[],paths=[folder/'b'])
    objects={}
    for sha in [one,two]:
     for line in publish.git('ls-tree','-r',sha).splitlines():
      info,path=line.split('\t');objects[path]=info.split()[2]
    final=publish.commit('final','final',[one,two],objects=objects)
    self.assertEqual(publish.git('show',final+':a'),'first');self.assertEqual(publish.git('show',final+':b'),'second')
    self.assertEqual(len(publish.git('rev-list','--parents','-n','1',final).split()),3)
   finally:publish.root,publish.folder=previous
if __name__=='__main__':unittest.main()
