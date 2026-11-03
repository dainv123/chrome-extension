// Connected-speech layer (nối âm) — rule-based, word BOUNDARIES only.
// Input : [{ text, ipa, breakAfter?, stressed? }]
// Output: same tokens + { link: null | { type, glyph } }; may mutate ipa (weak/glide/r/palatal).
(function (root) {
  const V = 'aeiouɑɒɔəɚɛɜɪʊʌæ';
  const startsVowel = (ipa) => new RegExp(`^[ˈˌ]*[${V}]`).test(ipa || '');
  const endsVowel = (ipa) => new RegExp(`[${V}]ː?$`).test(ipa || '');

  // [US, UK] weak forms; used when the word is not last in its chunk
  const WEAK = {
    a: ['ə', 'ə'],
    an: ['ən', 'ən'],
    and: ['ənd', 'ənd'],
    as: ['əz', 'əz'],
    at: ['ət', 'ət'],
    but: ['bət', 'bət'],
    for: ['fər', 'fə'],
    from: ['frəm', 'frəm'],
    of: ['əv', 'əv'],
    or: ['ər', 'ə'],
    per: ['pər', 'pə'],
    than: ['ðən', 'ðən'],
    was: ['wəz', 'wəz'],
    were: ['wər', 'wə'],
    are: ['ər', 'ə'],
    can: ['kən', 'kən'],
    could: ['kəd', 'kəd'],
    would: ['wəd', 'wəd'],
    should: ['ʃəd', 'ʃəd'],
    has: ['həz', 'həz'],
    have: ['həv', 'həv'],
    had: ['həd', 'həd'],
    been: ['bɪn', 'bɪn'],
  };
  const PALATAL_NEXT = /^(you|your|you're|you've|you'd|you'll)$/i;
  const PALATAL = { t: 'tʃ', d: 'dʒ', s: 'ʃ', z: 'ʒ' };

  function linkSentence(tokens, { accent = 'us' } = {}) {
    const uk = accent === 'uk';
    const out = tokens.map((t) => ({ ...t, link: null }));
    const isLast = (i) => i === out.length - 1 || out[i].breakAfter;

    // 1. weak forms
    out.forEach((t, i) => {
      const w = WEAK[String(t.text || '').toLowerCase()];
      if (w && !isLast(i) && !t.stressed) t.ipa = w[uk ? 1 : 0];
    });

    // 2. the / to
    out.forEach((t, i) => {
      const k = String(t.text || '').toLowerCase();
      if ((k !== 'the' && k !== 'to') || isLast(i) || t.stressed) return;
      const v = startsVowel(out[i + 1].ipa);
      t.ipa = k === 'the' ? (v ? 'ði' : 'ðə') : v ? 'tu' : 'tə';
    });

    // 3. boundary linking
    for (let i = 0; i < out.length - 1; i++) {
      if (isLast(i)) continue;
      const a = out[i];
      const b = out[i + 1];

      // palatalisation: did you / what you / as you
      if (PALATAL_NEXT.test(b.text) && /[tdsz]$/.test(a.ipa) && /^[ˈˌ]*j/.test(b.ipa)) {
        a.ipa = a.ipa.slice(0, -1) + PALATAL[a.ipa.slice(-1)];
        b.ipa = b.ipa.replace(/^([ˈˌ]*)j/, '$1');
        a.link = { type: 'palatal', glyph: '‿' };
        continue;
      }
      if (!startsVowel(b.ipa)) continue;

      if (!endsVowel(a.ipa)) {
        // consonant + vowel
        a.link = { type: 'cv', glyph: '‿' };
      } else if (uk && /(r|re)$/i.test(a.text)) {
        // linking r (UK, non-rhotic)
        b.ipa = `r${b.ipa}`;
        a.link = { type: 'r', glyph: '‿' };
      } else if (/(iː?|eɪ|aɪ|ɔɪ|ɪ)$/.test(a.ipa)) {
        // glide j
        b.ipa = `ʲ${b.ipa}`;
        a.link = { type: 'glide', glyph: '‿' };
      } else if (/(uː?|oʊ|əʊ|aʊ|ʊ)$/.test(a.ipa)) {
        // glide w
        b.ipa = `ʷ${b.ipa}`;
        a.link = { type: 'glide', glyph: '‿' };
      }
      // ə / ɑː + vowel: no mark
    }
    return out;
  }

  function renderLine(tokens) {
    return tokens
      .map((t, i) => t.ipa + (i < tokens.length - 1 ? (t.link ? t.link.glyph : ' ') : ''))
      .join('');
  }

  /** Split leading inserted glide / linking-r from base IPA for dimmed UI. */
  function splitInserted(ipa) {
    const s = String(ipa || '');
    const m = s.match(/^(ʲ|ʷ|r)(?=[ˈˌ]?[aeiouɑɒɔəɚɛɜɪʊʌæ])/);
    if (!m) return { insert: '', base: s };
    return { insert: m[1], base: s.slice(m[1].length) };
  }

  root.SipaLink = { linkSentence, renderLine, splitInserted, startsVowel, endsVowel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
