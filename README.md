# Chrome apps monorepo

## Apps

| App | Path | What it does |
|---|---|---|
| **ClipKit** | `apps/clipkit` | Select → bubble; Clip & Brief → copy + `.md` |
| **JSON Bench** | `apps/json-bench` | Format / minify / diff JSON |

## ClipKit v0.4 — pain-first

**Job to be done:** đang đọc trang → lấy nội dung sạch vào clipboard/notes **không bị kẹt UI**.

| Gesture | Outcome |
|---|---|
| Bôi text → bubble Summarize / Actions / Copy MD | **Copied** + toast ~3s (auto-hide, click outside / Esc) |
| **Alt+Shift+C** hoặc Clip & Brief | **Copied + download `.md`** (Brief + full article) |
| Right-click menu | Same — **không** ép mở side panel |

Side panel chỉ khi bạn chủ động mở icon.

## Setup

```bash
pnpm build:clipkit
```

Load `apps/clipkit/dist/chrome-mv3` → Reload → Options → Gemini key.
# chrome-extension
