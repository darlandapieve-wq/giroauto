"""Testa o preenchimento da extensão contra uma imitação do formulário do Marketplace.

Uso (requer Python com Playwright: pip install playwright && playwright install chromium):
    python3 -m http.server 4600 --directory test/fixtures/site   # em outro terminal
    python3 test/extension-filler.py
"""
import asyncio, json, os, shutil, pathlib
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
site = ROOT / 'test' / 'fixtures' / 'site' / 'marketplace' / 'create' / 'vehicle'
site.mkdir(parents=True, exist_ok=True)
shutil.copy(ROOT / 'test' / 'fixtures' / 'fb-form.html', site / 'index.html')

JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
VEH = {'marca': 'Chevrolet', 'modelo': 'Onix', 'versao': 'LT 1.0 Turbo', 'ano_modelo': 2022, 'ano_fab': 2021, 'km': 48200,
       'preco': 74900, 'carroceria': 'Hatch', 'cor': 'Prata', 'combustivel': 'Flex', 'cambio': 'Automático',
       'descricao': 'Carro revisado', 'photos': [{'url': JPG}] * 3}
EXPECTED = {'tipo': 'Carro/picape', 'ano': '2022', 'carroceria': 'Hatchback', 'cor': 'Prata', 'cond': 'Bom', 'comb': 'Flex',
            'trans': 'Transmissão automática', 'marca': 'Chevrolet', 'modelo': 'Onix LT 1.0 Turbo', 'km': '48200',
            'preco': '74900', 'desc': 'Carro revisado', 'fotos': 3}


async def main():
    content = (ROOT / 'extension' / 'content.js').read_text()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto('http://127.0.0.1:4600/marketplace/create/vehicle/')
        await pg.evaluate("window.__msgs=[];window.chrome={runtime:{sendMessage:(m)=>{window.__msgs.push(m);return Promise.resolve({ok:true})},onMessage:{addListener:(f)=>{window.__l=f}}}}")
        await pg.add_script_tag(content=content)
        await pg.evaluate("v=>window.__l({cmd:'run',current:{phase:'preencher',vehicle:v}})", VEH)
        await pg.wait_for_function("window.__msgs.some(m=>m.cmd==='filled')", timeout=60000)
        got = await pg.evaluate('results()')
        await b.close()
    bad = {k: (got.get(k), v) for k, v in EXPECTED.items() if got.get(k) != v}
    print('OK' if not bad else 'FALHAS: ' + json.dumps(bad, ensure_ascii=False))
    raise SystemExit(1 if bad else 0)

asyncio.run(main())
