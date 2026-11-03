"""GitHub API with existing Git Credential Manager authorization; secrets never logged."""
import argparse,json,subprocess,urllib.request,urllib.error
REPO='yichu-zql/jq-industry-scan'
def request(path,method='GET',body=None):
    p=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',text=True,capture_output=True,check=True)
    cred=dict(line.split('=',1) for line in p.stdout.splitlines() if '=' in line)
    token=cred.get('password');assert token,'No existing GitHub credential'
    req=urllib.request.Request('https://api.github.com/'+path,data=None if body is None else json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'jq-industry-scan-maintenance'})
    try:
        with urllib.request.urlopen(req,timeout=40) as r:return json.load(r) if r.status!=204 else {'ok':True}
    except urllib.error.HTTPError as e:
        return {'status':e.code,'message':e.read().decode()[:1000]}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['status','pages','build','runs','configure']);a=p.parse_args()
    if a.action=='status':
        u=request('user');r=request('repos/'+REPO);print(json.dumps({'login':u.get('login'),'permissions':r.get('permissions'),'branch':r.get('default_branch')},ensure_ascii=False))
    if a.action=='pages':print(json.dumps(request('repos/'+REPO+'/pages'),ensure_ascii=False))
    if a.action=='build':print(json.dumps(request('repos/'+REPO+'/pages/builds/latest'),ensure_ascii=False))
    if a.action=='runs':
        r=request('repos/'+REPO+'/actions/runs?per_page=3');print(json.dumps([{'id':x['id'],'name':x['name'],'status':x['status'],'conclusion':x['conclusion'],'head_sha':x['head_sha'],'html_url':x['html_url']} for x in r.get('workflow_runs',[])],ensure_ascii=False))
    if a.action=='configure':print(json.dumps(request('repos/'+REPO+'/pages','PUT',{'source':{'branch':'main','path':'/'},'build_type':'legacy'}),ensure_ascii=False))
