// Real Chromium input and DOM fixture with mocked extension storage; no live ChatGPT session.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const playwright=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')):require('playwright');
const root=path.resolve(__dirname,'..'),R=String.raw;
(async()=>{
  const browser=await playwright.chromium.launch({executablePath:process.env.TEX_BROWSER_EXECUTABLE||undefined,headless:true,args:['--no-sandbox','--disable-gpu','--no-zygote']});
  try {
    const context=await browser.newContext({viewport:{width:1100,height:850}}), errors=[],requests=[];
    context.on('page',page=>page.on('pageerror',e=>errors.push(e.message)));
    await context.addInitScript(()=>{
      const data={},listeners=[];globalThis.testSettings=data;
      globalThis.chrome={runtime:{},storage:{local:{get:(defaults,cb)=>cb({...defaults,...data}),set(values){const changes={};for(const [k,v]of Object.entries(values)){changes[k]={newValue:v};data[k]=v;}listeners.forEach(l=>l(changes,'local'));}},onChanged:{addListener:l=>listeners.push(l)}}};
    });
    await context.route('**/*',route=>{
      const u=new URL(route.request().url());
      if(u.hostname==='fixture.test')return route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ja"><meta charset="utf-8"><style>body{font:16px system-ui}#editors{position:fixed;bottom:35px;left:100px;width:700px}textarea,#rich{box-sizing:border-box;width:100%;padding:15px;min-height:90px;border:1px solid #aaa}#rich p{margin:0}</style><article data-message-author-role="assistant"><p id="formula-a"></p><p id="formula-b"></p></article><article data-message-author-role="assistant"><p id="formula-c"></p></article><div id="editors"><textarea id="plain"></textarea><div id="rich" contenteditable="true" role="textbox"></div><button id="after">次へ</button></div></html>`});
      if(u.hostname==='extension.test'){const f=path.join(root,u.pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f))return route.abort();return route.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.html')?'text/html':f.endsWith('.css')?'text/css':'text/javascript'});}
      requests.push(u.href);return route.abort();
    });
    const page=await context.newPage();await page.goto('https://fixture.test/');
    for(const f of JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).content_scripts[0].js)await page.addScriptTag({path:path.join(root,f)});
    const menu=page.locator('#tex-completion-host'),preview=page.locator('#tex-symbol-preview-host');
    const settle=()=>page.waitForTimeout(210);
    const selection=()=>page.evaluate(()=>{const e=document.activeElement;return e instanceof HTMLTextAreaElement?e.value.slice(e.selectionStart,e.selectionEnd):getSelection().toString();});
    for(const id of ['plain','rich']){
      const editor=page.locator('#'+id), read=()=>editor.evaluate(e=>e instanceof HTMLTextAreaElement?e.value:e.textContent.replace(/\u00a0/g,' '));
      await editor.fill('');await editor.pressSequentially(R`\fr`);await settle();
      assert(await menu.isVisible());assert(!(await preview.isVisible()));
      assert.equal(await menu.getByRole('option').first().textContent(),R`\frac分数`);
      if(id==='plain'&&process.env.TEX_SCREENSHOT_DIR){fs.mkdirSync(process.env.TEX_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'completion.png')});}
      await page.keyboard.press('Tab');assert.equal(await read(),R`\frac{a}{b}`);assert.equal(await selection(),'a');
      await page.keyboard.type('x^2');await page.keyboard.press('Tab');assert.equal(await selection(),'b');
      await page.keyboard.type('y');await page.keyboard.press('Shift+Tab');assert.equal(await selection(),'x^2');
      await page.keyboard.press('Tab');assert.equal(await selection(),'y');await page.keyboard.press('Tab');await page.keyboard.type('+1');
      assert.equal(await read(),R`\frac{x^2}{y}+1`);await settle();assert(await preview.isVisible());
      // Nested snippets return to the outer denominator, then finish after the outer formula.
      await editor.fill(R`\fr`);await page.keyboard.press('Tab');await page.keyboard.type(R`\sq`);await page.keyboard.press('Tab');
      assert.equal(await selection(),'x');await page.keyboard.type('z');await page.keyboard.press('Tab');assert.equal(await selection(),'b');
      await page.keyboard.type('2');await page.keyboard.press('Tab');await page.keyboard.type('=0');assert.equal(await read(),R`\frac{\sqrt{z}}{2}=0`);
      // TeX stays TeX on Tab; the existing Space conversion remains available.
      await editor.fill(R`\alp`);await page.keyboard.press('Tab');assert.equal(await read(),R`\alpha`);await page.keyboard.press('Space');assert.equal(await read(),'α');
      await editor.fill(R`\sq`);await settle();await page.keyboard.press('Escape');await settle();assert(!(await menu.isVisible()));
      await editor.fill(R`\fr`);await editor.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
      await page.keyboard.press('Tab');assert.equal(await read(),R`\fr`);
      await editor.focus();await editor.evaluate(e=>e.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await settle();
      await menu.getByRole('option').first().click();assert.equal(await selection(),'a');assert.equal(await read(),R`\frac{a}{b}`);
      await page.keyboard.press('Escape');
      // Moving outside a placeholder stops intercepting Tab.
      await editor.fill(R`\fr`);await page.keyboard.press('Tab');await page.keyboard.press('Control+Home');await page.keyboard.press('Tab');
      assert.notEqual(await page.evaluate(()=>document.activeElement.id),id);
    }
    const plain=page.locator('#plain'),rich=page.locator('#rich');
    await rich.fill('');await rich.pressSequentially(R`\fr`);await settle();await page.keyboard.press('Tab');await page.keyboard.press('Control+z');
    assert.equal(await rich.innerText(),R`\fr`,'completion is a single undoable insertion');
    await rich.evaluate(e=>{e.innerHTML='<p>前の段落</p><p>\\fr</p>';const r=document.createRange();r.selectNodeContents(e.lastChild);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);});
    await page.keyboard.press('Tab');assert.equal(await selection(),'a');await page.keyboard.type('u');await page.keyboard.press('Tab');await page.keyboard.type('v');
    assert.equal(await rich.evaluate(e=>e.firstChild.textContent),'前の段落');assert.equal(await rich.evaluate(e=>e.lastChild.textContent),R`\frac{u}{v}`);
    await plain.fill(R`\s`);await settle();await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');assert.equal(await plain.inputValue(),R`\sum_{n=1}^{N} a_n`);
    await plain.fill(R`\s`);await settle();await page.keyboard.type('um');await page.keyboard.press('Tab');assert.equal(await plain.inputValue(),R`\sum_{n=1}^{N} a_n`,'Tab refreshes stale candidates immediately');
    await page.evaluate(()=>chrome.storage.local.set({completionEnabled:false}));await plain.fill(R`\fr`);await settle();assert(!(await menu.isVisible()));await page.keyboard.press('Tab');assert.equal(await plain.inputValue(),R`\fr`);
    await page.evaluate(()=>chrome.storage.local.set({completionEnabled:true}));
    await plain.fill(R`\fr`);await plain.evaluate(e=>{e.readOnly=true;});await page.keyboard.press('Tab');assert.equal(await plain.inputValue(),R`\fr`);await plain.evaluate(e=>{e.readOnly=false;});
    await page.evaluate(()=>{katex.render('x^2+2x+1',document.querySelector('#formula-a'));katex.render('x^2-2x+1',document.querySelector('#formula-b'));katex.render(String.raw`\frac{a}{b}`,document.querySelector('#formula-c'));});
    await page.getByRole('button',{name:'数式を比較',exact:true}).first().click();
    const diff=page.locator('#tex-diff-host');
    assert.equal(await diff.locator('math').count(),2);assert.equal(await diff.locator('#diff-choice-A option').count(),4,'includes formulas from another answer');
    assert.equal(await diff.locator('.removed').first().textContent(),'+');assert.equal(await diff.locator('.added').first().textContent(),'-');
    await diff.locator('#diff-choice-B').selectOption('2');assert.equal(await diff.locator('mfrac').count(),1);
    await diff.getByLabel('TeX A',{exact:true}).fill('x + y');await diff.getByLabel('TeX B',{exact:true}).fill('x+y');await settle();assert.match(await diff.getByRole('status').textContent(),/一致/);
    await diff.locator('#diff-ignore-space').uncheck();assert.match(await diff.getByRole('status').textContent(),/削除 2/);
    await diff.getByRole('button',{name:'AとBを入れ替え'}).click();assert.equal(await diff.getByLabel('TeX A',{exact:true}).inputValue(),'x+y');assert.match(await diff.getByRole('status').textContent(),/追加 2/);
    await diff.getByLabel('TeX B',{exact:true}).fill(R`\notarealcommand{x}`);await settle();assert.equal(await diff.locator('.math.error').count(),1);assert(await diff.locator('pre').last().textContent());
    await diff.getByLabel('TeX B',{exact:true}).fill('x'.repeat(8001));await settle();assert.match(await diff.getByRole('status').textContent(),/8,000/);assert.equal(await diff.locator('pre').last().textContent(),'');
    await diff.getByLabel('TeX A',{exact:true}).fill(R`\frac{x^2+1}{y}`);await diff.getByLabel('TeX B',{exact:true}).fill(R`\frac{x^2-1}{y}`);await settle();
    if(process.env.TEX_SCREENSHOT_DIR){fs.mkdirSync(process.env.TEX_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'diff-desktop.png')});}
    await page.setViewportSize({width:390,height:844});await settle();
    assert(await diff.locator('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no horizontal dialog overflow');
    if(process.env.TEX_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'diff-mobile.png')});
    await page.keyboard.press('Escape');await diff.locator('textarea').first().waitFor({state:'detached'});assert(!(await diff.locator('dialog').isVisible()));assert.equal(await diff.locator('textarea').count(),0,'closed comparison releases its contents');
    await page.evaluate(()=>document.querySelectorAll('[data-message-author-role]').forEach(e=>e.removeAttribute('data-message-author-role')));await page.waitForTimeout(450);
    await page.locator('#tex-bookmark-fallback').getByRole('button',{name:'数式を比較'}).click();assert.equal(await diff.locator('math').count(),2);
    await diff.getByRole('button',{name:'閉じる',exact:true}).click();
    const standalone=await context.newPage();await standalone.goto('https://extension.test/compare.html');
    await standalone.getByLabel('TeX A',{exact:true}).fill('a+b');await standalone.getByLabel('TeX B',{exact:true}).fill('a-b');await standalone.waitForTimeout(200);assert.equal(await standalone.locator('math').count(),2);
    assert.match(await standalone.getByRole('status').textContent(),/削除 1.*追加 1/);
    assert.deepEqual(await page.evaluate(()=>testSettings),{completionEnabled:true},'formula contents are never saved');
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
    console.log('Chromium '+browser.version()+': completion, nested Tab stops, undo, IME, settings, cross-answer/fallback/standalone diffs, limits and responsive layout passed.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
