# Chrome apps monorepo

| App | Path | What it does |
|---|---|---|
| **Sentence IPA · VN** | `apps/sentence-ipa` | Bôi câu EN/VI → IPA, dịch, TTS, nối âm |
| **ClipKit** | `apps/clipkit` | Select → bubble; Clip & Brief → copy + `.md` |
| **JSON Bench** | `apps/json-bench` | Format / minify / diff JSON |

---

## Sentence IPA · VN (v1.11.3)

Bôi đoạn trên trang → panel cạnh selection: **EN → IPA (US|UK) → VI**, nghe từng đoạn hoặc tất cả, bảng từ, copy.

### Cài đặt

**Load unpacked (dev):**

1. `chrome://extensions` → bật **Developer mode**
2. **Load unpacked** → chọn thư mục `apps/sentence-ipa` (không chọn `.zip`)

**Hoặc kéo zip** `apps/sentence-ipa-v1.11.3.zip` vào trang extensions  
(zip phải có `manifest.json` ở gốc — đã đóng đúng từ v1.11.2).

Reload extension sau mỗi lần sửa code.

### Dùng nhanh

| Gesture | Outcome |
|---|---|
| Bôi text → nút nổi / chuột phải **Sentence IPA** | Mở panel |
| `▶` từng đoạn / **Nghe tất cả** | TTS + highlight IPA theo lời |
| Click từ trên dòng IPA | Popover US/UK + nghe từ |
| **Xem tất cả từ** | Bảng Từ / US / UK (đã bỏ trùng) |
| `Sao chép ▾` | EN / IPA / cả hai |
| `US \| UK` · `1×` · lặp (`L`) | Giọng, tốc độ, loop |
| `⋯` | Chiều dịch, TTS hệ thống/Azure, ChatGPT prompts, hướng dẫn |

Phím: `Space` nghe/dừng · `C` copy · `L` lặp · `Esc` đóng. Kéo thanh tiêu đề để di chuyển panel.

### IPA & nối âm

- Tokenizer: số/`$300B`, hyphen (`browser-based`), acronym (`API` → `eɪpiːˈaɪ`), CamelCase speak (`Speech Recognition`)
- `ipa-link.js`: weak forms (`ðə`, `ənd`, …), dấu nối `‿` (khối `.lk` không tách dòng)
- `( )` và dấu câu = ranh giới cụm (không nối âm xuyên ngoặc)
- Lexicon tech: API, SDK, URL, UI, UX, LLM, TTS, JSON, …

### TTS

- Mặc định: **Web Speech** (ưu tiên US Nicky / UK Google Female khi có)
- Tuỳ chọn: Azure Neural (`⋯` → key + region; xem `guide.html`)

### Dev / test

```bash
cd apps/sentence-ipa
node tests/ipa-link.golden.mjs
node tests/ipa-rules.golden.mjs
node tests/ipa-golden.mjs
```

Đóng zip (manifest ở gốc):

```bash
cd apps/sentence-ipa && zip -r ../sentence-ipa-v1.11.3.zip . \
  -x 'tests/*' -x 'reports/*' -x 'scripts/*' -x '*.DS_Store'
```

### Cấu trúc chính

```
apps/sentence-ipa/
  content.js      # panel UI, TTS, highlight
  ipa-lib.js      # tokenize, lexicon, eSpeak
  ipa-link.js     # nối âm / weak forms
  ipa-rules.js    # normalize US/UK, heteronyms
  lexicon.json    # acronyms + weak forms
  styles.css
  guide.html
  manifest.json   # MV3
```

---

## ClipKit

```bash
pnpm build:clipkit
```

Load `apps/clipkit/dist/chrome-mv3` → Options → Gemini key.
