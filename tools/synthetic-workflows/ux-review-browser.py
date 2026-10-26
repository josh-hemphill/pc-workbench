"""Validate UX recovery and navigation context in an isolated workspace.
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
   # Invalid IDs hidden in collapsed detail panels must be revealed and focused.
   page.goto(base+'/#/systems');page.get_by_role('button',name='Add equipment system',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('System name *',exact=True).fill('Validation review');dialog.get_by_role('button',name='Add instrument',exact=True).click();dialog.get_by_label('Instrument / equipment name *',exact=True).fill('Test instrument');dialog.get_by_role('button',name='Add interface requirement for Test instrument',exact=True).click();dialog.get_by_text('Reference ID',exact=True).click();field=dialog.get_by_label('Requirement ID',exact=True);field.fill('invalid id');dialog.get_by_text('Reference ID',exact=True).click();dialog.get_by_role('button',name='Save requirements',exact=True).click();expect(field).to_be_visible();expect(field).to_be_focused();field.fill('INTERFACE_1');page.once('dialog',lambda d:d.accept());dialog.get_by_role('button',name='Cancel',exact=True).click()
   # Shared table sort, page size and position survive navigation away and Back.
   page.goto(base+'/#/catalog/components');table=page.locator('[data-table-name="Component catalog"]');header=table.get_by_role('columnheader',name='Component',exact=True);header.click();header.click();expect(header).to_have_attribute('aria-sort','descending');table.locator('.v-data-table-footer__items-per-page .v-select').click();page.get_by_role('option',name='10',exact=True).click();table.get_by_role('button',name='Next page',exact=True).click();first_name=table.locator('tbody .table-name').first.inner_text();page.get_by_role('button',name='Equipment systems',exact=True).click();page.go_back();expect(table.get_by_role('columnheader',name='Component',exact=True)).to_have_attribute('aria-sort','descending');expect(table.locator('tbody .table-name').first).to_have_text(first_name);expect(table.locator('.v-data-table-footer__items-per-page')).to_contain_text('10')
   # No-match results provide a direct recovery action.
   page.goto(base+'/#/installations/distribution');vacancies=page.locator('[data-table-name="Installation locations without active assigned PCs"]');vacancies.get_by_role('textbox').fill('no-such-location');expect(vacancies.get_by_role('status')).to_contain_text('No records match');vacancies.get_by_role('button',name='Clear search',exact=True).click();expect(vacancies.get_by_role('button',name='Open location Vacant bench',exact=True)).to_be_visible()
   # A server rejection must be visible from the bottom of a long requirements form.
   page.goto(base+'/#/installations/requirements');page.get_by_role('button',name='Create requirements set',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('Requirements set name',exact=True).fill('Long form error review')
   for i in range(5):
    dialog.get_by_role('button',name='Add instrument',exact=True).click();dialog.get_by_label('Instrument / equipment name *',exact=True).nth(i).fill('Instrument '+str(i))
   page.route('**/api/requirementsSets/*',lambda route:route.fulfill(status=409,content_type='application/json',body=json.dumps({'error':'Workspace changed. Reload before saving.'})))
   dialog.locator('.dialog-body').evaluate('(el)=>el.scrollTop=el.scrollHeight');dialog.get_by_role('button',name='Publish revision 1',exact=True).click();alert=dialog.get_by_role('alert').filter(has_text='Workspace changed. Reload before saving.');expect(alert).to_be_visible();expect(alert).to_be_focused();assert alert.bounding_box()['y']<900;page.screenshot(path='/tmp/ux-error-after.png');page.once('dialog',lambda d:d.accept());dialog.get_by_role('button',name='Cancel',exact=True).click()
   # Native mobile bulk action wrapping already worked; retain it as a regression check.
   page.set_viewport_size({'width':390,'height':844});page.goto(base+'/#/installations/operations');panel=page.locator('#pc-operations-panel');panel.get_by_label('Bulk actions',exact=True).check();button=panel.get_by_role('button',name='Add all 100 matching PCs to selection',exact=True);expect(button).to_be_visible();assert button.bounding_box()['x']+button.bounding_box()['width']<=390;page.screenshot(path='/tmp/ux-mobile-after.png');assert not errors,errors;browser.close()
  print('PASS collapsed validation focus, table navigation context, empty-search recovery, long-form error visibility and mobile action access')
 finally:process.terminate();process.wait(timeout=10)
