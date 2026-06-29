# Kodari Clone — AI Minecraft Plugin Maker

AI-powered Minecraft plugin generator with **Google + Discord login**, **multi-provider AI** (OpenAI, Gemini, OpenRouter), and **web-based model switcher**. Ready for Railway one-click deploy.

## ✨ Features

- 🔐 **Login required** — Google OAuth, Discord OAuth, or dev mode
- 🤖 **3 AI providers** — OpenAI, Gemini, OpenRouter (one key, all models)
- ⚙️ **Switch models in the web UI** — no server restart needed
- 💬 AI chat for code help
- 📁 Monaco code editor with Java syntax highlighting
- 📦 One-click ZIP export
- 💾 Project history (SQLite)
- 📋 6 starter templates
- 🌙 Dark theme
- 🚂 **Railway-ready** (Procfile, nixpacks, railway.json)

---

## 🚂 Deploy to Railway (easiest)

### 1. Push to GitHub

```bash
cd kodari-clone
git init
git add .
git commit -m "Initial commit"
gh repo create kodari-clone --public --source=. --push
# Or manually create a repo on github.com and push
```

### 2. Deploy on Railway

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your `kodari-clone` repo
3. Railway auto-detects Node.js, installs deps, and starts the server
4. Once deployed, click **Generate Domain** to get your public URL like `kodari-clone.up.railway.app`

### 3. Set environment variables

In Railway dashboard → your service → **Variables** tab, add:

#### Required:
| Key | Value |
|-----|-------|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` (get free key at https://openrouter.ai/keys) |
| `AI_PROVIDER` | `openrouter` |
| `OPENROUTER_MODEL` | `qwen/qwen-2.5-coder-32b-instruct:free` |
| `SESSION_SECRET` | any long random string (e.g. `openssl rand -hex 32`) |
| `NODE_ENV` | `production` |
| `DEV_LOGIN` | `true` (to enable test login — set `false` in real prod) |

#### Optional — OpenAI direct:
| `OPENAI_API_KEY` | `sk-proj-...` |
| `OPENAI_MODEL` | `gpt-4o-mini` |

#### Optional — Gemini direct:
| `GEMINI_API_KEY` | `...` |
| `GEMINI_MODEL` | `gemini-2.0-flash` |

#### Optional — Google OAuth:
| `GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `...` |
| `GOOGLE_CALLBACK_URL` | `https://your-app.up.railway.app/auth/google/callback` |

#### Optional — Discord OAuth:
| `DISCORD_CLIENT_ID` | `...` |
| `DISCORD_CLIENT_SECRET` | `...` |
| `DISCORD_CALLBACK_URL` | `https://your-app.up.railway.app/auth/discord/callback` |

After setting OAuth callback URLs, also add them to your Google Cloud Console / Discord Developer Portal as authorized redirect URIs.

### 4. Visit your app

Open `https://your-app.up.railway.app` → login → start building plugins!

---

## 🛠️ Local Development

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your keys
node server.js
```

Open **http://localhost:3000**

---

## ⚙️ Configuration

### AI Providers

**OpenRouter (recommended)** — single key, all models, many free:
```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=qwen/qwen-2.5-coder-32b-instruct:free
```

**OpenAI direct:**
```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
```

**Gemini direct:**
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.0-flash
```

### Switching models in the UI

Once logged into the IDE, click the model badge in the top-right (e.g. "🌐 openrouter • qwen coder 32b"). A settings modal opens where you can:

- Switch provider (OpenAI / OpenRouter / Gemini)
- Pick any model from the catalog
- Override API key (stored in browser session only)

Click **Save & Apply** — changes take effect instantly on the next AI call.

---

## 📋 Routes

| Route | Auth | Purpose |
|------|------|---------|
| `GET /` | Public | Landing |
| `GET /login` | Public | Login page |
| `GET /auth/google` | Public | Google OAuth |
| `GET /auth/discord` | Public | Discord OAuth |
| `GET /auth/dev` | Dev only | Test login |
| `POST /auth/logout` | Any | Logout |
| `GET /api/me` | Public | Current user |
| `GET /api/ai/config` | Public | Current AI provider/model + catalog |
| `POST /api/ai/config` | **Required** | Update provider/model at runtime |
| `POST /api/generate` | **Required** | Generate plugin |
| `POST /api/chat` | **Required** | AI chat |
| `POST /api/export` | **Required** | ZIP download |
| `GET /api/projects` | **Required** | User's history |
| `GET /api/templates` | Public | Template list |
| `GET /health` | Public | Status |

---

## 🗂️ File Structure

```
kodari-clone/
├── README.md
├── Procfile                # Railway start command
├── railway.json            # Railway deploy config
├── nixpacks.toml           # Build config
├── runtime.txt             # Node version
├── .gitignore
├── .dockerignore
├── backend/
│   ├── server.js           # All-in-one (auth + AI)
│   ├── package.json
│   ├── .env.example
│   └── kodari.db           # auto-created SQLite
└── frontend/
    ├── index.html
    ├── pages/
    │   ├── login.html
    │   ├── generator.html  # has settings modal
    │   ├── templates.html
    │   └── docs.html
    ├── css/{style,ide}.css
    └── js/ide.js
```

---

## ⚠️ Railway Production Notes

- **SQLite is ephemeral** — the database resets on every redeploy. For real production, swap to PostgreSQL (add Railway's free Postgres plugin and use `pg` instead of `better-sqlite3`). For a personal project/demo this is fine — users re-login after redeploy.
- **Set `NODE_ENV=production`** — enables HTTPS-only cookies.
- **Strong `SESSION_SECRET`** — generate with `openssl rand -hex 32`.
- **OAuth callback URLs** — must use your Railway HTTPS URL, not localhost.

---

## 🛠️ Tech

- Node.js + Express + Passport.js
- SQLite (better-sqlite3)
- Monaco Editor (CDN)
- Multi-provider AI (OpenAI / Gemini / OpenRouter) with runtime model switching