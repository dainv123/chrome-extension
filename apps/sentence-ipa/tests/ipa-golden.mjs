import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import vm from 'vm';
import { phonemize } from '../vendor/phonemizer.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lexicon = JSON.parse(readFileSync(join(root, 'lexicon.json'), 'utf8'));
const cmu = JSON.parse(readFileSync(join(root, 'data/lexicon.cmu.json'), 'utf8'));
const ctx = {
  globalThis: {},
  chrome: { runtime: { getURL: (p) => `file://${join(root, p)}` } },
  fetch: async (url) => {
    const u = String(url);
    if (u.includes('lexicon.cmu.json')) return { ok: true, json: async () => cmu };
    if (u.includes('lexicon.json')) return { ok: true, json: async () => lexicon };
    return { ok: false };
  },
};
ctx.globalThis.chrome = ctx.chrome;
ctx.globalThis.fetch = ctx.fetch;
vm.runInNewContext(readFileSync(join(root, 'ipa-rules.js'), 'utf8'), ctx);
vm.runInNewContext(readFileSync(join(root, 'ipa-lib.js'), 'utf8'), ctx);
const Sipa = ctx.globalThis.SipaIpa;
await Sipa.loadLexicon();

const HARD =
  'The problem of 300 billion USD per year for GDP to increase by double digits';

const cases = [
  {
    name: 'stress problem',
    run: async () => {
      const raw = (await phonemize('problem', 'gmw/en-US'))[0];
      const got = Sipa.normalizeIpa(raw);
      assert(got.startsWith('ˈ'), `stress at start: ${got}`);
    },
  },
  {
    name: '300 expands',
    run: async () => {
      const ex = Sipa.expandToken('300');
      assert(ex.speak.includes('three') && ex.speak.includes('hundred'), ex.speak);
    },
  },
  {
    name: '$300B expands',
    run: async () => {
      assertEquals(Sipa.expandToken('$300B').speak, 'three hundred billion dollars');
    },
  },
  {
    name: 'USD lexicon',
    run: async () => {
      const row = await Sipa.ipaForToken('USD', phonemize, 'gmw/en-US', 'us');
      assertEquals(Sipa.expandToken('USD').speak, 'US dollars');
      assert(row.ipa.includes('dɑː') || row.ipa.includes('juː'), row.ipa);
    },
  },
  {
    name: 'hanoi saigon overrides',
    run: async () => {
      assertEquals((await Sipa.ipaForToken('Hanoi', phonemize, 'gmw/en-US', 'us')).ipa, 'hæˈnɔɪ');
      assertEquals((await Sipa.ipaForToken('Saigon', phonemize, 'gmw/en-US', 'us')).ipa, 'saɪˈɡɑːn');
    },
  },
  {
    name: 'wordKey Vietnam\'s',
    run: async () => {
      assertEquals(Sipa.wordKey("Vietnam's"), 'vietnams');
    },
  },
  {
    name: 'GDP lexicon',
    run: async () => {
      const row = await Sipa.ipaForToken('GDP', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.ipa, 'dʒiːdiːˈpiː');
    },
  },
  {
    name: 'KPI Q3',
    run: async () => {
      assert(Sipa.expandToken('KPI').speak.includes('K'));
      assert(Sipa.expandToken('Q3').speak.toLowerCase().includes('three'));
    },
  },
  {
    name: 'Vietnam\'s dictionary stress',
    run: async () => {
      const row = await Sipa.ipaForToken("Vietnam's", phonemize, 'gmw/en-US', 'us');
      // Sentence policy: drop secondary ˌ, keep primary ˈ
      assertEquals(row.ipa, 'viːətˈnɑːmz');
      assert(!row.ipa.includes('ˈtn'), row.ipa);
    },
  },
  {
    name: 'Vietnam polish in sentence',
    run: async () => {
      const speak = Sipa.expandSentence("Vietnam's growth");
      const raw = (await phonemize(speak, 'gmw/en-US'))[0];
      const got = Sipa.polishSentenceIpa(raw);
      assert(!/ˈtn/.test(got), got);
      assert(/viːətˈnɑːmz?|viːətˈnæmz?/.test(got) || got.includes('viːətˈn'), got);
      assert(!/ˌ/.test(got), `no secondary stress: ${got}`);
    },
  },
  {
    name: 'tokenizeWordsWithBreaks',
    run: async () => {
      const words = Sipa.tokenizeWordsWithBreaks('good, idea. Next');
      assertEquals(words.map((w) => w.text).join('|'), 'good|idea|Next');
      assert(words[0].breakAfter, 'comma breaks after good');
      assert(words[1].breakAfter, 'period breaks after idea');
      assert(!words[2].breakAfter, 'Next is last');
    },
  },
  {
    name: 'paren breaks linking',
    run: async () => {
      const words = Sipa.tokenizeWordsWithBreaks('API (SpeechRecognition) and TTS');
      assertEquals(words.map((w) => w.text).join('|'), 'API|SpeechRecognition|and|TTS');
      assert(words[0].breakAfter, 'opens paren → break after API');
      assert(words[1].breakAfter, 'closes paren → break after SpeechRecognition');
      assert(!words[2].breakAfter, 'and mid-phrase');
    },
  },
  {
    name: 'API undotted',
    run: async () => {
      const row = await Sipa.ipaForToken('API', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.ipa, 'eɪpiːˈaɪ');
      assert(!row.ipa.includes('.'), row.ipa);
    },
  },
  {
    name: 'Dont keeps apostrophe; camelCase speak splits',
    run: async () => {
      assertEquals(Sipa.expandToken("Don't").speak, "Don't");
      const camel = Sipa.expandToken('SpeechRecognition');
      assertEquals(camel.speak, 'Speech Recognition');
      assertEquals(camel.parts.join('|'), 'Speech|Recognition');
      const row = await Sipa.ipaForToken('SpeechRecognition', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.speak, 'Speech Recognition');
    },
  },
  {
    name: 'double-digit one token',
    run: async () => {
      const tokens = Sipa.tokenize('double-digit growth');
      assert(tokens.includes('double-digit'), JSON.stringify(tokens));
      assert(!tokens.includes('-'), JSON.stringify(tokens));
      assert(!Sipa.isPunctToken('double-digit'));
    },
  },
  {
    name: 'no empty hyphen chip',
    run: async () => {
      const tokens = Sipa.tokenize('double-digit').filter((t) => !Sipa.isPunctToken(t));
      assertEquals(tokens.length, 1);
      const row = await Sipa.ipaForToken('double-digit', phonemize, 'gmw/en-US', 'us');
      assert(row.ipa.length > 0, row.ipa);
    },
  },
  {
    name: 'ASEAN FDI WTO',
    run: async () => {
      assertEquals(Sipa.expandToken('ASEAN').speak, 'ASEAN');
      assert((await Sipa.ipaForToken('FDI', phonemize, 'gmw/en-US', 'us')).ipa.includes('ɛf'));
      assert((await Sipa.ipaForToken('WTO', phonemize, 'gmw/en-US', 'us')).ipa.length > 0);
    },
  },
  {
    name: 'hard sentence expand',
    run: async () => {
      const speak = Sipa.expandSentence(HARD);
      assert(speak.includes('three hundred'), speak);
      assert(speak.includes('dollars'), speak);
      assert(speak.includes('G D P'), speak);
      assert(!/dollars dollars/i.test(speak), speak);
    },
  },
  {
    name: 'hard sentence weak forms',
    run: async () => {
      const speak = Sipa.expandSentence(HARD);
      const raw = (await phonemize(speak, 'gmw/en-US'))[0];
      const got = Sipa.polishSentenceIpa(raw);
      // \b is ASCII-word only; IPA letters like ə need space boundaries
      assert(/(^|\s)əv(?=\s|$)/.test(got), `of weak: ${got}`);
      assert(/(^|\s)pər(?=\s|$)/.test(got), `per: ${got}`);
      assert(/(^|\s)fər(?=\s|$)/.test(got), `for: ${got}`);
      assert(/(^|\s)tə(?=\s|$)/.test(got), `to: ${got}`);
    },
  },
  {
    name: 'punctuation filtered',
    run: async () => {
      const tokens = Sipa.tokenize('growth, target.').filter((t) => !Sipa.isPunctToken(t));
      assertEquals(tokens.join('|'), 'growth|target');
    },
  },
  {
    name: 'aligned word IPA for grows',
    run: async () => {
      const row = await Sipa.ipaForToken('grows', phonemize, 'gmw/en-US', 'us');
      assert(/ɡroʊ|ɡrəʊ|θ|z/.test(row.ipa), row.ipa);
      assert(!/faɪˈnæn/.test(row.ipa), `must not be financial: ${row.ipa}`);
    },
  },
  {
    name: 'to weak+strong forms',
    run: async () => {
      const forms = Sipa.pronunciationForms('to', 'us', 'tuː');
      assertEquals(forms.primary, 'tə');
      assert(forms.forms.some((f) => f.label === 'weak' && f.ipa === 'tə'));
      assert(forms.forms.some((f) => f.label === 'strong' && f.ipa === 'tuː'));
    },
  },
  {
    name: 'content word single form',
    run: async () => {
      const forms = Sipa.pronunciationForms('banks', 'us', 'ˈbæŋks');
      assertEquals(forms.forms.length, 1);
      assertEquals(forms.primary, 'ˈbæŋks');
    },
  },
  {
    name: 'use verb after dont',
    run: async () => {
      const row = await Sipa.ipaForToken('use', phonemize, 'gmw/en-US', 'us', "Don't");
      assertEquals(row.ipa, 'juːz');
    },
  },
  {
    name: 'use noun after the',
    run: async () => {
      const row = await Sipa.ipaForToken('use', phonemize, 'gmw/en-US', 'us', 'the');
      assertEquals(row.ipa, 'juːs');
    },
  },
  {
    name: 'default US vs UK',
    run: async () => {
      const us = await Sipa.ipaForToken('default', phonemize, 'gmw/en-US', 'us');
      const uk = await Sipa.ipaForToken('default', phonemize, 'gmw/en-GB-x-rp', 'uk');
      assertEquals(us.ipa, 'dɪˈfɔːlt');
      assertEquals(uk.ipa, 'dɪˈfɒlt');
    },
  },
  {
    name: 'isolate stress',
    run: async () => {
      const row = await Sipa.ipaForToken('isolate', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.ipa, 'ˈaɪsəleɪt');
    },
  },
  {
    name: 'shadcn lexicon',
    run: async () => {
      const row = await Sipa.ipaForToken('shadcn', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.ipa, 'ˈʃædsiːɛn');
    },
  },
  {
    name: 'inject stress',
    run: async () => {
      const row = await Sipa.ipaForToken('inject', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.ipa, 'ɪnˈdʒɛkt');
      const raw = (await phonemize('inject', 'gmw/en-US'))[0];
      assertEquals(Sipa.fixStress(raw), 'ɪnˈdʒɛkt');
    },
  },
  {
    name: 'injecting stress',
    run: async () => {
      const row = await Sipa.ipaForToken('injecting', phonemize, 'gmw/en-US', 'us');
      assertEquals(row.ipa, 'ɪnˈdʒɛktɪŋ');
    },
  },
  {
    name: 'monosyllable no stress mark',
    run: async () => {
      assertEquals(Sipa.stripMonoStress('ˈmɔːr'), 'mɔːr');
      assertEquals(Sipa.stripMonoStress('ˈmɔː'), 'mɔː');
      const more = await Sipa.ipaForToken('more', phonemize, 'gmw/en-US', 'us');
      assert(!/[ˈˌ]/.test(more.ipa), more.ipa);
    },
  },
  {
    name: 'accentsDiffer ignores ə/ɪ convention',
    run: async () => {
      assert(!Sipa.accentsDiffer('ˈkæpətəl', 'ˈkæpɪtəl'));
      assert(Sipa.accentsDiffer('mɔːr', 'mɔː'));
    },
  },
  {
    name: 'quotes are punct',
    run: async () => {
      const tokens = Sipa.tokenize('"default UI"').filter((t) => !Sipa.isPunctToken(t));
      assertEquals(tokens.join('|'), 'default|UI');
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    await c.run();
    console.log('PASS', c.name);
  } catch (e) {
    failed += 1;
    console.error('FAIL', c.name, e.message || e);
  }
}
if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log(`\n${cases.length} passed`);

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assert failed');
}
function assertEquals(a, b) {
  if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
