"""Publish compact immutable assets with bounded parallel pushes. No credentials in artifacts."""
import pathlib,json,subprocess,time,argparse,gzip,hashlib,concurrent.futures
root=pathlib.Path(__file__).resolve().parents[1];folder=root/'.cache/product-public'
def git(*args):return subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),*args],cwd=root,stderr=subprocess.DEVNULL).decode().strip()
def revision(ref):
 try:return git('rev-parse','--verify',ref)
 except subprocess.CalledProcessError:return None
def push(branch):
 subprocess.run(['git','-c','safe.directory='+root.as_posix(),'push','--progress','origin',branch],cwd=root,check=True)
 return branch
def commit(branch,message,parents,paths=None,objects=None):
 proc=subprocess.Popen(['git','-c','safe.directory='+root.as_posix(),'fast-import','--quiet','--done','--max-pack-size=100m'],cwd=root,stdin=subprocess.PIPE)
 def write(s):proc.stdin.write(s.encode() if isinstance(s,str) else s)
 write('commit refs/heads/'+branch+'\ncommitter Dashboard Data <data@users.noreply.github.com> '+str(int(time.time()))+' +0000\ndata '+str(len(message.encode()))+'\n'+message+'\n')
 for n,parent in enumerate(parents):write(('from ' if n==0 else 'merge ')+parent+'\n')
 write('deleteall\n')
 if objects:
  for path,oid in sorted(objects.items()):write('M 100644 '+oid+' '+path+'\n')
 else:
  for path in paths:
   b=path.read_bytes();write('M 100644 inline '+path.relative_to(folder).as_posix()+'\ndata '+str(len(b))+'\n');write(b);write('\n')
 write('\ndone\n');proc.stdin.close();assert proc.wait()==0
 return git('rev-parse','refs/heads/'+branch)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
 raw=(folder/'index.json').read_bytes();index=json.loads(raw);manifest=json.loads((root/'data/manifest.json').read_text(encoding='utf-8'))
 assert index['last']==manifest['last'];assert index['sourceUpdated']==manifest['sources']['price']['loaded'];assert index['schema']==3
 files=sorted(folder/v['path'] for group in index['files'].values() for v in group)+sorted(folder/v['path'] for v in index['leaders'].values())+[folder/'index.json']
 batches=[];batch=[];size=0
 for p in files:
  n=p.stat().st_size;assert n<95*1024*1024
  if size+n>64*1024*1024 and batch:batches.append(batch);batch=[];size=0
  batch.append(p);size+=n
 if batch:batches.append(batch)
 key=hashlib.sha256(raw).hexdigest();statepath=root/'.cache/product-publish-state.json'
 state=json.loads(statepath.read_text()) if statepath.exists() else {}
 if state.get('key')!=key:state={'key':key,'prefix':'codex/sku-stage-'+str(int(time.time())),'commits':[]}
 parents=[];objects={};futures=[]
 remote={}
 if args.publish:
  for line in git('ls-remote','--heads','origin',state['prefix']+'-*').splitlines():
   oid,ref=line.split();remote[ref]=oid
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  for n,batch in enumerate(batches):
   branch=state['prefix']+'-'+str(n+1)
   if n<len(state['commits']):sha=state['commits'][n]
   else:
    sha=commit(branch,f'Prepare SKU asset batch {n+1}/{len(batches)}',[],paths=batch);state['commits'].append(sha);statepath.write_text(json.dumps(state),encoding='utf-8')
   parents.append(sha)
   for line in git('ls-tree','-r',sha).splitlines():
    entry,path=line.split('\t',1);objects[path]=entry.split()[2]
   print('Prepared batch',n+1,len(batches),flush=True)
   if args.publish and remote.get('refs/heads/'+branch)!=sha:futures.append(pool.submit(push,branch))
  for n,f in enumerate(concurrent.futures.as_completed(futures),len(batches)-len(futures)+1):f.result();print('Uploaded batch',n,len(batches),flush=True)
 branch='codex/product-assets';old=revision('refs/heads/'+branch)
 final=commit(branch,'Publish verified compact SKU snapshot',([old] if old else [])+parents,objects=objects)
 if args.publish:push(branch)
 index.update(base='https://raw.githubusercontent.com/yichu-zql/jq-industry-scan/'+final+'/',sourceVersion=manifest['version'],assetCommit=final)
 manifest['products']={'catalog':'products.json.gz','assetCommit':final,'sourceVersion':manifest['version'],'last':index['last']}
 (root/'data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 (root/'data/products.json.gz').write_bytes(gzip.compress(json.dumps(index,ensure_ascii=False,separators=(',',':')).encode(),mtime=0))
 print('SKU catalog ready',final,len(files),index['bytes'],flush=True)
if __name__=='__main__':main()
