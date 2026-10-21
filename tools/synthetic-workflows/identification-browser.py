"""Browser validation of explicit placeholders and selective identification.
Requires a built application, Python Playwright and Chromium. Uses an isolated temporary workspace.
Run with Node 26 on PATH; BENCH_TEST_NODE and BENCH_TEST_CHROMIUM override executables.
"""
import json,os,tempfile,subprocess,socket,time,urllib.request,re,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='placeholder-browser-') as temp:
 work=Path(temp);sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 (work/'config.json').write_text(json.dumps({'version':1,'dataDir':str(work/'data'),'port':port}))
 env=dict(os.environ,BENCH_CONFIG_FILE=str(work/'config.json'),BENCH_USER_SETTINGS_FILE=str(work/'user.json'),BENCH_CACHE_DIR=str(work/'cache'),BENCH_DATA_DIR=str(work/'data'),PORT=str(port))
 process=subprocess.Popen([os.environ.get('BENCH_TEST_NODE') or shutil.which('node'),'.standalone/server.cjs'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def api(path,body=None,method='GET'):
  headers={'Content-Type':'application/json'}
  if body is not None:headers['If-Match']=api('/api/state')['revision']
  req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
  try:
   with urllib.request.urlopen(req) as res:return json.load(res)
  except urllib.error.HTTPError as e:
   print(e.read().decode());raise
 try:
  for _ in range(100):
   try:state=api('/api/state');break
   except OSError:time.sleep(.1)
  known={'id':'known','name':'Known RAM','model':'RAM-A','manufacturer':'Synthetic','source':'https://example.org/ram','verified':True,'category':'Memory','specs':{'memoryType':'DDR4','capacityGb':16,'powerW':5}}
  unknown={**known,'id':'unknown','name':'Unknown RAM','identityKind':'placeholder','model':'','verified':False,'specs':{}}
  cfg={**state['configurations'][0],'id':'shared','name':'Shared unknown configuration','systemId':'','status':'Draft','placements':[{'id':'ram-line','componentId':'unknown','quantity':1,'slotId':'','role':'general','mount':'auto','group':''}]}
  pcs=[{**state['pcs'][0],'id':id,'name':name,'configurationId':'shared','serial':'','buildSettings':None} for id,name in [('pc-a','PC Alpha'),('pc-b','PC Beta')]]
  at='2026-10-21T12:00:00Z'
  allocations=[{'id':id,'pcId':pc,'quantity':1,'state':status,'plannedPlacementId':'ram-line','slotId':'','role':'general','mount':'auto','notes':'','createdAt':at,'updatedAt':at} for id,pc,status in [('allocation-a','pc-a','installed'),('allocation-b','pc-b','reserved')]]
  stock={'id':'mixed','componentId':'unknown','tracking':'bulk','serial':'','assetTag':'MIXED','quantity':10,'condition':'Serviceable','location':'Shelf','notes':'','allocations':allocations,'history':[]}
  backup={'components':[known,unknown],'systems':[],'requirementsSets':[],'configurations':[cfg],'installationLocations':[],'pcs':pcs,'inventory':[stock]}
  pv=api('/api/restore/preview',{'backup':backup},'POST');api('/api/restore',{'backup':backup,'backupRevision':pv['backupRevision']},'POST')
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=os.environ.get('BENCH_TEST_CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':1450,'height':1100});page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(base+'/#/catalog/gaps');expect(page.get_by_text('Identity needed — collect a label, CPU ID or memory SPD',exact=True)).to_be_visible();expect(page.get_by_text('Identify before product research',exact=True)).to_be_visible()
   page.get_by_label('Identity filter',exact=True).press('Enter');page.get_by_role('option',name='Identity needed',exact=True).click()
   page.get_by_role('button',name='Edit part Unknown RAM',exact=True).click();dlg=page.get_by_role('dialog');dlg.get_by_role('tab',name=re.compile('Review')).click();expect(dlg.get_by_label('I have verified these specifications against manufacturer documentation',exact=True)).to_be_disabled();dlg.get_by_role('button',name='Cancel',exact=True).click()
   page.get_by_role('button',name='Identify uses',exact=True).click();dlg=page.get_by_role('dialog')
   dlg.get_by_label('Identified model',exact=True).press('Enter');page.get_by_role('option',name=re.compile('Known RAM')).click()
   dlg.get_by_label('Identification evidence *',exact=True).fill('PC Alpha SPD and three spare labels show RAM-A')
   dlg.get_by_label('Identify in Shared unknown configuration',exact=True).check()
   dlg.get_by_label('Placements in Shared unknown configuration',exact=True).press('Enter');page.get_by_role('option',name='ram-line · 1 unit(s)',exact=True).click();page.keyboard.press('Escape')
   dlg.get_by_label('Copy configuration for selected PCs in Shared unknown configuration',exact=True).press('Enter');page.get_by_role('option',name='PC Alpha',exact=True).click();page.keyboard.press('Escape')
   dlg.get_by_label(re.compile('Identify stock MIXED')).check();dlg.get_by_label('Unallocated quantity from mixed',exact=True).fill('3')
   dlg.get_by_label('Allocations from mixed',exact=True).press('Enter');page.get_by_role('option',name=re.compile('PC Alpha · installed')).click();page.keyboard.press('Escape')
   dlg.get_by_label('Find uses by PC, configuration or stock',exact=True).fill('no matching uses');expect(dlg.get_by_text('No physical stock matches this filter.',exact=True)).to_be_visible();dlg.get_by_label('Find uses by PC, configuration or stock',exact=True).fill('')
   dlg.get_by_role('button',name='Preview identification',exact=True).click();expect(dlg.get_by_text(re.compile('4 physical unit'))).to_be_visible();expect(dlg.get_by_role('button',name='Apply identification',exact=True)).to_be_enabled()
   dlg.get_by_label('Identified by',exact=True).fill('Browser tester');expect(dlg.get_by_role('button',name='Apply identification',exact=True)).to_be_disabled();dlg.get_by_role('button',name='Preview identification',exact=True).click();expect(dlg.get_by_role('button',name='Apply identification',exact=True)).to_be_enabled();dlg.get_by_role('button',name='Apply identification',exact=True).click();expect(dlg).not_to_be_visible()
   state=api('/api/state');assert sum(s['quantity'] for s in state['inventory'])==10;assert next(s for s in state['inventory'] if s['id']=='mixed')['quantity']==6;assert next(pc for pc in state['pcs'] if pc['id']=='pc-a')['configurationId']!='shared';assert next(pc for pc in state['pcs'] if pc['id']=='pc-b')['configurationId']=='shared'
   # Resolve a different discovered model from the remainder, using the normal editor inline.
   page.get_by_role('button',name='Identify uses',exact=True).click();dlg=page.get_by_role('dialog');dlg.get_by_label('Create a new exact model',exact=True).check();dlg.get_by_label('Component name *',exact=True).fill('New identified RAM');dlg.get_by_label('Model / part number',exact=True).fill('RAM-B');dlg.get_by_label('Identification evidence *',exact=True).fill('Three remaining spare labels show RAM-B');dlg.get_by_label(re.compile('Identify stock MIXED')).check();dlg.get_by_label('Unallocated quantity from mixed',exact=True).fill('3');dlg.get_by_role('button',name='Preview identification',exact=True).click();expect(dlg.get_by_text(re.compile('3 physical unit'))).to_be_visible();dlg.get_by_role('button',name='Apply identification',exact=True).click();expect(dlg).not_to_be_visible()
   state=api('/api/state');assert sum(s['quantity'] for s in state['inventory'])==10;assert next(s for s in state['inventory'] if s['id']=='mixed')['quantity']==3;assert any(c.get('model')=='RAM-B' for c in state['components']);assert not errors,errors;page.screenshot(path=str(Path(tempfile.gettempdir())/'placeholder-identification.png'));browser.close()
  print('PASS identity filter, verification/enrichment safeguards, selected-PC copy, mixed stock split, preview invalidation and inline exact-model creation')
 finally:process.terminate();process.wait(timeout=10)
