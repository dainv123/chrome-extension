import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { globalThis: {} };
vm.runInNewContext(readFileSync(join(root, 'ipa-link.js'), 'utf8'), ctx);
const { linkSentence, renderLine } = ctx.globalThis.SipaLink;

const t = (text, ipa, breakAfter = false) => ({ text, ipa, breakAfter });
const run = (toks, accent = 'us') => renderLine(linkSentence(toks, { accent }));

const cases = [
  ['consonant+vowel', 'us', [t('check', 'tʃɛk'), t('it', 'ɪt'), t('out', 'aʊt')], 'tʃɛk‿ɪt‿aʊt'],
  ['the + vowel', 'us', [t('the', 'ðiː'), t('artificial', 'ˌɑːrtəˈfɪʃəl')], 'ði‿ʲˌɑːrtəˈfɪʃəl'],
  ['the + vowel econ', 'us', [t('the', 'ðiː'), t('economy', 'ɪˈkɑːnəmi')], 'ði‿ʲɪˈkɑːnəmi'],
  ['the + consonant', 'us', [t('the', 'ðiː'), t('bank', 'bæŋk')], 'ðə bæŋk'],
  ['palatal', 'us', [t('did', 'dɪd'), t('you', 'juː')], 'dɪdʒ‿uː'],
  ['linking r UK', 'uk', [t('far', 'fɑː'), t('away', 'əˈweɪ')], 'fɑː‿rəˈweɪ'],
  ['far away US', 'us', [t('far', 'fɑːr'), t('away', 'əˈweɪ')], 'fɑːr‿əˈweɪ'],
  ['chunk break', 'us', [t('good', 'ɡʊd', true), t('idea', 'aɪˈdiːə')], 'ɡʊd aɪˈdiːə'],
  [
    'weak mid-chunk',
    'us',
    [t('capital', 'ˈkæpətəl'), t('of', 'ʌv'), t('Vietnam', 'ˌviːətˈnɑːm')],
    'ˈkæpətəl‿əv ˌviːətˈnɑːm',
  ],
  [
    'strong chunk-end',
    'us',
    [t('capital', 'ˈkæpətəl'), t('of', 'ʌv', true), t('x', 'ɛks')],
    'ˈkæpətəl‿ʌv ɛks',
  ],
  ['to + vowel', 'us', [t('to', 'tuː'), t('eat', 'iːt')], 'tu‿ʷiːt'],
  ['to + consonant', 'us', [t('to', 'tuː'), t('go', 'ɡoʊ')], 'tə ɡoʊ'],
  ['glide w UK', 'uk', [t('so', 'səʊ'), t('important', 'ɪmˈpɔːtənt')], 'səʊ‿ʷɪmˈpɔːtənt'],
  ['no link c+c', 'us', [t('bank', 'bæŋk'), t('country', 'ˈkʌntri')], 'bæŋk ˈkʌntri'],
  [
    'paren break no link',
    'us',
    [t('recognition', 'rɛkəɡˈnɪʃən', true), t('and', 'ænd'), t('on', 'ɑːn')],
    'rɛkəɡˈnɪʃən ənd‿ɑːn',
  ],
  [
    'and weak mid',
    'us',
    [t('cats', 'kæts'), t('and', 'ænd'), t('dogs', 'dɑːɡz')],
    'kæts‿ənd dɑːɡz',
  ],
];

for (const [name, acc, toks, want] of cases) {
  assert.equal(run(toks, acc), want, name);
}
console.log(`ipa-link golden: PASS (${cases.length})`);
