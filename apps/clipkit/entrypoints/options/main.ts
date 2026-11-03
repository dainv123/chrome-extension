import './style.css';
import { DEFAULT_GEMINI_MODEL } from '@repo/ai-client';
import { loadSettings, saveSettings } from '../../utils/settings';

const app = document.querySelector<HTMLDivElement>('#app');

if (app) {
  app.innerHTML = `
    <main class="card">
      <h1>ClipKit Options</h1>
      <p class="lead">
        Clip (Markdown/CSV) works offline. AI features need a free Gemini API key from
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.
      </p>

      <label>
        Gemini API key
        <input id="apiKey" type="password" autocomplete="off" placeholder="AIza…" />
      </label>

      <label>
        Model
        <input id="model" type="text" spellcheck="false" />
      </label>

      <p class="note">
        Free-tier prompts may be used by Google to improve models. Do not send secrets.
        If you ever pasted a key in chat or a public place, rotate it in AI Studio.
      </p>

      <div class="row">
        <button type="button" id="save">Save</button>
        <span id="status" role="status"></span>
      </div>
    </main>
  `;

  const apiKeyInput = app.querySelector<HTMLInputElement>('#apiKey');
  const modelInput = app.querySelector<HTMLInputElement>('#model');
  const status = app.querySelector<HTMLElement>('#status');
  const save = app.querySelector<HTMLButtonElement>('#save');

  void loadSettings().then((settings) => {
    if (apiKeyInput) {
      apiKeyInput.value = settings.apiKey;
    }
    if (modelInput) {
      modelInput.value = settings.model || DEFAULT_GEMINI_MODEL;
    }
  });

  save?.addEventListener('click', async () => {
    await saveSettings({
      apiKey: apiKeyInput?.value ?? '',
      model: modelInput?.value || DEFAULT_GEMINI_MODEL,
    });
    if (status) {
      status.textContent = 'Saved';
    }
  });
}
