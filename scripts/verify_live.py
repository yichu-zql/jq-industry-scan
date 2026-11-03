import json,time,urllib.request,pathlib,re
root=pathlib.Path(__file__).resolve().parents[1]
expected=json.loads((root/'data/manifest.json').read_text(encoding='utf-8'))['version']
release=re.search(r'"(\d+\.\d+\.\d+)"',(root/'lib/version.js').read_text(encoding='utf-8')).group(1)
base='https://yichu-zql.github.io/jq-industry-scan/'
for attempt in range(30):
    try:
        with urllib.request.urlopen(base+'data/manifest.json?verify='+str(time.time()),timeout=20) as r:live=json.load(r)
        if live['version']==expected:
            with urllib.request.urlopen(base+'index.html?verify='+str(time.time()),timeout=20) as r:html=r.read().decode()
            assert 'name="app-version" content="'+release+'"' in html, 'Release version does not match'

            for name in ['index.html','app.js','styles.css',live['industry'] if live['industry'].startswith('data/') else 'data/'+live['industry']]:
                with urllib.request.urlopen(base+name,timeout=30) as r:assert r.status==200
            print('VERIFIED',expected,base);break
    except Exception as e:
        print('Awaiting deployment',attempt+1,type(e).__name__,flush=True)
    time.sleep(20)
else:raise RuntimeError('Published version did not match candidate within deployment window')
