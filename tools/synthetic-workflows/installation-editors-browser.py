"""Validate location-operation navigation and instrument requirements in an isolated workspace.
Run pnpm build first. Requires Node 26 on PATH, Python Playwright and Chromium.
BENCH_TEST_NODE and BENCH_TEST_CHROMIUM override executable discovery.
"""
import json,os,tempfile,subprocess,socket,time,urllib.request,re,shutil
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='installation-editors-') as temp:
 work=Path(temp)
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 base=f'http://127.0.0.1:{port}'
 (work/'config.json').write_text(json.dumps({'version':1,'dataDir':str(work/'data'),'port':port}))
 env=dict(os.environ,BENCH_CONFIG_FILE=str(work/'config.json'),BENCH_USER_SETTINGS_FILE=str(work/'user.json'),BENCH_CACHE_DIR=str(work/'cache'),BENCH_DATA_DIR=str(work/'data'),PORT=str(port))
 process=subprocess.Popen([os.environ.get('BENCH_TEST_NODE') or shutil.which('node'),'.standalone/server.cjs'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def api(path,body=None,method='GET'):
  headers={'Content-Type':'application/json'}
  if body is not None:headers['If-Match']=api('/api/state')['revision']
  req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
  try:
   with urllib.request.urlopen(req) as res:return json.load(res)
  except urllib.error.HTTPError as e:print(e.read().decode());raise
 try:
  for _ in range(100):
   try:state=api('/api/state');break
   except OSError:
    if process.poll() is not None:raise RuntimeError('Application failed to start')
    time.sleep(.1)
  state.pop('revision');state.pop('recoveryRequired',None)
  state['inventory']=[];state['requirementsSets']=[]
  state['installationLocations']=[{'id':id,'name':name,'kind':'Bench','parentId':'','requirementSetId':'','requirementRevision':0,'targetConfigurationId':'','notes':''} for id,name in [('occupied','Occupied bench'),('vacant','Vacant bench')]]
  state['pcs']=[{**state['pcs'][0],'id':f'pc-{i}','name':f'PC {i:03}','serial':f'SERIAL-{i}','installationLocationId':'occupied'} for i in range(100)]
  pv=api('/api/restore/preview',{'backup':state},'POST');api('/api/restore',{'backup':state,'backupRevision':pv['backupRevision']},'POST')
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=os.environ.get('BENCH_TEST_CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1450,'height':1100});page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(base+'/#/installations/operations')
   distribution=page.get_by_role('tab',name='Distribution review (1)',exact=True);expect(distribution).to_be_visible();assert distribution.bounding_box()['y']<900
   expect(page.get_by_role('tab',name='PC operations (100)',exact=True)).to_be_visible();expect(page.locator('#distribution-review-panel')).not_to_be_visible()
   page.get_by_label('Search PCs, serials, equipment or locations',exact=True).fill('PC 000');expect(page.get_by_role('tab',name='PC operations (1)',exact=True)).to_be_visible()
   distribution.click();expect(page).to_have_url(base+'/#/installations/distribution');expect(page.locator('#pc-operations-panel')).not_to_be_visible();expect(page.get_by_role('heading',name='Locations needing distribution review',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Open location Vacant bench',exact=True)).to_be_visible()
   page.go_back();expect(page).to_have_url(base+'/#/installations/operations');expect(page.get_by_label('Search PCs, serials, equipment or locations',exact=True)).to_have_value('PC 000')
   page.go_forward();expect(page).to_have_url(base+'/#/installations/distribution');page.reload();expect(page.get_by_role('heading',name='Locations needing distribution review',exact=True)).to_be_visible()
   page.goto(base+'/#/installations/requirements');page.get_by_role('button',name='Create requirements set',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('Requirements set name',exact=True).fill('Instrument acceptance')
   expect(dialog.get_by_text('No instruments added.',exact=False)).to_be_visible();dialog.get_by_role('button',name='Add instrument',exact=True).click();dialog.get_by_role('button',name='Publish revision 1',exact=True).click();expect(dialog).to_be_visible();assert not api('/api/state')['requirementsSets']
   dialog.get_by_label('Instrument / equipment name *',exact=True).fill('Spectrometer');dialog.get_by_role('button',name='Add interface requirement for Spectrometer',exact=True).click()
   interfaces=dialog.locator('section[aria-label^="Interface requirement"]');first=interfaces.nth(0);first.get_by_label('Interface type',exact=True).press('Enter');page.get_by_role('option',name='Serial',exact=True).click();first.get_by_label('Interface quantity',exact=True).fill('2');first.get_by_text('Connector, protocol and electrical constraints',exact=True).click();first.get_by_label('Required PC-side connector',exact=True).fill('DB9');first.get_by_label('Protocol',exact=True).fill('RS-232');first.get_by_label('Required pinout / wiring standard',exact=True).fill('DTE');first.get_by_label('Minimum speed (Mbps)',exact=True).fill('0');first.get_by_label('Requires dedicated isolation',exact=True).check()
   dialog.get_by_role('button',name='Add interface requirement for Spectrometer',exact=True).click();second=interfaces.nth(1);second.get_by_label('Interface type',exact=True).press('Enter');page.get_by_role('option',name='Custom',exact=True).click();dialog.get_by_role('button',name='Publish revision 1',exact=True).click();expect(dialog).to_be_visible();assert not api('/api/state')['requirementsSets'];second.get_by_label('Custom interface name',exact=True).fill('GPIB');dialog.get_by_role('button',name='Publish revision 1',exact=True).click();expect(dialog).not_to_be_visible()
   saved=api('/api/state')['requirementsSets'][0];v1=saved['versions'][0];connection=v1['connections'][0];assert connection['name']=='Spectrometer';assert connection['requirements'][0]['connector']=='DB9';assert connection['requirements'][0]['minSpeedMbps']==0;assert connection['requirements'][0]['isolated'];assert connection['requirements'][1]['customType']=='GPIB'
   # Publishing a new revision preserves existing requirement IDs and the accepted old revision.
   page.get_by_role('button',name=re.compile('Publish next revision')).click();dialog=page.get_by_role('dialog');interfaces=dialog.locator('section[aria-label^="Interface requirement"]');expect(interfaces).to_have_count(2);interfaces.nth(0).get_by_label('Interface quantity',exact=True).fill('3');dialog.get_by_role('button',name='Publish revision 2',exact=True).click();expect(dialog).not_to_be_visible()
   versions=api('/api/state')['requirementsSets'][0]['versions'];assert versions[0]==v1;assert versions[1]['connections'][0]['requirements'][0]['quantity']==3;assert versions[1]['connections'][0]['requirements'][0]['id']==connection['requirements'][0]['id']
   # The equipment-system editor uses the same complete instrument editor.
   page.goto(base+'/#/systems');page.get_by_role('button',name='Add equipment system',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('System name *',exact=True).fill('Instrument station');dialog.get_by_role('button',name='Add instrument',exact=True).click();dialog.get_by_label('Instrument / equipment name *',exact=True).fill('Controller');dialog.get_by_role('button',name='Add interface requirement for Controller',exact=True).click();dialog.get_by_role('button',name='Save requirements',exact=True).click();expect(dialog).not_to_be_visible();assert any(s['name']=='Instrument station' and len(s['connections'][0]['requirements'])==1 for s in api('/api/state')['systems'])
   assert not errors,errors;page.screenshot(path=str(Path(tempfile.gettempdir())/'installation-editors.png'));browser.close()
  print('PASS large-table section discovery, URL/back/forward/reload, required instrument validation, structured interfaces, immutable revision editing and shared equipment editor')
 finally:process.terminate();process.wait(timeout=10)
