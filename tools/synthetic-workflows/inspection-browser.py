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
  state['pcs'][0]['lifecycle']='Parts only';state['pcs'][1]['lifecycle']='Retired'
  pv=api('/api/restore/preview',{'backup':state},'POST');api('/api/restore',{'backup':state,'backupRevision':pv['backupRevision']},'POST')
  with sync_playwright() as p:
   browser=p.chromium.launch(executable_path=os.environ.get('BENCH_TEST_CHROMIUM') or shutil.which('chromium'),headless=True,args=['--no-sandbox'])
   page=browser.new_page(viewport={'width':1450,'height':1100});page.set_default_timeout(10000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(base+'/#/pcs/pc-0/inspection');expect(page.get_by_role('heading',name='Inspect PC 000',exact=True)).to_be_visible();workbench=page.get_by_role('region',name='PC inspection') if False else page.locator('section[aria-label="PC inspection"]')
   workbench.get_by_label('Inspected by *',exact=True).fill('Bench tech');workbench.get_by_label('Evidence / session notes *',exact=True).fill('Opened donor, labels photographed, IMG-123')
   # Navigation must not silently discard the active inspection.
   page.once('dialog',lambda d:d.dismiss());page.get_by_role('tab',name='Parts & reservations',exact=True).click();expect(page).to_have_url(base+'/#/pcs/pc-0/inspection')
   workbench.get_by_role('button',name='Record a found part',exact=True).click();row=page.locator('section[aria-label="Found part 1"]');row.get_by_label('Catalog component *',exact=True).fill(next(c['name'] for c in state['components'] if c['id']=='ram'));page.get_by_role('option',name=re.compile(re.escape(next(c['name'] for c in state['components'] if c['id']=='ram')))).click();row.get_by_label('Found quantity',exact=True).fill('2');row.get_by_label('Asset / lot tag (optional)',exact=True).fill('DONOR-RAM')
   workbench.get_by_role('button',name='Record a found part',exact=True).click();row=page.locator('section[aria-label="Found part 2"]');row.get_by_role('button',name='Create catalog model',exact=True).click();row.get_by_label('Component name *',exact=True).fill('New labelled RAM');row.get_by_label('Model / part number',exact=True).fill('RAM-NEW');row.get_by_label('Unit serial (optional; quantity must be 1)',exact=True).fill('NEW-UNIT-1');row.get_by_label('Component name *',exact=True).fill('')
   workbench.get_by_role('tab',name='Coverage (0/15)',exact=True).click();workbench.get_by_label('Memory coverage',exact=True).press('Enter');page.get_by_role('option',name='Present, identified',exact=True).click();workbench.get_by_role('button',name='Review inspection save',exact=True).click();expect(row.get_by_label('Component name *',exact=True)).to_be_visible();row.get_by_label('Component name *',exact=True).fill('New labelled RAM');workbench.get_by_role('button',name='Review inspection save',exact=True).click();expect(workbench.get_by_role('heading',name='Review before saving',exact=True)).to_be_visible();expect(workbench.get_by_text('New labelled RAM',exact=False)).to_be_visible();workbench.get_by_role('button',name='Save inspection',exact=True).click();expect(workbench.get_by_label('Evidence / session notes *',exact=True)).to_have_value('')
   saved=api('/api/state');donor=next(pc for pc in saved['pcs'] if pc['id']=='pc-0');assert donor['lifecycle']=='Parts only';assert len(donor['inspections'])==1;assert sum(s['quantity'] for s in saved['inventory'])==3;assert all(s['condition']=='Quarantined' and sum(a['quantity'] for a in s['allocations'])==s['quantity'] for s in saved['inventory']);assert donor['hardwareSurvey']['status']=='partial'
   workbench.get_by_role('tab',name='Saved evidence (1)',exact=True).click();expect(page.get_by_role('heading',name='Saved inspection evidence',exact=True)).to_be_visible();page.reload();workbench=page.locator('section[aria-label="PC inspection"]');workbench.get_by_label('Evidence / session notes *',exact=True).fill('Revisit: checked remaining categories, RAM still present')
   workbench.get_by_role('tab',name='Coverage (1/15)',exact=True).click()
   for category in ['Chassis','Motherboard','CPU','Drive','GPU','Scientific card','Network card','Storage adapter','Bay accessory','PSU','Cooler','Fan','Cable','Consumable']:
    workbench.get_by_label(category+' coverage',exact=True).press('Enter');page.get_by_role('option',name='Confirmed absent',exact=True).last.click()
   workbench.get_by_label('Finish physical enumeration — every category accounted for',exact=True).check();workbench.get_by_role('button',name='Review inspection save',exact=True).click();workbench.get_by_role('button',name='Save inspection',exact=True).click();expect(workbench.get_by_label('Evidence / session notes *',exact=True)).to_have_value('');saved=api('/api/state');donor=next(pc for pc in saved['pcs'] if pc['id']=='pc-0');assert donor['hardwareSurvey']['status']=='complete';assert len(donor['inspections'])==2;assert donor['inspections'][0]['sessionId']==donor['inspections'][1]['sessionId'];assert len(saved['inventory'])==2
   # Move the donor, then find it under its former location without parsing timeline prose.
   donor['installationLocationId']='vacant';api('/api/pcs/pc-0',donor,'PUT');page.goto(base+'/#/installations/operations');page.reload();page.get_by_label('Installation location',exact=True).press('Enter');page.get_by_role('option',name='Occupied bench',exact=True).click();page.get_by_label('PC location history',exact=True).press('Enter');page.get_by_role('option',name='Previously at location',exact=True).click();expect(page.get_by_role('tab',name='PC operations (1)',exact=True)).to_be_visible();expect(page.get_by_role('link',name='Inspect PC PC 000',exact=True)).to_be_visible()
   page.goto(base+'/#/pcs/pc-1/inspection');workbench=page.locator('section[aria-label="PC inspection"]');workbench.get_by_label('Inspected by *',exact=True).fill('Historian');workbench.get_by_label('Evidence / session notes *',exact=True).fill('Old report says drive was removed and scrapped');expect(workbench.get_by_role('button',name='Record a found part',exact=True)).to_have_count(0);workbench.get_by_role('button',name='Review inspection save',exact=True).click();workbench.get_by_role('button',name='Save inspection',exact=True).click();expect(workbench.get_by_label('Evidence / session notes *',exact=True)).to_have_value('');assert len(api('/api/state')['inventory'])==2
   page.set_viewport_size({'width':390,'height':844});page.goto(base+'/#/pcs/pc-0/inspection');expect(page.get_by_role('tab',name='Observations & parts (0)',exact=True)).to_be_visible();page.get_by_role('tab',name='Observations & parts (0)',exact=True).scroll_into_view_if_needed();page.screenshot(path=str(Path(tempfile.gettempdir())/'pc-inspection-mobile.png'));assert not errors,errors;browser.close()
  print('PASS donor discovery, inline catalog, navigation guard, coverage/resume, former-location queue, retired historical notes and mobile inspection')
 finally:process.terminate();process.wait(timeout=10)
