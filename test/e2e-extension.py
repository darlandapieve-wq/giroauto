"""Teste de ponta a ponta da publicação com um clique, com a extensão real carregada no Chromium.

Sobe: painel com Meta simulada (porta 4556) + imitação do Facebook (porta 4600).
Uso: xvfb-run -a python3 test/e2e-extension.py   (precisa de Playwright e Node)
"""
import asyncio, json, os, shutil, subprocess, sys, tempfile, time, pathlib, urllib.request
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TMP = pathlib.Path(tempfile.mkdtemp(prefix='giro-ext-'))
PANEL = 'http://127.0.0.1:4556'
FB = 'http://127.0.0.1:4600'
JPG = bytes.fromhex('ffd8ffe000104a46494600010101004800480000ffdb004300' + 'ff' * 64 + 'ffc0000b080001000101011100ffc4001410010000000000000000000000000000000000ffda0008010100013f10')

# Extensão: cópia com permissão extra para a imitação do Facebook em 127.0.0.1
ext = TMP / 'ext'
shutil.copytree(ROOT / 'extension', ext)
m = json.loads((ext / 'manifest.json').read_text())
m['host_permissions'].append('http://127.0.0.1/*')
(ext / 'manifest.json').write_text(json.dumps(m))

# Imitação do Facebook
site = TMP / 'fb'
(site / 'marketplace/create/vehicle').mkdir(parents=True)
(site / 'marketplace/you/selling').mkdir(parents=True)
shutil.copy(ROOT / 'test/fixtures/fb-form.html', site / 'marketplace/create/vehicle/index.html')
shutil.copy(ROOT / 'test/fixtures/fb-selling.html', site / 'marketplace/you/selling/index.html')
(TMP / 'car.jpg').write_bytes(JPG)

procs = [
    subprocess.Popen([sys.executable, '-m', 'http.server', '4600', '--directory', str(site)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL),
    subprocess.Popen(['node', '--no-warnings=ExperimentalWarning', str(ROOT / 'test/e2e-server.js')], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT),
]


def wait_http(url):
    for _ in range(100):
        try:
            urllib.request.urlopen(url, timeout=1); return
        except Exception:
            time.sleep(0.1)
    raise SystemExit('não subiu: ' + url)


async def main():
    wait_http(PANEL + '/health'); wait_http(FB + '/marketplace/create/vehicle/')
    ext_id = None
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(str(TMP / 'perfil'), headless=False, viewport={'width': 1280, 'height': 900},
            args=[f'--disable-extensions-except={ext}', f'--load-extension={ext}'])
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        errs = []
        pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(PANEL + '/')
        await pg.click('text=Criar conta')
        await pg.fill('#a-loja', 'Autos Paraná'); await pg.fill('#a-nome', 'Darlan'); await pg.fill('#a-email', 'd@x.com'); await pg.fill('#a-senha', '12345678')
        await pg.click('#authBtn'); await pg.wait_for_selector('h1:text("Estoque")')
        me = await pg.evaluate("fetch('/api/me').then(r=>r.json())")
        assert me['extension']['id'] == ext_id, ('ID da extensão diferente', me['extension']['id'], ext_id)
        # Banner: extensão detectada -> ativar automático
        await pg.wait_for_selector('#enableAuto', timeout=10000)
        await pg.click('#enableAuto'); await pg.wait_for_selector('text=Extensão conectada', timeout=15000)
        r = await pg.evaluate(f"new Promise(r=>chrome.runtime.sendMessage('{ext_id}',{{cmd:'setFbBase',value:'{FB}'}},r))")
        assert r and r.get('ok'), r
        # Veículo pela API
        v = await pg.evaluate("""async()=>{const r=await fetch('/api/vehicles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          marca:'Chevrolet',modelo:'Onix',versao:'LT 1.0 Turbo',ano_fab:2021,ano_modelo:2022,km:48200,preco:74900,cambio:'Automático',combustivel:'Flex',
          carroceria:'Hatch',cor:'Prata',cor_interna:'Preto',descricao:'Revisado'})});return r.json();}""")
        # Fotos via formulário de edição
        await pg.goto(PANEL + f"/#editar-{v['id']}"); await pg.wait_for_selector('#v-fotos', state='attached')
        await pg.set_input_files('#v-fotos', [str(TMP / 'car.jpg'), str(TMP / 'car.jpg')])
        await pg.click('#salvar'); await pg.wait_for_selector('h1:text("Estoque")')
        # UM CLIQUE: Publicar
        async with ctx.expect_page() as np:
            await pg.click(f'[data-act="publicar"][data-id="{v["id"]}"]')
        fb = await np.value
        fb.on('pageerror', lambda e: errs.append('fb:' + str(e)))
        for _ in range(90):
            cur = await pg.evaluate(f"fetch('/api/vehicles/{v['id']}').then(r=>r.json())")
            jobs = await pg.evaluate("fetch('/api/jobs').then(r=>r.json())")
            if cur['status'] == 'publicado' or any(j['status'] == 'falhou' for j in jobs): break
            await asyncio.sleep(1)
        if cur['status'] != 'publicado':
            print('JOBS', json.dumps(jobs, ensure_ascii=False)[:600])
            try: await fb.screenshot(path=str(TMP / 'fb-falha.png')); print('screenshot', TMP / 'fb-falha.png', fb.url)
            except Exception as e: print('sem screenshot', e)
        print('1) publicar:', cur['status'])
        assert cur['status'] == 'publicado'
        await asyncio.sleep(3)
        print('   aba do Facebook fechada sozinha:', fb.is_closed())

        # UM CLIQUE: Republicar (antes de 7 dias pede confirmação)
        await pg.evaluate(f"new Promise(r=>chrome.runtime.sendMessage('{ext_id}',{{cmd:'setFbBase',value:'{FB}'}},r))")  # zera o intervalo de teste
        before = cur['publicado_em']
        await pg.reload(); await pg.wait_for_selector(f'[data-act="republicar"][data-id="{v["id"]}"]')
        await pg.click(f'[data-act="republicar"][data-id="{v["id"]}"]')
        async with ctx.expect_page() as np2:
            await pg.click('#mOk')
        fb2 = await np2.value
        deleted = False
        for _ in range(60):
            try:
                if '/selling' in fb2.url: deleted = deleted or await fb2.evaluate('!!window.__deleted')
            except Exception: pass
            cur = await pg.evaluate(f"fetch('/api/vehicles/{v['id']}').then(r=>r.json())")
            if cur['publicado_em'] != before: break
            await asyncio.sleep(1)
        print('2) republicar: anúncio antigo excluído:', deleted, '| nova publicação:', cur['publicado_em'] != before)
        assert deleted and cur['publicado_em'] != before

        # Verificação do Facebook: a automação para
        v2 = await pg.evaluate("""async()=>{const r=await fetch('/api/vehicles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          marca:'Volkswagen',modelo:'T-Cross',versao:'Comfortline',ano_fab:2020,ano_modelo:2021,km:62000,preco:109900,cambio:'Automático',combustivel:'Flex',
          carroceria:'SUV',cor:'Cinza',cor_interna:'Preto'})});return r.json();}""")
        await pg.goto(PANEL + f"/#editar-{v2['id']}"); await pg.wait_for_selector('#v-fotos', state='attached')
        await pg.set_input_files('#v-fotos', [str(TMP / 'car.jpg')]); await pg.click('#salvar'); await pg.wait_for_selector('h1:text("Estoque")')
        await pg.evaluate(f"new Promise(r=>chrome.runtime.sendMessage('{ext_id}',{{cmd:'setFbBase',value:'{FB}'}},r))")
        fbp = await ctx.new_page(); await fbp.goto(FB + '/marketplace/create/vehicle/'); await fbp.evaluate("localStorage.setItem('bloquear','1')"); await fbp.close()
        async with ctx.expect_page() as np3:
            await pg.click(f'[data-act="publicar"][data-id="{v2["id"]}"]')
        for _ in range(90):
            jobs = await pg.evaluate("fetch('/api/jobs').then(r=>r.json())")
            j = next(x for x in jobs if x['vehicle_id'] == v2['id'])
            if j['status'] == 'falhou': break
            await asyncio.sleep(1)
        print('3) verificação do Facebook:', j['status'], '-', j['error'])
        assert j['status'] == 'falhou' and 'Confirme sua identidade' in j['error']
        cur2 = await pg.evaluate(f"fetch('/api/vehicles/{v2['id']}').then(r=>r.json())")
        assert cur2['status'] != 'publicado'

        await pg.goto(PANEL + '/#config'); await pg.wait_for_selector('text=Extensão conectada')
        await pg.screenshot(path=str(TMP / 'config.png'), full_page=True)
        z = await pg.evaluate("fetch('/extensao.zip').then(r=>r.status)")
        assert z == 200
        print('erros de página:', errs)
        assert not errs
        await ctx.close()
    print('OK', TMP)

try:
    asyncio.run(main())
finally:
    for pr in procs: pr.terminate()
