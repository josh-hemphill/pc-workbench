"""Optional real-browser replay. Requires Python Playwright and a Chromium executable.
Run pnpm build first; this starts and deletes an isolated temporary workspace.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / 'examples' / 'synthetic-workflows'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--chromium', default=shutil.which('chromium'))
    parser.add_argument('--scenario', action='append', help='Replay only this scenario ID; repeat for multiple scenarios.')
    parser.add_argument('--output', default=str(Path(tempfile.gettempdir()) / 'pc-workbench-synthetic-browser'))
    args = parser.parse_args()
    if not args.node or not args.chromium:
        parser.error('Provide Node 26 and Chromium with --node and --chromium.')
    artifacts = Path(args.output)
    artifacts.mkdir(parents=True, exist_ok=True)
    scenarios = json.loads((FIXTURES / 'manifest.json').read_text())['scenarios']
    if args.scenario:
        unknown = set(args.scenario) - {item['id'] for item in scenarios}
        if unknown:
            parser.error('Unknown scenarios: ' + ', '.join(sorted(unknown)))
        scenarios = [item for item in scenarios if item['id'] in args.scenario]
    with tempfile.TemporaryDirectory(prefix='pc-workbench-synthetic-browser-') as temp:
        work = Path(temp)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        base = f'http://127.0.0.1:{port}'
        (work / 'config.json').write_text(json.dumps({'version': 1, 'dataDir': str(work / 'data'), 'port': port}))
        env = dict(os.environ, BENCH_CONFIG_FILE=str(work / 'config.json'), BENCH_DATA_DIR=str(work / 'data'), BENCH_USER_SETTINGS_FILE=str(work / 'user.json'), BENCH_CACHE_DIR=str(work / 'cache'), PORT=str(port))
        def api(route):
            with urllib.request.urlopen(base + route, timeout=10) as response:
                return json.load(response)
        results = []
        with (artifacts / 'server.log').open('w') as log:
            process = subprocess.Popen([args.node, '.standalone/server.cjs'], cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    try:
                        api('/api/state')
                        break
                    except (OSError, ValueError):
                        if process.poll() is not None:
                            raise RuntimeError('Synthetic server failed; see server.log')
                        time.sleep(.1)
                else:
                    raise RuntimeError('Synthetic server startup timed out')
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
                    try:
                        def restore(page, file):
                            page.goto(base + '/#/data')
                            page.get_by_label('JSON backup', exact=True).set_input_files(str(file))
                            page.get_by_role('button', name='Validate & preview', exact=True).click()
                            page.once('dialog', lambda dialog: dialog.accept())
                            page.get_by_role('button', name='Restore workspace', exact=True).click()
                            expect(page.get_by_text('Workspace restored. Safety backup:', exact=False)).to_be_visible()
                        for scenario in scenarios:
                            context = browser.new_context(viewport={'width': 1500, 'height': 1100}, accept_downloads=True)
                            page = context.new_page()
                            page.set_default_timeout(10000)
                            errors = []
                            page.on('pageerror', lambda error: errors.append(str(error)))
                            id = scenario['id']
                            try:
                                restore(page, FIXTURES / id / 'workspace.json')
                                baseline = api('/api/state')
                                page.goto(base + f'/#/transitions/plan-{id}')
                                review = page.get_by_role('button', name='Review transition plan', exact=True)
                                selected = scenario['selected']
                                if not selected:
                                    expect(review).to_be_disabled()
                                    page.get_by_role('button', name='Open installation locations', exact=True).click()
                                    expect(page).to_have_url(base + '/#/installations/locations')
                                    page.go_back()
                                    expect(page).to_have_url(base + f'/#/transitions/plan-{id}')
                                else:
                                    review.click()
                                    included = selected - scenario['expected']['blocked']
                                    expect(page.get_by_text(f'{included} PCs included in demand · {scenario["expected"]["blocked"]} blocked', exact=False)).to_be_visible()
                                    export = page.get_by_role('button', name='Export order CSV', exact=True)
                                    if scenario['expected']['blocked']:
                                        expect(export).to_be_disabled()
                                    else:
                                        expect(export).to_be_enabled()
                                        with page.expect_download() as download:
                                            export.click()
                                        download.value.save_as(str(artifacts / f'{id}-order.csv'))
                                if id == '03-assumed-fleet':
                                    totals = page.get_by_role('status', name='Fleet order totals', exact=True)
                                    expect(totals.get_by_text('Using confirmed stock', exact=True)).to_be_visible()
                                    expect(totals.get_by_text('If hardware assumptions are confirmed', exact=True)).to_be_visible()
                                    procurement = page.locator('[data-table-name="Parts procurement estimate"]')
                                    expect(procurement.get_by_role('columnheader')).to_have_count(5)
                                    count_before = procurement.get_by_role('row').count()
                                    page.get_by_label('Filter purchases using', exact=True).press('Enter')
                                    page.get_by_role('option', name='Assumptions confirmed', exact=True).click()
                                    expect(procurement.get_by_role('row')).to_have_count(4)
                                    assert count_before > 4
                                    procurement.get_by_text('Stock breakdown', exact=True).first.click()
                                    expect(procurement.get_by_text('Free serviceable stock', exact=True).first).to_be_visible()
                                    assert procurement.locator('.v-table__wrapper').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'), 'compact procurement table should fit the desktop viewport'
                                    procurement.screenshot(path=str(artifacts / 'procurement-comparison.png'))
                                    scope = page.locator('section').filter(has=page.get_by_role('heading', name='1. Select the fleet', exact=True))
                                    scope.get_by_role('button', name='SYNTHETIC-PC-001', exact=True).click()
                                    expect(page).to_have_url(base + '/#/pcs/synthetic-pc-1/parts')
                                    page.go_back()
                                    expect(page).to_have_url(base + f'/#/transitions/plan-{id}')
                                    expect(page.get_by_text('6 selected · 0 hidden', exact=False)).to_be_visible()
                                    expect(procurement.get_by_role('row')).to_have_count(4)
                                if id == '04-partial-conflict':
                                    page.screenshot(path=str(artifacts / f'{id}-blocked.png'), full_page=True)
                                    scope = page.locator('section').filter(has=page.get_by_role('heading', name='1. Select the fleet', exact=True))
                                    findings = page.locator('[data-table-name="Transition targets and findings"]')
                                    expect(findings.get_by_role('row')).to_have_count(2)
                                    expect(findings.get_by_text('recorded hardware exceeds the assumed configuration', exact=False)).to_be_visible()
                                    scope.get_by_role('button', name='Edit survey for SYNTHETIC-PC-003', exact=True).click()
                                    dialog = page.get_by_role('dialog')
                                    dialog.get_by_label('Assumed current configuration', exact=True).fill('three-DIMM variation')
                                    page.get_by_role('option').filter(has_text='three-DIMM variation').click()
                                    dialog.get_by_role('button', name='Save PC', exact=True).click()
                                    expect(dialog).not_to_be_visible()
                                    changed = page.locator('.transition-cohort').filter(has_text='three-DIMM variation')
                                    changed.get_by_role('button', name='Reuse available group inputs', exact=True).click()
                                    expect(changed.get_by_text('SYNTHETIC · SSD and bay conversion · Draft', exact=True)).to_be_visible()
                                    segment = changed.locator('.transition-segment').filter(has=page.get_by_role('heading', name='Data · default array', exact=False))
                                    expect(segment.get_by_label('Largest measured used capacity per PC (GB)', exact=True)).to_have_value('1000')
                                    page.get_by_role('button', name='Review transition plan', exact=True).click()
                                    expect(page.get_by_text('3 PCs included in demand · 0 blocked', exact=False)).to_be_visible()
                                    after_edit = api('/api/state')
                                    assert after_edit['inventory'] == baseline['inventory']
                                    assert after_edit['pcs'][2]['hardwareSurvey']['configurationId'] == 'source-extra-memory'
                                    assert after_edit['pcs'][2]['configurationId'] == baseline['pcs'][2]['configurationId']
                                    baseline = after_edit
                                if id == '05-stock-pressure':
                                    exported_plan = json.loads((FIXTURES / id / 'transition-plan.json').read_text())
                                    exported_plan['scenario']['pcIds'] += ['synthetic-pc-4', 'synthetic-pc-5', 'missing-pc']
                                    page.locator('.plan-file-button input[type=file]').set_input_files({'name': 'unavailable-PC-plan.json', 'mimeType': 'application/json', 'buffer': json.dumps(exported_plan).encode()})
                                    page.get_by_role('button', name='Remove 3 unavailable PCs', exact=True).click()
                                    page.get_by_role('button', name='Review transition plan', exact=True).click()
                                    expect(page.get_by_text('2 PCs included in demand · 0 blocked', exact=False)).to_be_visible()
                                    expect(page.get_by_role('button', name='Export order CSV', exact=True)).to_be_enabled()
                                    expect(page.get_by_text('Draft autosaved in workspace.', exact=True)).to_be_visible()
                                    page.goto(base + '/#/installations/locations')
                                    page.get_by_label('Bulk actions', exact=True).check()
                                    page.get_by_role('button', name='Add all 7 matching locations to selection', exact=True).click()
                                    page.get_by_role('button', name='Register known PCs awaiting inspection', exact=True).click()
                                    registration = page.get_by_role('dialog')
                                    expect(registration.get_by_text('6 selected locations skipped:', exact=True)).to_be_visible()
                                    expect(registration.get_by_text('Already has a PC', exact=False).first).to_be_visible()
                                    registration.get_by_role('button', name='Cancel', exact=True).click()
                                    expect(registration).not_to_be_visible()
                                if id == '06-unknown-capacity':
                                    page.screenshot(path=str(artifacts / f'{id}-blocked.png'), full_page=True)
                                    page.get_by_label('One destination for all planning groups', exact=True).press('Enter')
                                    page.get_by_role('option').filter(has_text='high-capacity SSD conversion').click()
                                    page.get_by_role('button', name='Apply to all groups', exact=True).click()
                                    changed = page.locator('.transition-cohort').filter(has_text='capacity survey pending')
                                    segment = changed.locator('.transition-segment').filter(has=page.get_by_role('heading', name='Data · default array', exact=False))
                                    segment.get_by_label('Largest measured used capacity per PC (GB)', exact=True).fill('1000')
                                    segment.get_by_label('Usage evidence / date', exact=True).fill('Synthetic filesystem usage, 2026-10-21')
                                    page.get_by_role('button', name='Review transition plan', exact=True).click()
                                    expect(page.get_by_text('3 PCs included in demand · 0 blocked', exact=False)).to_be_visible()
                                    expect(page.get_by_role('button', name='Export order CSV', exact=True)).to_be_enabled()
                                if id == '07-survey-gaps':
                                    scope = page.locator('section').filter(has=page.get_by_role('heading', name='1. Select the fleet', exact=True))
                                    scope.get_by_role('button', name='Edit selected PCs', exact=True).click()
                                    dialog = page.get_by_role('dialog')
                                    dialog.get_by_role('checkbox', name='Change hardware survey / assumptions', exact=True).check()
                                    dialog.get_by_label('Assumed current configuration', exact=True).fill('HDD workstation')
                                    page.get_by_role('option').filter(has_text='HDD workstation').click()
                                    dialog.get_by_label('Survey / assumption evidence and date', exact=True).fill('Synthetic group survey evidence, 2026-10-21')
                                    dialog.get_by_role('button', name='Preview selected changes', exact=True).click()
                                    dialog.get_by_role('button', name='Apply changes to 4 PCs', exact=True).click()
                                    expect(dialog).not_to_be_visible()
                                    changed = page.locator('.transition-cohort')
                                    if changed.get_by_role('button', name='Reuse available group inputs', exact=True).count():
                                        if changed.get_by_label('Reuse inputs from group', exact=True).count():
                                            changed.get_by_label('Reuse inputs from group', exact=True).press('Enter')
                                            page.get_by_role('option').filter(has_text='HDD workstation').click()
                                        changed.get_by_role('button', name='Reuse available group inputs', exact=True).click()
                                    page.get_by_role('button', name='Review transition plan', exact=True).click()
                                    expect(page.get_by_text('4 PCs included in demand · 0 blocked', exact=False)).to_be_visible()
                                    after_edit = api('/api/state')
                                    assert all(pc['hardwareSurvey']['configurationId'] == 'source-hdd' for pc in after_edit['pcs'])
                                    assert after_edit['inventory'] == baseline['inventory']
                                    baseline = after_edit
                                if id == '08-fleet-scale':
                                    scope = page.locator('section').filter(has=page.get_by_role('heading', name='1. Select the fleet', exact=True))
                                    scope.get_by_role('button', name='Clear selection', exact=True).click()
                                    scope.get_by_role('button', name='Add all 120 matching PCs', exact=True).click()
                                    scope.get_by_role('button', name='Next page', exact=True).click()
                                    expect(scope.get_by_role('button', name='SYNTHETIC-PC-026', exact=True)).to_be_visible()
                                    scope.get_by_label('Installation scope (includes descendants)', exact=True).press('Enter')
                                    page.get_by_role('option', name='SYNTHETIC site-a', exact=True).click()
                                    expect(scope.get_by_text('120 selected · 57 hidden', exact=False)).to_be_visible()
                                    expect(page.get_by_text('Draft autosaved in workspace.', exact=True)).to_be_visible()
                                    page.reload()
                                    expect(page.get_by_text('120 selected · 57 hidden', exact=False)).to_be_visible()
                                after = api('/api/state')
                                for collection in ['pcs', 'inventory', 'configurations', 'installationLocations']:
                                    assert after[collection] == baseline[collection], f'{id}: planner mutated {collection}'
                                assert not errors, errors
                                page.screenshot(path=str(artifacts / f'{id}.png'), full_page=True)
                                results.append({'scenario': id, 'result': 'passed'})
                                print(f'PASS {id}', flush=True)
                            except Exception as error:
                                results.append({'scenario': id, 'result': 'failed', 'error': str(error)})
                                page.screenshot(path=str(artifacts / f'{id}-failed.png'), full_page=True)
                                raise
                            finally:
                                context.close()
                        # Test an incremental import and inspection registration from the UI.
                        context = browser.new_context(viewport={'width': 1500, 'height': 1100})
                        page = context.new_page()
                        page.set_default_timeout(10000)
                        try:
                            restore(page, FIXTURES / '01-locations-only' / 'catalog.json')
                            page.get_by_label('Collection', exact=True).press('Enter')
                            page.get_by_role('option', name='installationLocations', exact=True).click()
                            page.get_by_label('Choose CSV file', exact=True).set_input_files(str(FIXTURES / 'rejected-imports' / 'duplicate-locations.csv'))
                            page.get_by_role('button', name='Preview CSV changes', exact=True).click()
                            expect(page.get_by_role('alert').filter(has_text='duplicate record ID')).to_be_visible()
                            expect(page.get_by_role('button', name='Apply reviewed import', exact=True)).to_be_disabled()
                            page.get_by_label('Choose CSV file', exact=True).set_input_files(str(FIXTURES / '01-locations-only' / 'installationLocations.csv'))
                            page.get_by_role('button', name='Preview CSV changes', exact=True).click()
                            page.get_by_role('button', name='Apply reviewed import', exact=True).click()
                            expect(page.get_by_role('button', name='Preview CSV changes', exact=True)).to_be_disabled()
                            assert len(api('/api/state')['installationLocations']) == 6
                            page.goto(base + '/#/installations/locations')
                            page.get_by_label('Bulk actions', exact=True).check()
                            page.get_by_role('button', name='Add all 6 matching locations to selection', exact=True).click()
                            page.get_by_role('button', name='Register known PCs awaiting inspection', exact=True).click()
                            dialog = page.get_by_role('dialog')
                            expect(dialog.get_by_text('2 selected locations skipped:', exact=True)).to_be_visible()
                            expect(dialog.get_by_text('Grouping location', exact=False).first).to_be_visible()
                            first_location = dialog.locator('input[aria-label^="Register a PC at"]').first
                            first_location.uncheck()
                            expect(dialog.get_by_text('3 locations selected.', exact=False)).to_be_visible()
                            first_location.check()
                            dialog.get_by_label('Assumed current configuration', exact=True).fill('HDD workstation')
                            page.get_by_role('option').filter(has_text='HDD workstation').click()
                            dialog.get_by_label('Device presence / assumption evidence and date', exact=True).fill('Synthetic owner report 2026-10-21')
                            dialog.get_by_role('button', name='Register 4 PCs', exact=True).click()
                            expect(dialog).not_to_be_visible()
                            state = api('/api/state')
                            assert len(state['pcs']) == 4 and not state['inventory']
                            page.get_by_role('tab', name='Location operations', exact=True).click()
                            page.get_by_label('Hardware survey status', exact=True).press('Enter')
                            page.get_by_role('option', name='Not inspected', exact=True).click()
                            expect(page.get_by_text('4 PCs shown', exact=False)).to_be_visible()
                            results.append({'scenario': 'CSV rejection, incremental import and device registration', 'result': 'passed'})
                            print('PASS CSV rejection, incremental import and device registration', flush=True)
                        finally:
                            context.close()
                    finally:
                        browser.close()
            finally:
                process.terminate()
                process.wait(timeout=10)
                (artifacts / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(f'Browser artifacts: {artifacts}')

if __name__ == '__main__':
    main()
