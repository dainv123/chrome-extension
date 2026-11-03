import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import vm from 'vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
vm.runInNewContext(readFileSync(join(root, 'ipa-rules.js'), 'utf8'), {
  globalThis: globalThis,
});
const { normalizeUS, normalizeUK, pickHeteronym, resolveUS } = globalThis.SipaRules;

const us = [
  ['water flap', 'wˈɔːɾɚ', 'wˈɔːtər'],
  ['first ɜː→ɜr', 'fˈɜːst', 'fˈɜrst'],
  ['work ɜːɹ', 'wˈɜːɹk', 'wˈɜrk'],
  ['more oː→ɔː', 'mˈoːɹ', 'mˈɔːr'],
  ['store', 'stˈoːɹ', 'stˈɔːr'],
  ['dedupe ərr', 'ɐˈbaʊtɚɹ', 'əˈbaʊtər'],
  ['ɹ→r only', 'pɹˈɑːbləm', 'prˈɑːbləm'],
  ['stress ascii', "'ɛkəɹ", 'ˈɛkər'],
  ['keep oʊ', 'ɡɹˈoʊθ', 'ɡrˈoʊθ'],
];
for (const [name, input, want] of us) {
  assert.equal(normalizeUS(input), want, name);
}

assert.equal(normalizeUK('fˈɜːst'), 'fˈɜːst', 'UK first');
assert.equal(normalizeUK('wˈɔːɾə'), 'wˈɔːtə', 'UK flap');
assert.equal(normalizeUK('mˈoː'), 'mˈɔː', 'UK oː');

assert.equal(pickHeteronym('use', "don't"), 'juːz');
assert.equal(pickHeteronym('use', 'the'), 'juːs');
assert.equal(pickHeteronym('Use', 'to'), 'juːz');
assert.equal(pickHeteronym('table', 'to'), null);

const cmu = { period: { us: 'ˈpɪriəd' }, use: { us: 'juːs' } };
assert.equal(resolveUS('period', { cmu, espeak: 'pˈiərɪəd' }).src, 'cmu');
assert.equal(resolveUS('period', { cmu, manual: { period: { us: 'X' } } }).ipa, 'X');
assert.equal(resolveUS('use', { cmu }, "don't").ipa, 'juːz');
assert.equal(resolveUS('shadcn', { cmu, espeak: 'ʃˈædkən' }).src, 'espeak');

console.log('ipa-rules golden: PASS');
