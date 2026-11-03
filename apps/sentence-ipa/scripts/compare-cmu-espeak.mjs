#!/usr/bin/env node
/**
 * Compare CMUdict (US) IPA vs eSpeak (after ipa-lib fixStress).
 * Usage:
 *   node scripts/compare-cmu-espeak.mjs \
 *     --cmu data/cmudict.txt --words data/words-10k.txt --limit 10000 \
 *     --out reports --emit data/lexicon.cmu.json \
 *     --ipa-lib ./ipa-lib.js --ipa-fn fixStress
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VOWELS = new Set([
  'AA', 'AE', 'AH', 'AO', 'AW', 'AY', 'EH', 'ER', 'EY', 'IH', 'IY', 'OW', 'OY', 'UH', 'UW',
]);

// Onset clusters allowed (maximal onset) — common English
const ONSETS = new Set(
  `
  p t k b d g f v θ ð s z ʃ ʒ h m n ŋ l r w j tʃ dʒ
  pl pr bl br tr dr kl kr gl gr fl fr θr ʃr
  sp st sk sm sn sl sw
  spl spr str skr skw
  tw dw kw
  pj tj kj bj dj gj fj vj θj hj mj nj lj
`.trim().split(/\s+/),
);

const ARPABET = {
  AA: 'ɑː',
  AE: 'æ',
  AH: { 0: 'ə', 1: 'ʌ', 2: 'ʌ' },
  AO: 'ɔː',
  AW: 'aʊ',
  AY: 'aɪ',
  B: 'b',
  CH: 'tʃ',
  D: 'd',
  DH: 'ð',
  EH: 'ɛ',
  ER: { 0: 'ər', 1: 'ɜr', 2: 'ɜr' },
  EY: 'eɪ',
  F: 'f',
  G: 'ɡ',
  HH: 'h',
  IH: 'ɪ',
  IY: { 0: 'i', 1: 'iː', 2: 'iː' },
  JH: 'dʒ',
  K: 'k',
  L: 'l',
  M: 'm',
  N: 'n',
  NG: 'ŋ',
  OW: 'oʊ',
  OY: 'ɔɪ',
  P: 'p',
  R: 'r',
  S: 's',
  SH: 'ʃ',
  T: 't',
  TH: 'θ',
  UH: 'ʊ',
  UW: 'uː',
  V: 'v',
  W: 'w',
  Y: 'j',
  Z: 'z',
  ZH: 'ʒ',
};

function parseArgs(argv) {
  const out = {
    cmu: 'data/cmudict.txt',
    words: null,
    limit: 10000,
    out: 'reports',
    emit: 'data/lexicon.cmu.json',
    ipaLib: './ipa-lib.js',
    ipaFn: 'fixStress',
    lang: 'gmw/en-US',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--cmu') out.cmu = next;
    else if (a === '--words') out.words = next;
    else if (a === '--limit') out.limit = Number(next);
    else if (a === '--out') out.out = next;
    else if (a === '--emit') out.emit = next;
    else if (a === '--ipa-lib') out.ipaLib = next;
    else if (a === '--ipa-fn') out.ipaFn = next;
    else if (a === '--lang') out.lang = next;
    else continue;
    i++;
  }
  return out;
}

function loadCmu(path) {
  const text = readFileSync(path, 'utf8');
  /** @type {Map<string, string[][]>} */
  const map = new Map();
  for (const line of text.split(/\n/)) {
    if (!line || line.startsWith(';;;') || line.startsWith('#')) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    let word = parts[0].toLowerCase();
    // cmudict.dict: word(2)  / cmudict-0.7b: WORD(2)
    word = word.replace(/\(\d+\)$/, '');
    const phones = parts.slice(1).map((p) => p.toUpperCase());
    if (!map.has(word)) map.set(word, []);
    map.get(word).push(phones);
  }
  return map;
}

function phoneBase(p) {
  return p.replace(/[0-2]$/, '');
}

function phoneStress(p) {
  const m = p.match(/([0-2])$/);
  return m ? Number(m[1]) : null;
}

function arpaPhoneToIpa(phone) {
  const base = phoneBase(phone);
  const stress = phoneStress(phone);
  const mapped = ARPABET[base];
  if (!mapped) return '';
  if (typeof mapped === 'string') return mapped;
  return mapped[stress ?? 0] ?? mapped[1];
}

function isVowelPhone(phone) {
  return VOWELS.has(phoneBase(phone));
}

/** Maximal-onset syllabification over ARPAbet phones. */
function syllabify(phones) {
  const vowelIdx = [];
  phones.forEach((p, i) => {
    if (isVowelPhone(p)) vowelIdx.push(i);
  });
  if (!vowelIdx.length) return [phones];

  const syllables = [];
  let start = 0;
  for (let s = 0; s < vowelIdx.length; s++) {
    const v = vowelIdx[s];
    const nextV = vowelIdx[s + 1];
    let end;
    if (nextV == null) {
      end = phones.length;
    } else {
      const between = phones.slice(v + 1, nextV);
      // maximal onset: smallest k where between.slice(k) is a legal onset (or empty)
      let split = between.length;
      for (let k = 0; k <= between.length; k++) {
        const onset = between.slice(k).map(arpaPhoneToIpa).join('');
        if (onset === '' || ONSETS.has(onset)) {
          split = k;
          break;
        }
      }
      end = v + 1 + split;
    }
    syllables.push(phones.slice(start, end));
    start = end;
  }
  return syllables;
}

function phonesToIpa(phones) {
  const syllables = syllabify(phones);
  const multi = syllables.length > 1;
  return syllables
    .map((syl) => {
      let stress = 0;
      const pieces = [];
      for (const p of syl) {
        if (isVowelPhone(p)) stress = Math.max(stress, phoneStress(p) ?? 0);
        pieces.push(arpaPhoneToIpa(p));
      }
      const body = pieces.join('');
      if (!multi || stress === 0) return body;
      return (stress === 1 ? 'ˈ' : 'ˌ') + body;
    })
    .join('');
}

function normalizeCompare(ipa) {
  return String(ipa || '')
    .normalize('NFKC')
    .replace(/ɹ/g, 'r')
    .replace(/ɚ/g, 'ər')
    .replace(/ɝ/g, 'ɜr')
    .replace(/ᵻ/g, 'ɪ')
    .replace(/ɐ/g, 'ə')
    .replace(/ɡ/g, 'g')
    .replace(/:/g, 'ː')
    .replace(/['']/g, 'ˈ')
    .replace(/,/g, 'ˌ')
    .replace(/\./g, '')
    .replace(/\s+/g, '')
    .trim();
}

function stripStress(s) {
  return s.replace(/[ˈˌ]/g, '');
}

function loadFixFn(ipaLibPath, fnName) {
  const abs = resolve(ROOT, ipaLibPath);
  if (!existsSync(abs)) {
    console.warn(`warn: missing ${abs}; using raw eSpeak IPA`);
    return (s) => s;
  }
  const code = readFileSync(abs, 'utf8');
  const ctx = {
    globalThis: {},
    chrome: { runtime: { getURL: () => '' } },
    fetch: async () => ({ ok: false }),
  };
  ctx.globalThis.chrome = ctx.chrome;
  vm.runInNewContext(code, ctx);
  const api = ctx.globalThis.SipaIpa;
  if (!api?.[fnName]) {
    console.warn(`warn: ${fnName} not exported on SipaIpa; using raw eSpeak IPA`);
    return (s) => s;
  }
  return (s) => api[fnName](s);
}

function tokenizeIpa(s) {
  // stress + multi-char phones first
  const re =
    /[ˈˌ]|tʃ|dʒ|aɪ|aʊ|ɔɪ|oʊ|eɪ|ɑː|ɔː|iː|uː|ɜr|ər|æ|ɑ|ɒ|ɔ|ə|ɛ|ɜ|ɪ|ʊ|ʌ|i|u|b|d|f|g|ɡ|h|j|k|l|m|n|ŋ|p|r|s|ʃ|t|θ|ð|v|w|z|ʒ|./gu;
  return s.match(re) || [];
}

function alignTokens(a, b) {
  // Needleman–Wunsch lite
  const n = a.length;
  const m = b.length;
  const gap = 1;
  const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i * gap;
  for (let j = 0; j <= m; j++) dp[0][j] = j * gap;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, dp[i - 1][j] + gap, dp[i][j - 1] + gap);
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      pairs.push([a[i - 1], b[j - 1]]);
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + gap) {
      pairs.push([a[i - 1], '∅']);
      i--;
    } else {
      pairs.push(['∅', b[j - 1]]);
      j--;
    }
  }
  return pairs.reverse();
}

function pickWords(cmu, wordsPath, limit) {
  if (wordsPath && existsSync(resolve(ROOT, wordsPath))) {
    const list = readFileSync(resolve(ROOT, wordsPath), 'utf8')
      .split(/\n/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean)
      .filter((w) => cmu.has(w));
    return [...new Set(list)].slice(0, limit);
  }
  // even sample from CMU keys
  const keys = [...cmu.keys()].filter((w) => /^[a-z]+$/.test(w));
  const step = Math.max(1, Math.floor(keys.length / limit));
  const out = [];
  for (let i = 0; i < keys.length && out.length < limit; i += step) out.push(keys[i]);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const cmuPath = resolve(ROOT, args.cmu);
  const outDir = resolve(ROOT, args.out);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(dirname(resolve(ROOT, args.emit)), { recursive: true });

  console.log('loading CMUdict…');
  const cmu = loadCmu(cmuPath);
  const words = pickWords(cmu, args.words, args.limit);
  console.log(`words: ${words.length}`);

  // sanity ARPAbet
  const sanity = {
    period: phonesToIpa(cmu.get('period')[0]),
    problem: phonesToIpa(cmu.get('problem')[0]),
    default: phonesToIpa(cmu.get('default')[0]),
    vietnam: phonesToIpa(cmu.get('vietnam')?.[0] || []),
  };
  console.log('ARPAbet→IPA sanity:', sanity);

  const fix = loadFixFn(args.ipaLib, args.ipaFn);

  const { phonemize } = await import(resolve(ROOT, 'vendor/phonemizer.js'));

  const lexiconCmu = { wordIpa: {} };
  const diffs = [];
  const patterns = new Map();
  const heteronyms = [];
  let match = 0;
  let stressOnly = 0;
  let segmental = 0;

  const started = Date.now();
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const variants = cmu.get(word);
    if (!variants?.length) continue;
    if (variants.length > 1) {
      heteronyms.push(
        [word, ...variants.map((v) => phonesToIpa(v))].join('\t'),
      );
    }
    const cmuIpa = phonesToIpa(variants[0]);
    lexiconCmu.wordIpa[word] = { us: cmuIpa };

    let espRaw;
    try {
      espRaw = (await phonemize(word, args.lang)).join(' ');
    } catch (err) {
      console.warn(`espeak fail ${word}:`, err?.message || err);
      continue;
    }
    const espIpa = fix(espRaw);

    const a = normalizeCompare(cmuIpa);
    const b = normalizeCompare(espIpa);
    if (a === b) {
      match++;
    } else if (stripStress(a) === stripStress(b)) {
      stressOnly++;
      diffs.push(`${word}\tstress\t${cmuIpa}\t${espIpa}`);
    } else {
      segmental++;
      diffs.push(`${word}\tsegmental\t${cmuIpa}\t${espIpa}`);
      const pairs = alignTokens(tokenizeIpa(stripStress(a)), tokenizeIpa(stripStress(b)));
      for (const [left, right] of pairs) {
        if (left === right) continue;
        if (left === 'ˈ' || left === 'ˌ' || right === 'ˈ' || right === 'ˌ') continue;
        const key = `${left}→${right}`;
        const row = patterns.get(key) || { pattern: key, count: 0, examples: [] };
        row.count++;
        if (row.examples.length < 8) row.examples.push(`${word}: ${cmuIpa} vs ${espIpa}`);
        patterns.set(key, row);
      }
    }

    if ((i + 1) % 200 === 0 || i === words.length - 1) {
      const sec = ((Date.now() - started) / 1000).toFixed(1);
      process.stdout.write(
        `\r${i + 1}/${words.length} match=${match} stress=${stressOnly} seg=${segmental} (${sec}s)`,
      );
    }
  }
  process.stdout.write('\n');

  const patternList = [...patterns.values()].sort((x, y) => y.count - x.count);
  writeFileSync(join(outDir, 'patterns.json'), JSON.stringify(patternList, null, 2));
  writeFileSync(
    join(outDir, 'diff.tsv'),
    ['word\tkind\tcmu\tespeak', ...diffs].join('\n'),
  );
  writeFileSync(join(outDir, 'heteronyms.tsv'), heteronyms.join('\n'));
  writeFileSync(resolve(ROOT, args.emit), JSON.stringify(lexiconCmu, null, 2));

  const summary = {
    words: words.length,
    match,
    stressOnly,
    segmental,
    topPatterns: patternList.slice(0, 20),
    sanity,
  };
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ match, stressOnly, segmental, top: patternList.slice(0, 20) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
