(() => {
  const ONES = [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
    'seventeen', 'eighteen', 'nineteen',
  ];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALE = { k: 'thousand', K: 'thousand', m: 'million', M: 'million', b: 'billion', B: 'billion', t: 'trillion', T: 'trillion' };

  let lexicon = { acronyms: {}, wordIpa: {}, weakForms: {} };
  let cmuLexicon = { wordIpa: {} };
  let lexiconReady = null;
  const Rules = () => globalThis.SipaRules;

  function under100(n) {
    if (n < 20) return ONES[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
  }

  function under1000(n) {
    if (n < 100) return under100(n);
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return rest ? `${ONES[h]} hundred ${under100(rest)}` : `${ONES[h]} hundred`;
  }

  function numberToWords(raw) {
    const cleaned = String(raw).replace(/,/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n > 999999999999) return null;
    if (n < 1000) return under1000(n);
    if (n < 1000000) {
      const thousands = Math.floor(n / 1000);
      const rest = n % 1000;
      return rest ? `${under1000(thousands)} thousand ${under1000(rest)}` : `${under1000(thousands)} thousand`;
    }
    if (n < 1000000000) {
      const millions = Math.floor(n / 1000000);
      const rest = n % 1000000;
      const head = `${under1000(millions)} million`;
      if (!rest) return head;
      return `${head} ${numberToWords(String(rest))}`;
    }
    const billions = Math.floor(n / 1000000000);
    const rest = n % 1000000000;
    const head = `${under1000(billions)} billion`;
    if (!rest) return head;
    return `${head} ${numberToWords(String(rest))}`;
  }

  // Legal English onsets for moving eSpeak's pre-vowel stress (ɪndʒˈɛkt → ɪnˈdʒɛkt)
  const ONSETS = new Set(
    `
    b d f g ɡ h j k l m n p r s t v w z ʃ ʒ θ ð ŋ
    bl br dr dw fl fr gl gr gw kl kr kw pl pr tr tw θr ʃr
    sk sl sm sn sp st sw skr skw spl spr str
    tʃ dʒ
  `
      .trim()
      .split(/\s+/),
  );

  function relocateStress(ipa) {
    const s = String(ipa || '').replace(/,/g, '.');
    return s.replace(
      /([^aeiouɑɒɔəɛɜɪʊʌæː\sˈˌ.]+)([ˈˌ])([aeiouɑɒɔəɛɜɪʊʌæ])/gi,
      (_, cons, mark, vowel) => {
        let split = cons.length;
        for (let k = 0; k <= cons.length; k++) {
          const onset = cons.slice(k);
          if (onset === '' || ONSETS.has(onset)) {
            split = k;
            break;
          }
        }
        return `${cons.slice(0, split)}${mark}${cons.slice(split)}${vowel}`;
      },
    );
  }

  function vowelCount(ipa) {
    const m = String(ipa || '')
      .replace(/[ˈˌ.]/g, '')
      .match(/aɪ|aʊ|ɔɪ|oʊ|eɪ|ɪə|ɛə|ʊə|[aeiouɑɒɔəɛɜɪʊʌæː]+/gi);
    return m ? m.length : 0;
  }

  /** One policy for US+UK: monosyllables never carry ˈ/ˌ. */
  function stripMonoStress(ipa) {
    const s = String(ipa || '');
    return vowelCount(s) <= 1 ? s.replace(/[ˈˌ]/g, '') : s;
  }

  /** Sentence line: keep primary ˈ only — drop secondary ˌ for a cleaner read. */
  function stripSecondaryStress(ipa) {
    return String(ipa || '').replace(/ˌ/g, '');
  }

  /** Next-word IPA starts with a vowel (ignore stress marks). /j/ /w/ = consonants. */
  function ipaStartsWithVowel(ipa) {
    return /^[ˈˌ]?[aeiouɑɒɔəɚɛɜɪʊʌæ]/.test(String(ipa || ''));
  }

  /**
   * Linking weak forms from next word's IPA (not orthography):
   * the → ði before vowel; to → tu before vowel.
   */
  function applyLinkingForms(rows) {
    for (let i = 0; i < rows.length - 1; i++) {
      const cur = rows[i];
      const next = rows[i + 1];
      const key = wordKey(cur.word);
      for (const accent of ['us', 'uk']) {
        const formsKey = accent === 'uk' ? 'ukForms' : 'usForms';
        let nextIpa = next[accent] || '';
        let linked = cur[accent] || '';
        if (key === 'the' && (linked === 'ðə' || linked === 'ði') && ipaStartsWithVowel(nextIpa)) {
          linked = 'ði';
        } else if (key === 'to' && (linked === 'tə' || linked === 'tu') && ipaStartsWithVowel(nextIpa)) {
          linked = 'tu';
        } else {
          continue;
        }
        cur[accent] = linked;
        const weak = cur[formsKey]?.find((f) => f.label === 'weak');
        if (weak) weak.ipa = linked;
      }
      cur.differs = accentsDiffer(cur.us, cur.uk);
    }
    return rows;
  }

  /** Compare accents: ignore stress, length, flap, and ə/ɪ dictionary convention. */
  function ipaCore(s) {
    return String(s || '')
      .normalize('NFKC')
      .replace(/[ˈˌ.]/g, '')
      .replace(/ː/g, '')
      .replace(/ɡ/g, 'g')
      .replace(/ɾ/g, 't')
      .replace(/ɪ/g, 'ə');
  }

  function accentsDiffer(us, uk) {
    if (!us || !uk) return false;
    return ipaCore(us) !== ipaCore(uk);
  }

  function fixStress(ipa, accentKey = 'us') {
    const rules = Rules();
    const normalized = rules
      ? accentKey === 'uk'
        ? rules.normalizeUK(ipa)
        : rules.normalizeUS(ipa)
      : String(ipa || '')
          .replace(/ɹ/g, 'r')
          .replace(/ɚ/g, 'ər')
          .replace(/ɝ/g, 'ɜr')
          .replace(/'/g, 'ˈ')
          .replace(/ᵻ/g, 'ɪ')
          .replace(/ɐ/g, 'ə');
    return stripSecondaryStress(stripMonoStress(relocateStress(normalized)));
  }

  function normalizeIpa(s, accentKey = 'us') {
    // Drop syllable dots (lexicon often has eɪ.piː; sentence IPA stays undotted)
    return fixStress(s, accentKey).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  }

  function finalizeDictIpa(ipa) {
    return stripSecondaryStress(stripMonoStress(String(ipa || ''))).replace(/\./g, '');
  }

  async function loadLexicon() {
    if (lexiconReady) return lexiconReady;
    lexiconReady = (async () => {
      try {
        const base = chrome?.runtime?.getURL;
        if (!base) return lexicon;
        const [manualRes, cmuRes] = await Promise.all([
          fetch(base('lexicon.json')),
          fetch(base('data/lexicon.cmu.json')),
        ]);
        if (manualRes.ok) lexicon = await manualRes.json();
        if (cmuRes.ok) cmuLexicon = await cmuRes.json();
      } catch {
        // keep defaults
      }
      return lexicon;
    })();
    return lexiconReady;
  }

  function tokenize(text) {
    return (
      text
        .match(
          // hyphen compounds first so "double-digit" stays one chip
          // do NOT swallow the next word "billion" — only glued suffixes like 300B / 300bn
          /\$?\d+(?:[.,]\d+)?(?:[BMKTbmk]|bn|mn)?%?|Q[1-4]|B2[BC]|[A-Za-z]+(?:-[A-Za-z]+)+(?:['’][A-Za-z]+)?|[A-Za-z]+(?:['’][A-Za-z]+)?|[A-Z]{2,6}|[^A-Za-z\d\s]+|\s+/g,
        )
        ?.filter((t) => t.trim()) ?? [text]
    );
  }

  function isPunctToken(token) {
    return !/[\p{L}\p{N}$]/u.test(token);
  }

  /** Words only + breakAfter when the next token is clause/sentence punctuation. */
  function tokenizeWordsWithBreaks(text) {
    const raw = tokenize(text);
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      if (isPunctToken(raw[i])) continue;
      let breakAfter = false;
      for (let j = i + 1; j < raw.length; j++) {
        if (!isPunctToken(raw[j])) break;
        // Clause / paren boundaries — no linking across ( ) [ ] { }
        if (/[,.!?;:…()[\]{}]/.test(raw[j])) {
          breakAfter = true;
          break;
        }
      }
      out.push({ text: raw[i], breakAfter });
    }
    return out;
  }

  function wordKey(word) {
    return String(word || '')
      .toLowerCase()
      .replace(/['’]s\b/g, 's')
      .replace(/[^a-z]/g, '');
  }

  function parseMoneyOrNumber(token) {
    const t = token.replace(/\s+/g, '');
    // $300B / 300B / $300 / 300bn
    const m = t.match(/^(\$)?(\d+(?:[.,]\d+)?)([BMKTbmk]|bn|mn)?$/i);
    if (!m) return null;
    const hasDollar = Boolean(m[1] || /usd/i.test(token));
    const num = numberToWords(m[2]);
    if (!num) return null;
    const suf = m[3] ? SCALE[m[3]] || SCALE[m[3][0]] || '' : '';
    const parts = [num, suf, hasDollar ? 'dollars' : ''].filter(Boolean);
    return { parts, speak: parts.join(' ') };
  }

  function expandToken(token) {
    if (isPunctToken(token)) return { surface: token, parts: [], speak: '', ipa: null };

    const money = parseMoneyOrNumber(token);
    if (money) return { surface: token, parts: money.parts, speak: money.speak, ipa: null };

    if (/^\d+(?:\.\d+)?%$/.test(token)) {
      const words = numberToWords(token.replace(/%/g, ''));
      const speak = words ? `${words} percent` : token;
      return { surface: token, parts: speak.split(' '), speak, ipa: null };
    }

    if (/^\d+(?:[.,]\d+)?$/.test(token)) {
      const words = numberToWords(token);
      const speak = words || token;
      return { surface: token, parts: speak.split(/\s+/), speak, ipa: null };
    }

    // Keep surface "Vietnam's"; lexicon key vietnams / vietnam
    const possess = token.match(/^([A-Za-z]+(?:-[A-Za-z]+)*)['’]s$/i);
    if (possess) {
      const base = possess[1];
      const fixed = lexicon.wordIpa?.[wordKey(`${base}'s`)] || lexicon.wordIpa?.[wordKey(base)];
      return {
        surface: token,
        parts: [base],
        speak: `${base}'s`,
        ipa: fixed || null,
      };
    }

    // Keep apostrophes (Don't, it's) so TTS word boundaries match highlight
    const plain = token.replace(/[^\p{L}\p{N}'’-]/gu, '');
    if (!plain) return { surface: token, parts: [], speak: '', ipa: null };

    if (plain.includes('-')) {
      const speak = plain.replace(/-/g, ' ');
      const fixed = lexicon.wordIpa?.[wordKey(plain)];
      return { surface: token, parts: speak.split(/\s+/).filter(Boolean), speak, ipa: fixed || null };
    }

    const letterKey = plain.replace(/['’]/g, '');
    const upper = letterKey.toUpperCase();
    const ac = lexicon.acronyms?.[upper];
    if (ac) {
      return {
        surface: token,
        parts: ac.speak.split(/\s+/).filter(Boolean),
        speak: ac.speak,
        ipa: ac.ipa || null,
      };
    }

    if (/^Q[1-4]$/i.test(letterKey)) {
      const map = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };
      const speak = `Q ${map[letterKey[1]]}`;
      return { surface: token, parts: speak.split(/\s+/), speak, ipa: lexicon.acronyms?.[upper]?.ipa || null };
    }

    if (/^[A-Z]{2,6}$/.test(letterKey)) {
      const speak = letterKey.split('').join(' ');
      return { surface: token, parts: letterKey.split(''), speak, ipa: null };
    }

    // CamelCase → speak parts (one IPA chip, several TTS words): SpeechRecognition
    if (/[a-z][A-Z]/.test(letterKey) || /[A-Z]{2,}[a-z]/.test(letterKey)) {
      const speak = letterKey
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
      const fixed = lexicon.wordIpa?.[wordKey(letterKey)];
      return { surface: token, parts: speak.split(/\s+/).filter(Boolean), speak, ipa: fixed || null };
    }

    // plain lexicon lookup without prev context (filled later in ipaForToken)
    const fixed = lexicon.wordIpa?.[wordKey(plain)];
    return { surface: token, parts: [plain], speak: plain, ipa: fixed || null };
  }

  function expandSentence(text) {
    const parts = [];
    for (const t of tokenize(text)) {
      const speak = expandToken(t).speak;
      if (!speak) continue;
      // "$300B USD" → avoid "… dollars US dollars"
      if (/dollars$/i.test(parts[parts.length - 1] || '') && /dollars$/i.test(speak)) continue;
      parts.push(speak);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function isUseAsNoun(prevToken) {
    return /^(a|an|the|no|this|that|its|their|our|my|your|his|her)$/i.test(String(prevToken || ''));
  }

  function lexiconKeyForToken(token, prevToken) {
    const key = wordKey(token);
    if (key === 'use' && isUseAsNoun(prevToken)) return 'usenoun';
    return key;
  }

  function applyWordIpa(word, accent, ipa, prevToken) {
    const key = lexiconKeyForToken(word, prevToken);
    const plain = wordKey(word);
    const manual = lexicon.wordIpa?.[key] || lexicon.wordIpa?.[plain] || lexicon.wordIpa?.[plain.replace(/s$/, '')];
    const accentKey = accent === 'uk' ? 'uk' : 'us';
    if (manual?.[accentKey]) return finalizeDictIpa(manual[accentKey]);

    const rules = Rules();
    if (accentKey === 'us' && rules) {
      const resolved = rules.resolveUS(
        plain,
        { manual: lexicon.wordIpa || {}, cmu: cmuLexicon.wordIpa || {}, espeak: ipa },
        prevToken,
      );
      if (resolved.src !== 'espeak') return finalizeDictIpa(resolved.ipa);
      return normalizeIpa(resolved.ipa, 'us');
    }

    if (!ipa) return '';
    return normalizeIpa(ipa, accentKey);
  }

  // Function words: return weak (sentence) + strong (citation). Content words: one form.
  function pronunciationForms(word, accentKey, citationIpa) {
    const key = wordKey(word);
    const entry = lexicon.weakForms?.[key];
    const citation = citationIpa || '';
    if (!entry) {
      return {
        primary: citation,
        forms: citation ? [{ label: '', ipa: citation }] : [],
      };
    }
    const strong =
      (accentKey === 'uk' ? entry.strongUk : entry.strongUs) ||
      entry.strong?.[0] ||
      citation;
    const weak = entry.weak;
    const forms = [];
    if (weak) forms.push({ label: 'weak', ipa: weak });
    if (strong && strong !== weak) forms.push({ label: 'strong', ipa: strong });
    return {
      primary: weak || strong || citation,
      forms,
    };
  }

  function applyWeakForms(ipa) {
    let out = ` ${ipa} `;
    const forms = lexicon.weakForms || {};
    for (const entry of Object.values(forms)) {
      for (const strong of entry.strong || []) {
        const re = new RegExp(`(^|\\s)${escapeRe(strong)}(?=\\s|$)`, 'g');
        out = out.replace(re, `$1${entry.weak}`);
      }
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function polishSentenceIpa(ipa, accentKey = 'us') {
    return applyWeakForms(
      normalizeIpa(ipa, accentKey)
        .replace(/\b[bB]ˈɪliən\b/g, 'ˈbɪl.jən')
        .replace(/\bˈbɪliən\b/g, 'ˈbɪl.jən')
        .replace(/\b[mM]ˈɪliən\b/g, 'ˈmɪl.jən')
        .replace(/\bˈmɪliən\b/g, 'ˈmɪl.jən')
        // eSpeak + naive stress move can yield ˌviːəˈtnɑːm — force dictionary split
        .replace(/ˌviːəˈtnɑːmz?/g, (m) => (m.endsWith('z') ? 'ˌviːətˈnɑːmz' : 'ˌviːətˈnɑːm'))
        .replace(/ˌviːəˈtnæmz?/g, (m) => (m.endsWith('z') ? 'ˌviːətˈnæmz' : 'ˌviːətˈnæm'))
        .replace(/ˌviːəˈtnɑmz?/g, (m) => (m.endsWith('z') ? 'ˌviːətˈnɑmz' : 'ˌviːətˈnɑm')),
    );
  }

  // Keep chip IPA aligned: one surface token → one IPA string (parts joined)
  async function ipaForToken(token, phonemize, accentVoice, accentKey, prevToken) {
    const expanded = expandToken(token);
    if (!expanded.speak) return { surface: token, speak: '', ipa: '', parts: [] };

    const key = lexiconKeyForToken(token, prevToken);
    const plain = wordKey(token);
    const accent = accentKey === 'uk' ? 'uk' : 'us';
    const lex = lexicon.wordIpa?.[key] || lexicon.wordIpa?.[plain];
    if (lex?.[accent]) {
      return {
        surface: token,
        speak: expanded.speak,
        ipa: finalizeDictIpa(lex[accent]),
        parts: expanded.parts,
      };
    }

    // Acronym / expandToken IPA beats CMU (GDP ≠ letter-name in CMU)
    if (expanded.ipa?.[accent]) {
      return {
        surface: token,
        speak: expanded.speak,
        ipa: finalizeDictIpa(expanded.ipa[accent]),
        parts: expanded.parts,
      };
    }

    // US: heteronym → CMU before eSpeak (dict IPA already placed — do not relocateStress)
    const rules = Rules();
    if (accent === 'us' && rules) {
      const het = rules.pickHeteronym(plain, prevToken);
      if (het) {
        return { surface: token, speak: expanded.speak, ipa: finalizeDictIpa(het), parts: expanded.parts };
      }
      const cmu = cmuLexicon.wordIpa?.[plain];
      if (cmu?.us) {
        return { surface: token, speak: expanded.speak, ipa: finalizeDictIpa(cmu.us), parts: expanded.parts };
      }
    }
    const raw = (await phonemize(expanded.speak, accentVoice)).join(' ');
    const ipa = applyWordIpa(token, accentKey, raw, prevToken);
    return { surface: token, speak: expanded.speak, ipa, parts: expanded.parts };
  }

  globalThis.SipaIpa = {
    loadLexicon,
    normalizeIpa,
    fixStress,
    relocateStress,
    stripMonoStress,
    stripSecondaryStress,
    ipaStartsWithVowel,
    applyLinkingForms,
    ipaCore,
    accentsDiffer,
    tokenize,
    tokenizeWordsWithBreaks,
    isPunctToken,
    wordKey,
    expandToken,
    expandSentence,
    applyWordIpa,
    pronunciationForms,
    polishSentenceIpa,
    applyWeakForms,
    ipaForToken,
    numberToWords,
  };
})();
