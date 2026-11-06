"""Pinned SKU assets in a separate branch; bounded pushes keep Pages below its size limit."""
import pathlib,json,subprocess,time,argparse,gzip
root=pathlib.Path(__file__).resolve().parents[1];folder=root/'.cache/product-snapshot';parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
def git(*x,**kw):return subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),*x],cwd=root,**kw).decode().strip()
index=json.loads((folder/'index.json').read_text(encoding='utf-8'));manifest=json.loads((root/'data/manifest.json').read_text(encoding='utf-8'))
assert index['last']==manifest['last'],'SKU cutoff must agree with dashboard'
assert index['sourceUpdated']==manifest['sources']['price']['loaded'],'Source changed; regenerate aggregate snapshot'
branch='codex/product-data'
try:parent=git('rev-parse','--verify','refs/heads/'+branch)
except subprocess.CalledProcessError:parent=None
files=sorted(folder/v['path'] for group in index['files'].values() for v in group)+sorted(folder/v['path'] for v in index.get('leaders',{}).values())+[folder/'index.json']
batches=[];batch=[];size=0
for p in files:
 n=p.stat().st_size;assert n<95*1024*1024
 if size+n>250*1024*1024 and batch:batches.append(batch);batch=[];size=0
 batch.append(p);size+=n
if batch:batches.append(batch)
for bn,batch in enumerate(batches):
 proc=subprocess.Popen(['git','-c','safe.directory='+root.as_posix(),'fast-import','--quiet','--done','--max-pack-size=300'],cwd=root,stdin=subprocess.PIPE)
 def write(s):proc.stdin.write(s.encode() if isinstance(s,str) else s)
 write('commit refs/heads/'+branch+'\ncommitter Dashboard Data <data@users.noreply.github.com> '+str(int(time.time()))+' +0000\n')
 msg=f'Publish immutable SKU snapshot batch {bn+1}/{len(batches)}';write('data '+str(len(msg))+'\n'+msg+'\n')
 if parent:write('from '+parent+'\n')
 if bn==0:write('deleteall\n')
 for p in batch:
  b=p.read_bytes();write('M 100644 inline '+p.relative_to(folder).as_posix()+'\ndata '+str(len(b))+'\n');write(b);write('\n')
 write('\ndone\n');proc.stdin.close();assert proc.wait()==0
 parent=git('rev-parse','refs/heads/'+branch)
 print('Assets batch',bn+1,len(batches),parent,flush=True)
 if args.publish:subprocess.run(['git','-c','safe.directory='+root.as_posix(),'push','origin',branch],cwd=root,check=True)
index['base']='https://raw.githubusercontent.com/yichu-zql/jq-industry-scan/'+parent+'/'
index['sourceVersion']=manifest['version'];index['assetCommit']=parent
manifest['products']={'catalog':'products.json.gz','assetCommit':parent,'sourceVersion':manifest['version'],'last':index['last']}
(root/'data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
(root/'data/products.json.gz').write_bytes(gzip.compress(json.dumps(index,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
print('SKU catalog ready',parent,len(files),index['bytes'],flush=True)
