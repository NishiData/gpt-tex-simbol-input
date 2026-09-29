// Optional integration test: requires Playwright and a Chromium executable.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const playwright = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')) : require('playwright');
const root = path.resolve(__dirname, '..');
const R = String.raw;
const storageShim = () => {
  const listeners = [];
  const settings = {};
  globalThis.chrome ||= {};
  chrome.storage = {
    local: {
      get(defaults, cb) { cb({...defaults, ...settings}); },
      set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) { changes[key] = {oldValue: settings[key], newValue: value}; settings[key] = value; }
        for (const listener of listeners) listener(changes, 'local');
      }
    },
    onChanged: {addListener(listener) { listeners.push(listener); }}
  };
  globalThis.testSettings = settings;
};
(async () => {
  const browser = await playwright.chromium.launch({
    executablePath: process.env.TEX_BROWSER_EXECUTABLE || undefined,
    headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--no-zygote']
  });
  const page = await browser.newPage({viewport: {width: 1100, height: 850}});
  const errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => requests.push(r.url()));
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body {font:16px system-ui;margin:0;background:#fafafa;color:#20252b;}
    header {padding:25px 40px;border-bottom:1px solid #ddd;background:white;}
    main {max-width:730px;margin:40px auto;line-height:1.7;}
    .compose {position:fixed;bottom:45px;left:50%;transform:translateX(-50%);width:min(720px,calc(100vw - 48px));}
    #rich,textarea {box-sizing:border-box;width:100%;min-height:100px;padding:20px;background:white;border:1px solid #ccc;border-radius:15px;font:16px/1.7 system-ui;outline:none;}
    #rich p {margin:0;} textarea {display:none;}
  </style></head><body><header>TeX 記号入力 ＋ 数式プレビュー</header><main>入力テスト用の画面です。<br>数式プレビューは入力欄の上に表示されます。</main>
  <div class="compose"><div id="rich" contenteditable="true" role="textbox"><p></p></div><textarea id="plain"></textarea></div></body></html>`);
  await page.evaluate(storageShim);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const script of manifest.content_scripts[0].js) await page.addScriptTag({path: path.join(root, script)});
  const rich = page.locator('#rich');
  const panel = page.locator('#tex-symbol-preview-host');
  async function visibleMath(selector) { await page.waitForFunction(s => !!document.querySelector('#tex-symbol-preview-host')?.shadowRoot?.querySelector(s), selector); }
  async function settle() { await page.waitForTimeout(180); }
  await rich.fill(R`\frac{a}{b}`); await visibleMath('mfrac');
  assert.equal(await rich.innerText(), R`\frac{a}{b}`);
  assert.equal(await panel.isVisible(), true);
  await rich.fill(R`\alpha`); await rich.press('End'); await page.keyboard.press('Space'); await settle();
  assert.equal(await rich.innerText(), 'α'); assert.equal(await panel.locator('math').count(), 1);
  await rich.fill(R`\alpha`); await page.keyboard.press('Shift+Space'); await settle();
  assert.equal((await rich.innerText()).replace(/\u00a0/g, ' '), R`\alpha `);
  await rich.fill(R`\alpha`);
  await rich.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true})));
  await page.keyboard.press('Space');
  assert.equal((await rich.innerText()).replace(/\u00a0/g, ' '), R`\alpha `);
  await rich.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true})));
  await rich.fill(R`この式 $\frac{a}{b}$ と $x_i^2$ を説明して`); await visibleMath('msubsup');
  assert.equal(await panel.locator('math').count(), 2);
  await rich.fill(R`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`); await visibleMath('mtable');
  assert.equal(await panel.locator('mtr').count(), 2);
  await rich.fill(R`\frac{a}{`); await settle();
  assert.equal(await panel.locator('.error').count(), 1);
  await rich.fill(R`\frac{a}{b}`); await visibleMath('mfrac');
  await rich.fill(R`√{a+b}`); await visibleMath('msqrt');
  for (const unsafe of [R`\includegraphics{https://example.invalid/secret}`, R`\href{javascript:alert(1)}{x}`, R`\text{<img src=x onerror=alert(1)>}`]) {
    await rich.fill(unsafe); await settle();
    assert.equal(await panel.locator('img, iframe, script, a').count(), 0);
  }
  assert.equal(requests.length, 0, 'all resources are local / injected test scripts');
  await rich.fill('普通の文章'); await settle(); assert.equal(await panel.isVisible(), false);
  await rich.fill('```tex\n$x$\n```'); await settle(); assert.equal(await panel.isVisible(), false);
  await page.evaluate(() => chrome.storage.local.set({previewMode: 'math'}));
  await rich.fill('x'); await visibleMath('math');
  await page.evaluate(() => chrome.storage.local.set({previewMode: 'auto', previewEnabled: false}));
  await rich.fill(R`\alpha`); await page.keyboard.press('Space'); await settle();
  assert.equal(await rich.innerText(), 'α'); assert.equal(await panel.isVisible(), false);
  await page.evaluate(() => chrome.storage.local.set({previewEnabled: true, enabled: false}));
  await rich.fill(R`\alpha`); await page.keyboard.press('Space'); await settle();
  assert.equal((await rich.innerText()).replace(/\u00a0/g, ' '), R`\alpha `);
  assert.equal(await panel.isVisible(), true);
  await page.evaluate(() => chrome.storage.local.set({enabled: true}));
  await rich.fill('x'.repeat(8001)); await settle();
  assert.match(await panel.locator('#body').innerText(), /8,000|8000/);
  await rich.fill(''); await settle(); assert.equal(await panel.isVisible(), false);
  // Exercise real native textarea editing as well as contenteditable.
  await page.evaluate(() => {document.querySelector('#rich').style.display='none';document.querySelector('#plain').style.display='block';});
  const plain = page.locator('#plain');
  await plain.fill(R`x=\alpha + y`); await plain.evaluate(e => e.setSelectionRange(8,8));
  await page.keyboard.press('Space'); await settle();
  assert.equal(await plain.inputValue(), 'x=α + y');
  await plain.fill(R`\frac{a}{b}`); await visibleMath('mfrac');
  assert.equal(await plain.inputValue(), R`\frac{a}{b}`);
  await page.evaluate(() => {document.querySelector('#rich').style.display='block';document.querySelector('#plain').style.display='none';});
  await rich.fill(R`\frac{a}{b} + \sqrt{x^2+y^2} = \sum_{n=1}^{\infty}\frac{1}{n^2}`); await visibleMath('mfrac'); await settle();
  const original = await rich.innerText();
  await panel.getByRole('button', {name: 'プレビューを折りたたむ'}).click();
  assert.equal(await panel.locator('#body').isVisible(), false);
  await panel.getByRole('button', {name: 'プレビューを展開する'}).click();
  assert.equal(await rich.innerText(), original);
  const editorBox = await rich.boundingBox(), panelBox = await panel.boundingBox();
  assert(panelBox.y + panelBox.height <= editorBox.y, 'panel is above editor');
  if (process.env.TEX_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.TEX_SCREENSHOT_DIR, {recursive: true});
    await page.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'preview-light.png')});
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.setViewportSize({width:520,height:760}); await settle();
    await page.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'preview-narrow.png')});
  }
  await panel.getByRole('button', {name: 'プレビューをオフ', exact: true}).click();
  assert.equal(await panel.isVisible(), false);
  assert.equal(await page.evaluate(() => testSettings.previewEnabled), false);
  assert.deepEqual(errors, []);
  const settings = await page.evaluate(() => testSettings);
  assert(Object.keys(settings).every(k => ['enabled', 'previewEnabled', 'previewMode'].includes(k)));
  const popup = await browser.newPage({viewport:{width:380,height:900}});
  await popup.setContent(fs.readFileSync(path.join(root,'popup.html'),'utf8').replace(/<script[^>]*><\/script>/g,''));
  await popup.evaluate(storageShim);
  await popup.addStyleTag({path:path.join(root,'popup.css')});
  for(const file of ['symbols.js','popup.js']) await popup.addScriptTag({path:path.join(root,file)});
  await popup.locator('#search').fill('tau');
  assert.equal(await popup.locator('#symbols tr').count(),1);
  await popup.locator('#preview-enabled').uncheck();
  assert.equal(await popup.evaluate(()=>testSettings.previewEnabled),false);
  await popup.locator('#preview-mode').selectOption('mixed');
  assert.equal(await popup.evaluate(()=>testSettings.previewMode),'mixed');
  await popup.locator('#completion-enabled').uncheck();
  assert.equal(await popup.evaluate(()=>testSettings.completionEnabled),false);
  assert.equal(await popup.getByRole('link',{name:'数式の差分比較を開く'}).getAttribute('href'),'compare.html');
  console.log('Chromium '+browser.version()+': rich text, textarea, live preview, IME guard, settings, popup, layout and no external requests passed.');
  await browser.close();
})().catch(error => {console.error(error); process.exit(1);});
