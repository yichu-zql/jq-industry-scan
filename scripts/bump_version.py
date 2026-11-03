"""Bump the visible release and cache identifiers together; patch by default."""
import argparse,json,pathlib,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
def bump(kind='patch'):
 p=ROOT/'lib/version.js';old=re.search(r'"(\d+\.\d+\.\d+)"',p.read_text(encoding='utf-8')).group(1)
 a=list(map(int,old.split('.')));i={'major':0,'minor':1,'patch':2}[kind];a[i]+=1
 for j in range(i+1,3):a[j]=0
 version='.'.join(map(str,a));p.write_text(f'export const VERSION = "{version}";\n',encoding='utf-8')
 p=ROOT/'index.html';s=p.read_text(encoding='utf-8');s=re.sub(r'V\d+\.\d+(?:\.\d+)?', 'V'+version,s);s=re.sub(r'\?v=\d+\.\d+\.\d+','?v='+version,s);s=re.sub(r'(name="app-version" content=")[^"]+',lambda m:m[1]+version,s);p.write_text(s,encoding='utf-8')
 print('Release',old,'->',version)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('kind',nargs='?',default='patch',choices=['major','minor','patch']);bump(parser.parse_args().kind)
