// ipa-rules.js — rule layer from reports/patterns.json (9425 words, google-10k ∩ CMU).
//
// Word chips resolution order:
//   1. lexicon.json (manual)
//   2. heteronym table (context) → pickHeteronym()
//   3. lexicon.cmu.json (US)
//   4. eSpeak + normalizeUS/UK()
// Sentence IPA line: eSpeak + same normalize*().
//
// Only safe-without-dictionary patterns live here.
// Word-dependent diffs (ə/ɪ, ɔː length, æ/ə, n/ŋ, z/s, syncope) → lexicon.cmu.json.

(() => {
  const RULES_COMMON = [
    ['flap→t', /ɾ/g, 't'],
    ['ɹ→r', /ɹ/g, 'r'],
    ['ᵻ→ɪ', /ᵻ/g, 'ɪ'],
    ['ɐ→ə', /ɐ/g, 'ə'],
    ['oː→ɔː', /oː/g, 'ɔː'],
    ['dedupe r', /r{2,}/g, 'r'],
  ];

  const RULES_US = [
    ['ɚ→ər', /ɚ/g, 'ər'],
    ['ɝ→ɜr', /ɝ/g, 'ɜr'],
    ['ɜː(r)→ɜr', /ɜːr?/g, 'ɜr'],
    ['dedupe r', /r{2,}/g, 'r'],
  ];

  const RULES_UK = [
    ['ɚ→ə', /ɚ/g, 'ə'],
    ['ɝ→ɜː', /ɝ/g, 'ɜː'],
  ];

  function apply(ipa, rules) {
    let s = String(ipa || '').replace(/'/g, 'ˈ');
    for (const [, re, to] of rules) s = s.replace(re, to);
    return s;
  }

  function normalizeUS(ipa) {
    return apply(ipa, [...RULES_COMMON, ...RULES_US]);
  }

  function normalizeUK(ipa) {
    return apply(ipa, [...RULES_COMMON, ...RULES_UK]);
  }

  const VERB_TRIGGERS = new Set([
    'to',
    "don't",
    'do',
    'does',
    "doesn't",
    'will',
    "won't",
    'can',
    "can't",
    'would',
    'should',
    'must',
    'not',
    'may',
    'might',
    "let's",
    'i',
    'we',
    'you',
    'they',
    'also',
    'then',
  ]);

  const HETERONYMS = {
    use: { verb: 'juːz', noun: 'juːs' },
    live: { verb: 'lɪv', noun: 'laɪv' },
    record: { verb: 'rɪˈkɔːrd', noun: 'ˈrɛkərd' },
    present: { verb: 'prɪˈzɛnt', noun: 'ˈprɛzənt' },
    object: { verb: 'əbˈdʒɛkt', noun: 'ˈɑːbdʒɛkt' },
    project: { verb: 'prəˈdʒɛkt', noun: 'ˈprɑːdʒɛkt' },
    increase: { verb: 'ɪnˈkriːs', noun: 'ˈɪnkriːs' },
  };

  function pickHeteronym(word, prevWord = '') {
    const h = HETERONYMS[String(word || '').toLowerCase()];
    if (!h) return null;
    return VERB_TRIGGERS.has(String(prevWord || '').toLowerCase()) ? h.verb : h.noun;
  }

  function resolveUS(word, { manual = {}, cmu = {}, espeak } = {}, prevWord = '') {
    const w = String(word || '').toLowerCase();
    if (manual[w]?.us) return { ipa: manual[w].us, src: 'manual' };
    const het = pickHeteronym(w, prevWord);
    if (het) return { ipa: het, src: 'heteronym' };
    if (cmu[w]?.us) return { ipa: cmu[w].us, src: 'cmu' };
    return { ipa: normalizeUS(espeak ?? ''), src: 'espeak' };
  }

  globalThis.SipaRules = {
    normalizeUS,
    normalizeUK,
    pickHeteronym,
    resolveUS,
    HETERONYMS,
  };
})();
