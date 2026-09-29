// Local browser fixture: tests our UI and storage interactions, not ChatGPT's live DOM.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const B = require('../bookmarks-core.js');
const playwright = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright')) : require('playwright');
const root = path.resolve(__dirname, '..');
const base = {id:'test-1',kind:'formula',title:'分数',text:String.raw`\frac{a}{b}`,createdAt:1,sourceUrl:'https://chatgpt.com/c/test?secret=123#hash'};
assert.equal(B.validate(base).sourceUrl,'https://chatgpt.com/c/test');
for (const url of ['javascript:alert(1)','https://chatgpt.com.evil.test/c/x','https://evil.test/c/x','https://user@chatgpt.com/c/x','http://chatgpt.com/c/x','https://chatgpt.com/']) assert.equal(B.sourceURL(url),'');
for (const invalid of [{...base,id:undefined},{...base,title:''},{...base,kind:'html'},{...base,text:'x'.repeat(8001)},{...base,createdAt:NaN}]) assert.throws(()=>B.validate(invalid));
assert.throws(()=>B.parseBackup(JSON.stringify({format:'tex-symbol-bookmarks',version:1,bookmarks:[base,base]})));
assert(B.matches(B.validate(base),'FRAC','formula'));
// Validate the privileged handler independently from the page-side storage shim.
let listener, opened = [];
const runtime = {id:'test-extension',getURL:file=>'chrome-extension://test-extension/'+file,onMessage:{addListener:cb=>{listener=cb;}}};
vm.runInNewContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),{URL,chrome:{runtime,tabs:{create:(arg,cb)=>{opened.push(arg.url);cb();}}}});
for(const sender of [{id:'other',url:'https://chatgpt.com/c/test'},{id:runtime.id,url:'https://evil.test/'},{id:runtime.id,url:'invalid'}]) listener({action:'openBookmarks'},sender,()=>assert.fail('untrusted sender'));
assert.equal(opened.length,0);
listener({action:'openBookmarks',url:'https://evil.test/'},{id:runtime.id,url:'https://chatgpt.com/c/test'},result=>assert.equal(result.ok,true));
assert.deepEqual(opened,['chrome-extension://test-extension/bookmarks.html']);

(async()=>{
  const browser = await playwright.chromium.launch({executablePath:process.env.TEX_BROWSER_EXECUTABLE || undefined,headless:true,args:['--no-sandbox','--disable-gpu','--disable-software-rasterizer','--no-zygote']});
  const context = await browser.newContext({viewport:{width:1100,height:850}});
  // Simulate extension-local storage across tabs with callback errors and change events.
  const stored = {}, requests = [], errors = [];
  let quota = false;
  await context.exposeBinding('testStorage',async({page},method,arg)=>{
    if (method==='get') return arg===null ? structuredClone(stored) : typeof arg==='string' ? {[arg]:stored[arg]} : {...arg,...stored};
    if (method==='set' && quota) return {error:'QUOTA_BYTES quota exceeded'};
    const changes = {};
    if (method==='set') for(const [key,value] of Object.entries(arg)) { changes[key]={oldValue:stored[key],newValue:value};stored[key]=value; }
    if (method==='remove') { changes[arg]={oldValue:stored[arg]};delete stored[arg]; }
    for(const p of context.pages()) await p.evaluate(changes=>globalThis.testStorageListeners?.forEach(cb=>cb(changes,'local')),changes);
    return {};
  });
  await context.addInitScript(()=>{
    globalThis.testStorageListeners=[];
    globalThis.chrome={runtime:{getURL:file=>'https://extension.test/'+file,sendMessage:(message,cb)=>{globalThis.testMessage=message;cb({ok:true});}},storage:{local:{},onChanged:{addListener:cb=>testStorageListeners.push(cb)}}};
    for(const method of ['get','set','remove']) chrome.storage.local[method]=(arg,cb)=>testStorage(method,arg).then(result=>{
      if(result?.error) chrome.runtime.lastError={message:result.error};
      cb?.(result); delete chrome.runtime.lastError;
    });
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{globalThis.copied=text;}}});
  });
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.hostname==='chatgpt.com') return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ja"><meta charset="utf-8"><title>分数の説明</title><style>body{max-width:760px;margin:40px auto;font:16px/1.7 system-ui}textarea{width:95%;height:80px;margin-top:30px}</style><article><div data-message-author-role="assistant" data-message-id="message-1"><div class="markdown"><p>分数の説明です。</p><p id="math-1"></p><p>もう一つの式：</p><p id="math-2"></p><pre><code>const x = 1;</code></pre></div></div></article><textarea aria-label="入力欄"></textarea></html>'});
    if(url.hostname==='extension.test') {
      const file=path.join(root,url.pathname);
      if(!file.startsWith(root+path.sep) || !fs.existsSync(file)) return route.abort();
      return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.html')?'text/html':file.endsWith('.css')?'text/css':'text/javascript'});
    }
    requests.push(url.href); return route.abort();
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://chatgpt.com/c/test');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  for(const file of manifest.content_scripts[0].js) await page.addScriptTag({path:path.join(root,file)});
  await page.evaluate(()=>{
    katex.render(String.raw`\frac{a}{b}`,document.getElementById('math-1'),{displayMode:true});
    katex.render('x_i^2',document.getElementById('math-2'));
  });
  assert.deepEqual(stored,{},'visiting an answer never stores conversation contents');
  await page.getByRole('button',{name:'一覧',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>testMessage),{action:'openBookmarks'});
  const ui=page.locator('#tex-bookmark-ui');
  await page.getByRole('button',{name:'☆ 回答を保存',exact:true}).click();
  assert.match(await ui.locator('pre').innerText(),/分数の説明です/);
  assert.equal((await ui.locator('pre').innerText()).split(String.raw`\frac{a}{b}`).length,2,'one TeX copy, not duplicated MathML/HTML');
  await ui.getByLabel('名前',{exact:true}).fill('分数の説明');
  await ui.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('dialog').open);
  assert.equal(Object.keys(stored).length,1);
  const answer=Object.values(stored)[0];
  assert.equal(answer.messageId,'message-1');assert.equal(answer.kind,'answer');
  assert(!answer.text.includes('回答を保存'));assert(answer.text.includes('const x = 1;'));
  await page.getByRole('button',{name:'数式を保存',exact:true}).click();
  assert.equal(await ui.locator('.preview mfrac').count(),1);
  const chooser=ui.getByRole('button',{name:'保存する数式（2個）',exact:true});
  await chooser.click();
  assert.equal(await ui.getByRole('option').count(),2);
  const initialName=await ui.getByLabel('名前',{exact:true}).inputValue();
  await ui.getByRole('option').nth(1).hover();
  assert.equal(await ui.locator('.picker-math msubsup').count(),1,'hover renders the pointed formula');
  assert.equal(await ui.locator('pre').innerText(),String.raw`\frac{a}{b}`,'hover does not change the formula to save');
  assert.equal(await ui.getByLabel('名前',{exact:true}).inputValue(),initialName,'hover keeps the bookmark name');
  assert.equal(await ui.getByRole('option').nth(0).getAttribute('aria-selected'),'true');
  assert.equal(Object.keys(stored).length,1,'hover does not write to storage');
  await ui.getByRole('option').nth(1).click();
  assert.equal(await chooser.getAttribute('aria-expanded'),'false');
  assert.equal(await ui.locator('.preview msubsup').count(),1,'click commits the choice');
  await chooser.click();
  await ui.getByRole('listbox').press('ArrowUp');
  assert.equal(await ui.locator('.picker-math mfrac').count(),1,'keyboard movement previews without selecting');
  await ui.getByRole('listbox').press('Escape');
  assert.equal(await ui.locator('pre').innerText(),'x_i^2','Escape preserves the earlier selection');
  await chooser.click();
  await ui.getByRole('listbox').press('Home');
  await ui.getByRole('listbox').press('Enter');
  assert.equal(await ui.locator('pre').innerText(),String.raw`\frac{a}{b}`);
  await ui.getByLabel('名前',{exact:true}).fill('基本の分数');
  quota=true;
  await ui.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('.status').textContent.includes('容量'));
  assert.equal(Object.keys(stored).length,1,'failed save is never reported as saved');
  quota=false;
  await ui.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('dialog').open);
  assert.equal(Object.keys(stored).length,2);
  const formula=Object.values(stored).find(r=>r.kind==='formula');
  const manager=await context.newPage(); manager.on('pageerror',e=>errors.push(e.message));
  await manager.goto('https://extension.test/bookmarks.html');
  await manager.waitForFunction(()=>document.querySelectorAll('.card').length===2);
  await manager.getByLabel('種類で絞り込む').selectOption('formula');
  assert.equal(await manager.locator('.card').count(),1);
  await manager.getByRole('button',{name:'TeXをコピー'}).click();
  assert.equal(await manager.evaluate(()=>copied),String.raw`\frac{a}{b}`);
  await manager.getByLabel('ブックマークを検索').fill('FRAC');
  assert.equal(await manager.locator('.card').count(),1);
  await manager.getByLabel('ブックマークを検索').fill('存在しない');
  assert.equal(await manager.locator('.card').count(),0);
  await manager.getByLabel('ブックマークを検索').fill('');
  await manager.getByRole('button',{name:'名前を変更'}).click();
  await manager.getByLabel('ブックマークの名前').fill('比率 <img src=x onerror=alert(1)>');
  await manager.getByRole('button',{name:'変更を保存'}).click();
  await manager.waitForFunction(()=>document.querySelector('h2')?.textContent.startsWith('比率'));
  assert.equal(await manager.locator('img').count(),0,'saved title stays plain text');
  await manager.reload();
  await manager.waitForFunction(()=>document.querySelectorAll('.card').length===2);
  assert.equal(await manager.getByRole('link',{name:'元の会話を開く'}).first().getAttribute('href'),'https://chatgpt.com/c/test#tex-bookmark='+formula.id);
  await page.evaluate(id=>{location.hash='tex-bookmark='+id;},formula.id);
  await page.waitForFunction(()=>document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('.toast').textContent.includes('移動しました'));
  const downloadPromise=manager.waitForEvent('download');
  await manager.getByRole('button',{name:'バックアップ',exact:true}).click();
  const download=await downloadPromise;
  const backup=fs.readFileSync(await download.path(),'utf8');
  assert.equal(B.parseBackup(backup).length,2);
  await manager.getByLabel('種類で絞り込む').selectOption('formula');
  await manager.getByRole('button',{name:'削除',exact:true}).click();
  await manager.getByRole('button',{name:'やめる',exact:true}).click();
  assert.equal(Object.keys(stored).length,2);
  await manager.getByRole('button',{name:'削除',exact:true}).click();
  await manager.getByRole('button',{name:'削除する',exact:true}).click();
  await manager.waitForFunction(()=>document.querySelectorAll('.card').length===0);
  assert.equal(Object.keys(stored).length,1);
  await manager.locator('#import-file').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
  await manager.waitForFunction(()=>document.querySelector('#status').textContent.includes('1 件を復元しました'));
  assert.equal(Object.keys(stored).length,2);
  // Streaming/new answer and no-TeX fallback.
  await page.evaluate(()=>{const answer=document.createElement('div');answer.dataset.messageAuthorRole='assistant';answer.textContent='数式のない回答';document.body.append(answer);});
  await page.waitForFunction(()=>document.querySelectorAll('.tex-bookmark-bar').length===2);
  await page.getByRole('button',{name:'数式を保存',exact:true}).last().click();
  await page.waitForFunction(()=>document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('.toast').textContent.includes('TeX原文'));
  assert.equal(Object.keys(stored).length,2);
  if(process.env.TEX_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.TEX_SCREENSHOT_DIR,{recursive:true});
    await manager.getByLabel('種類で絞り込む').selectOption('all');
    await manager.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'bookmarks-light.png'),fullPage:true});
    await manager.emulateMedia({colorScheme:'dark'});
    await manager.setViewportSize({width:390,height:844});
    await manager.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'bookmarks-narrow.png'),fullPage:true});
  }
  // Reproduce the reported Work condition: no assistant markers, eight TeX annotations.
  const work=await context.newPage(); work.on('pageerror',e=>errors.push(e.message));
  await work.goto('https://chatgpt.com/c/work-test');
  await work.evaluate(()=>{document.body.innerHTML='<main id="work-messages"></main>';});
  for(const file of manifest.content_scripts[0].js) await work.addScriptTag({path:path.join(root,file)});
  await work.evaluate(()=>{
    for(let i=1;i<=8;i++) {
      const message=document.createElement('section');
      message.id='work-formula-'+i;document.getElementById('work-messages').append(message);
      katex.render('x_{'+i+'}',message,{output:'mathml',displayMode:true});
    }
  });
  assert.equal(await work.locator('[data-message-author-role="assistant"]').count(),0);
  assert.equal(await work.locator('annotation[encoding="application/x-tex"]').count(),8);
  const floating=work.locator('#tex-bookmark-fallback');
  await floating.getByRole('button',{name:'数式を保存（8）',exact:true}).waitFor();
  const box=await floating.boundingBox();
  assert(box && box.x>=0 && box.y>=0 && box.x+box.width<=1100 && box.y+box.height<=850,'fallback stays in the viewport');
  assert.equal(Object.keys(stored).length,2,'discovery does not store page contents');
  assert.equal(await work.getByRole('button',{name:'☆ 回答を保存',exact:true}).count(),0,'unknown boundary never saves the whole page as an answer');
  await floating.getByRole('button',{name:'数式を保存（8）',exact:true}).click();
  const workUI=work.locator('#tex-bookmark-ui');
  await workUI.getByRole('button',{name:'保存する数式（8個）',exact:true}).click();
  assert.equal(await workUI.getByRole('option').count(),8);
  await workUI.getByRole('option').nth(7).hover();
  assert.equal(await workUI.locator('.picker-inspect strong').innerText(),'数式 8 のプレビュー');
  assert.equal(await workUI.locator('pre').innerText(),'x_{1}','Work hover does not commit the choice');
  await workUI.getByRole('option').nth(7).click();
  assert.equal(await workUI.locator('pre').innerText(),'x_{8}');
  await workUI.getByLabel('名前',{exact:true}).fill('Workの8番目の式');
  await workUI.getByRole('button',{name:'保存',exact:true}).click();
  await work.waitForFunction(()=>!document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('dialog').open);
  const workRecord=Object.values(stored).find(r=>r.title==='Workの8番目の式');
  assert(workRecord);assert.equal(workRecord.text,'x_{8}');assert.equal(workRecord.kind,'formula');
  assert.equal(workRecord.messageId,'');assert.equal(workRecord.sourceUrl,'https://chatgpt.com/c/work-test');
  await floating.getByRole('button',{name:'一覧',exact:true}).click();
  assert.deepEqual(await work.evaluate(()=>testMessage),{action:'openBookmarks'});
  await work.evaluate(id=>{location.hash='tex-bookmark='+id;},workRecord.id);
  await work.waitForFunction(()=>document.querySelector('#tex-bookmark-ui').shadowRoot.querySelector('.toast').textContent.includes('移動しました'));
  // Repeated math, code examples and editing fields do not add choices.
  await work.evaluate(()=>{
    for(const [tag,editable,tex] of [['div',false,'x_{1}'],['code',false,'code_only'],['div',true,'draft_only']]) {
      const el=document.createElement(tag); if(editable) el.contentEditable='true';
      document.getElementById('work-messages').append(el);katex.render(tex,el,{output:'mathml'});
    }
    window.testUpdates=setInterval(()=>document.getElementById('work-messages').append(document.createTextNode('.')),40);
    const el=document.createElement('section');document.getElementById('work-messages').append(el);
    katex.render('x_{9}',el,{output:'mathml'});
  });
  await floating.getByRole('button',{name:'数式を保存（9）',exact:true}).waitFor({timeout:2000});
  await work.evaluate(()=>clearInterval(window.testUpdates));
  // If the host removes our floating panel, it is re-created without duplication.
  await work.evaluate(()=>document.querySelector('#tex-bookmark-fallback').remove());
  await floating.getByRole('button',{name:'数式を保存（9）',exact:true}).waitFor();
  assert.equal(await floating.count(),1);
  await work.evaluate(()=>document.getElementById('work-messages').replaceChildren());
  await floating.waitFor({state:'hidden'});
  assert.equal(Object.keys(stored).length,3,'only the chosen formula was saved');
  // The reported long menu: render only the hovered preview, even with 106 choices.
  await work.evaluate(()=>{
    for(let i=1;i<=106;i++) {
      const el=document.createElement('section');document.getElementById('work-messages').append(el);
      const tex=i===97 ? String.raw`\boxed{m_{\mathrm{SUSY}}=e^{K/2}\frac{4ty}{\sqrt{3}}|D_SD_uW|}` : 'x_{'+i+'}';
      katex.render(tex,el,{output:'mathml'});
    }
  });
  await floating.getByRole('button',{name:'数式を保存（106）',exact:true}).click();
  const longChooser=workUI.getByRole('button',{name:'保存する数式（106個）',exact:true});
  await longChooser.click();
  await workUI.getByRole('option').nth(96).hover();
  assert.equal(await workUI.locator('.picker-inspect strong').innerText(),'数式 97 のプレビュー');
  assert.equal(await workUI.locator('.picker-math math').count(),1,'only one hover preview is rendered');
  assert.equal(await workUI.locator('.picker-math mfrac').count(),1);
  assert.equal(await workUI.locator('pre').innerText(),'x_{1}','long-menu hover does not select or save');
  assert(await workUI.locator('.picker-list').evaluate(el=>el.scrollTop>0),'long menu scrolls to hovered row');
  if(process.env.TEX_SCREENSHOT_DIR) await work.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'formula-hover.png')});
  await work.setViewportSize({width:390,height:844});
  await workUI.getByRole('option').nth(96).hover();
  const smallBox=await workUI.locator('dialog').boundingBox();
  assert(smallBox.x>=0 && smallBox.x+smallBox.width<=390,'narrow dialog fits the viewport');
  assert(await workUI.locator('.picker-inspect').isVisible(),'hover preview remains available on narrow windows');
  if(process.env.TEX_SCREENSHOT_DIR) await work.screenshot({path:path.join(process.env.TEX_SCREENSHOT_DIR,'formula-hover-narrow.png')});
  await workUI.getByRole('listbox').focus();
  await workUI.getByRole('listbox').press('Escape');
  assert.equal(await longChooser.getAttribute('aria-expanded'),'false');
  await workUI.getByRole('button',{name:'キャンセル',exact:true}).click();
  assert.equal(Object.keys(stored).length,3,'previewing 106 formulas leaves storage unchanged');
  assert.deepEqual(requests,[],'no external resources requested');
  assert.deepEqual(errors,[],'no uncaught browser errors');
  console.log('Chromium '+browser.version()+': existing bookmarks, Work fallback, hover without selection, click/keyboard selection, Escape, 106-formula scrolling and narrow preview passed.');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
