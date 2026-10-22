"""Deterministic static checks; standard-library only, no network requests."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote
import json, re, subprocess, tempfile, xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
BASE='https://getmacbuild.com'
errors=[]
class Page(HTMLParser):
    def __init__(self,text):
        super().__init__();self.tags=[];self.ids=set();self.h1=0;self.feed(text)
    def handle_starttag(self,tag,attrs):
        attrs=dict(attrs);self.tags.append((tag,attrs))
        if tag=='h1':self.h1+=1
        if 'id' in attrs:
            if attrs['id'] in self.ids: errors.append('Duplicate id: '+attrs['id'])
            self.ids.add(attrs['id'])
    def find(self,tag,**attrs):return [a for t,a in self.tags if t==tag and all(a.get(k)==v for k,v in attrs.items())]
pages={p.name:(p.read_text(encoding='utf-8'),Page(p.read_text(encoding='utf-8'))) for p in ROOT.glob('*.html')}
def check(ok,message):
    if not ok:errors.append(message)
def json_object(pairs):
    result={}
    for key,value in pairs:
        if key in result:raise ValueError('Duplicate JSON key: '+key)
        result[key]=value
    return result
versions=set();titles=set();descriptions=set();script_count=0
with tempfile.TemporaryDirectory() as temp:
    for name,(text,page) in pages.items():
        check(page.h1==1,f'{name}: one H1 required')
        for tag,attrs in page.tags:
            href=attrs.get('href') if tag in ['a','link'] else attrs.get('src') if tag in ['img','script'] else None
            if not href:continue
            url=urlsplit(href)
            if url.scheme in ['data','mailto','tel'] or (url.netloc and url.netloc!='getmacbuild.com'):continue
            target=unquote(url.path)
            dest=ROOT/(target.lstrip('/') if target else name)
            if target=='/':dest=ROOT/'index.html'
            if not dest.suffix:dest=dest.with_suffix('.html')
            check(dest.is_file(),f'{name}: missing local link {href}')
            if url.fragment and dest.name in pages:check(url.fragment in pages[dest.name][1].ids,f'{name}: broken anchor {href}')
        for a in page.find('link',rel='stylesheet'):
            check('?v=' in a.get('href',''),f'{name}: missing CSS version');versions.add(a.get('href'))
        if name!='404.html':
            canonical=BASE+('/' if name=='index.html' else '/'+name[:-5])
            check(page.find('link',rel='canonical')==[{'rel':'canonical','href':canonical}],f'{name}: canonical mismatch')
            check(len(page.find('meta',name='description'))==1,f'{name}: description missing/duplicated')
            title=re.search(r'<title>(.*?)</title>',text).group(1)
            check(title not in titles,f'{name}: duplicate title');titles.add(title)
            desc=page.find('meta',name='description')[0]['content']
            check(desc not in descriptions,f'{name}: duplicate description');descriptions.add(desc)
            check(page.find('meta',property='og:url')[0]['content']==canonical,f'{name}: OG URL mismatch')
            for key in ['og:title','og:description','og:image','og:image:alt']:
                check(len(page.find('meta',property=key))==1,f'{name}: {key} missing/duplicated')
        else:check('noindex' in page.find('meta',name='robots')[0]['content'],'404 must be noindex')
        for attrs,body in re.findall(r'<script([^>]*)>([\s\S]*?)</script>',text):
            if 'application/ld+json' in attrs:
                try:json.loads(body,object_pairs_hook=json_object)
                except ValueError as e:errors.append(f'{name}: {e}')
            elif body.strip():
                script_count+=1;path=Path(temp)/f'{script_count}.js';path.write_text(body,encoding='utf-8')
                r=subprocess.run(['node','--check',str(path)],capture_output=True,text=True)
                check(r.returncode==0,f'{name}: JS syntax error {r.stderr}')
check(len(versions)==1,'CSS versions differ across pages')
hero=re.search(r'<section class="hero hero-photo">([\s\S]*?)</section>',pages['index.html'][0]).group(1)
check('href="https://t.me/Mondbinch"' in hero,'Homepage hero must retain the direct Telegram entry')
check('data-open-contact' in hero and 'Mondbinch' in hero,'Homepage hero must retain the WeChat entry')
fleet=re.search(r'<section class="section section-alt" id="fleet">([\s\S]*?)</section>',pages['index.html'][0]).group(1)
check('<details' not in fleet and 'id="fleet-list"' in fleet,'Fleet must remain expanded')
inventory=json.loads((ROOT/'inventory.json').read_text(encoding='utf-8'),object_pairs_hook=json_object)
check(len(inventory['machines'])==10,'Preserve the ten inventory records')
check({m['id'] for m in inventory['machines']}=={f'MY-{i:02}' for i in range(1,11)},'Inventory IDs changed')
for path in ROOT.glob('*.mjs'):
    result=subprocess.run(['node','--check',str(path)],capture_output=True,text=True)
    check(result.returncode==0,f'{path.name}: module syntax error {result.stderr}')
for name,(text,page) in pages.items():
    bars=[a for tag,a in page.tags if tag=='nav' and a.get('class')=='mobile-contact']
    check(len(bars)==1,f'{name}: mobile contact bar missing or duplicated')
    check('style.css?v=20261022service2' in text,f'{name}: old CSS version')
check('__' not in pages['terms.html'][0],'Unfilled terms placeholder')
check('QuHn0AD6ER3RVNrzNeMpHS3IiZXI2J0_Fb33i250fK0' in pages['index.html'][0],'GSC ownership token missing')
for filename in ['functions/api/order.js','_redirects','_routes.json','d457c96f62b51b4586bdcf2402b3140d.txt']:
    before=subprocess.check_output(['git','show','HEAD:'+filename],cwd=ROOT)
    check(before.replace(b'\r\n',b'\n')==(ROOT/filename).read_bytes().replace(b'\r\n',b'\n'),filename+': protected file changed')
for name in ['claude-code-mac.html','rent-mac-claude.html']:
    links={(a['hreflang'],a['href']) for a in pages[name][1].find('link',rel='alternate') if 'hreflang' in a}
    check(links=={('zh-CN',BASE+'/claude-code-mac'),('en',BASE+'/rent-mac-claude')},name+': hreflang not reciprocal')
sitemap=ET.parse(ROOT/'sitemap.xml');ns={'s':'http://www.sitemaps.org/schemas/sitemap/0.9'}
urls=[el.text for el in sitemap.findall('.//s:loc',ns)]
expected={BASE+('/' if n=='index.html' else '/'+n[:-5]) for n in pages if n!='404.html'}
check(set(urls)==expected and len(urls)==len(expected),'Sitemap must contain every canonical indexable page once')
check(not re.search(r'"(?:shippingDetails|hasMerchantReturnPolicy|geo)"',pages['index.html'][0]),'Unsupported commerce or location markup remains')
if errors:
    print('\n'.join(errors));raise SystemExit(1)
print(f'PASS: {len(pages)} pages; {script_count} scripts; internal links/anchors; JSON-LD; metadata; sitemap; language pair; protected files.')
