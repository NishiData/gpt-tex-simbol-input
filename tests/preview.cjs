const assert = require('node:assert/strict');
const core = require('../preview-core.js');
const katex = require('../vendor/katex/katex.min.js');
const R = String.raw;
const single = source => core.extract(source).parts.filter(p => p.type === 'math');
assert.equal(single(R`\frac{a}{b}`)[0].text, R`\frac{a}{b}`);
assert.equal(single('x^2+y^2=1').length, 1);
assert.equal(single('普通の日本語の文章').length, 0);
assert.equal(single(R`この式 \frac{a}{b} を説明して`).length, 0);
assert.equal(single(R`この式 $\frac{a}{b}$ を説明して`)[0].text, R`\frac{a}{b}`);
assert.equal(single(R`$x$ と \(y\) と \[z\] と $$w$$`).length, 4);
assert.equal(single('$123$')[0].text, '123');
assert.equal(single('価格は$123').length, 0);
assert.equal(single(R`価格は \$123`).length, 0);
assert.equal(single('`$x$` と $y$')[0].text, 'y');
assert.equal(single('```tex\n$x$\n```').length, 0);
assert.equal(single('式は $x^2')[0].pending, true);
assert.equal(core.extract('a'.repeat(8001)).tooLong, true);
assert.equal(core.extract('x', 'math').count, 1);
assert.equal(core.extract(R`\frac{a}{b}`, 'mixed').count, 0);
assert.equal(core.extract(Array(60).fill('$x$').join(' ')).count, 40);
assert.equal(core.normalize('√{a+b}'), R`\sqrt{a+b}`);
for (const [source, tag] of [
  [R`\frac{a}{b}`, 'mfrac'], [R`x_i^2`, 'msubsup'], [R`\sqrt{a+b}`, 'msqrt'],
  [R`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, 'mtable'],
  [R`\begin{aligned}D_uW&=0\\D_\tau W&=0\end{aligned}`, 'mtable'],
  [R`α+τ≠∞`, 'math']]) {
  const output = katex.renderToString(source, core.options());
  assert(output.includes('<' + tag), source);
}
for (const source of [
  R`\includegraphics{https://example.invalid/secret}`,
  R`\href{javascript:alert(1)}{x}`,
  R`\htmlStyle{background:url(https://example.invalid/secret)}{x}`]) {
  const output = katex.renderToString(source, core.options());
  assert(!/<(?:img|script|iframe|a)\b|(?:src|href)\s*=/.test(output), source);
}
const escaped = katex.renderToString(R`\text{<img src=x onerror=alert(1)>}`, core.options());
assert(!escaped.includes('<img'));
assert.throws(() => katex.renderToString(R`\def\x{\x}\x`, core.options()));
assert.throws(() => katex.renderToString(R`\frac{a}{`, core.options()));
assert.notEqual(core.options().macros, core.options().macros);
console.log('Preview parsing, fractions, scripts, matrices, Unicode, unsafe commands and macro-loop limits passed.');
