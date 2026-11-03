const MENU_ID = 'sentence-ipa-analyze';
// Google free RPC used by Chrome dictionary client (gtx endpoint is often bot-blocked)
const TRANSLATE_URL = 'https://clients5.google.com/translate_a/t';

const AZURE_VOICES = {
  us: 'en-US-AriaNeural',
  uk: 'en-GB-SoniaNeural',
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'IPA · Translate · Speak',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id || !info.selectionText) return;
  chrome.tabs.sendMessage(tab.id, {
    type: 'SENTENCE_IPA_OPEN',
    text: info.selectionText,
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'TRANSLATE') {
    translate(message.text, message.sl || 'en', message.tl || 'vi')
      .then((translation) => sendResponse({ ok: true, translation }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'AZURE_TTS') {
    synthesizeAzure(message.text, message.accent, message.rate)
      .then((base64) => sendResponse({ ok: true, base64 }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

async function translate(text, sl, tl) {
  const url = new URL(TRANSLATE_URL);
  url.searchParams.set('client', 'dict-chrome-ex');
  url.searchParams.set('sl', sl);
  url.searchParams.set('tl', tl);
  url.searchParams.set('q', text);

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Translate HTTP ${res.status}`);

  const contentType = res.headers.get('content-type') || '';
  const raw = await res.text();
  if (contentType.includes('text/html') || raw.trimStart().startsWith('<')) {
    throw new Error('Translate blocked by Google');
  }

  const data = JSON.parse(raw);
  // shortcut: dict-chrome-ex returns ["translated text"] (sometimes nested)
  const translation = flattenTranslate(data);
  if (!translation) throw new Error('Empty translation');
  return translation;
}

function flattenTranslate(data) {
  if (typeof data === 'string') return data;
  if (!Array.isArray(data)) return '';
  return data
    .map((part) => (Array.isArray(part) ? flattenTranslate(part) : typeof part === 'string' ? part : ''))
    .join('');
}

async function synthesizeAzure(text, accent, rate) {
  const { azureKey = '', azureRegion = 'eastus' } = await chrome.storage.local.get({
    azureKey: '',
    azureRegion: 'eastus',
  });
  if (!azureKey) throw new Error('Chưa có Azure Speech key');

  const voice = AZURE_VOICES[accent] || AZURE_VOICES.us;
  const lang = voice.startsWith('en-GB') ? 'en-GB' : 'en-US';
  const pct = Math.round(((Number(rate) || 1) - 1) * 100);
  const ssml =
    `<speak version='1.0' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${pct}%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  const region = String(azureRegion || 'eastus').trim() || 'eastus';
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': azureKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    },
    body: ssml,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 160);
    throw new Error(`Azure TTS ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const buf = await res.arrayBuffer();
  return arrayBufferToBase64(buf);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
