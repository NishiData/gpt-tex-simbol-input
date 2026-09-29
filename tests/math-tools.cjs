const assert=require('node:assert/strict');
const C=require('../completion-core.js'), D=require('../diff-core.js');
const R=String.raw;
for(const [name,,template] of C.templates) {
  const {text,slots}=C.expand(template);
  assert(!text.includes('${'),name);
  assert(slots.length>0);
  let end=0;for(const slot of slots){assert(slot.start>=end&&slot.end>slot.start&&slot.end<=text.length,name);end=slot.end;}
}
const frac=C.candidates('fr')[0];
assert.equal(frac.text,R`\frac{a}{b}`);
assert.deepEqual(frac.slots.map(s=>frac.text.slice(s.start,s.end)),['a','b']);
assert.equal(C.match(R`$\fr`).query,'fr');
for(const text of [R`\\fr`,R`\fr `,R`plain`,`\n`])assert.equal(C.match(text),null);
assert.equal(C.match(R`\fr`,'ac'),null);assert.equal(C.match(R`\frac`,'{'),null);
assert.equal(C.candidates('alp',{alpha:'α'})[0].text,R`\alpha`);
assert.equal(C.candidates('alpha',{alpha:'α'}).length,0);
assert.equal(C.candidates('FR').length,0);
let d=D.compare('x^2+2x+1','x^2-2x+1');
assert.equal(d.left.filter(r=>r.type==='removed').map(r=>r.text).join(''),'+');
assert.equal(d.right.filter(r=>r.type==='added').map(r=>r.text).join(''),'-');
d=D.compare('f(x)=12x','f(x)=13x');assert.equal(d.removed,1);assert.equal(d.added,1);
d=D.compare('z',R`\overline{z}`);assert.equal(d.removed,0);assert.equal(d.added,3);
assert(D.compare('x + y','x+y').equal);
assert(!D.compare(R`\alpha x`,R`\alphax`).equal,'whitespace never merges TeX command tokens');
assert(!D.compare('x + y','x+y',false).equal);
const sources=['',R`\frac{a}{b}`,R`\text{a b} + x`,R`<img src=x onerror=alert(1)>`,'a\nb\tc','x'.repeat(1500),'y'.repeat(1500)];
for(const a of sources)for(const b of sources){const result=D.compare(a,b,false);assert.equal(result.left.map(r=>r.text).join(''),a);assert.equal(result.right.map(r=>r.text).join(''),b);assert.equal(result.equal,a===b);}
assert(D.compare('x'.repeat(1500),'y'.repeat(1500)).coarse);
assert.throws(()=>D.compare('x'.repeat(8001),'x'),/8,000/);
console.log('Completion templates, command boundaries, placeholder ranges and exact/bounded TeX diffs passed.');
