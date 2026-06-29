// Kodari Clone Backend v3
// AI Minecraft Plugin Maker — Google + Discord login + multi-provider AI
// Supports: OpenAI, Gemini, OpenRouter (any model)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const archiver = require('archiver');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const DiscordStrategy = require('passport-discord').Strategy;
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const DEV_LOGIN = (process.env.DEV_LOGIN || 'false').toLowerCase() === 'true';
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT;

// Railway/proxy support — trust the first proxy so cookies work over HTTPS
if (IS_PRODUCTION) {
  app.set('trust proxy', 1);
}

app.use(cors({
  origin: IS_PRODUCTION ? false : true,  // In production, same-origin only
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '../frontend')));

// ===== Database =====
const db = new Database(path.join(__dirname, 'kodari.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    email TEXT,
    name TEXT,
    avatar TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_id)
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mc_version TEXT,
    files TEXT,
    summary TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// ===== Session =====
app.use(session({
  secret: process.env.SESSION_SECRET || 'kodari-dev-secret-please-set-SESSION_SECRET-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,  // cookies over HTTPS only in production
  },
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user);
});

// ===== Google OAuth =====
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || (IS_PRODUCTION ? null : '/auth/google/callback');
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    const user = upsertUser({
      provider: 'google',
      provider_id: profile.id,
      email: profile.emails?.[0]?.value,
      name: profile.displayName,
      avatar: profile.photos?.[0]?.value,
    });
    done(null, user);
  }));
  console.log('✅ Google OAuth configured');
}

// ===== Discord OAuth =====
const DISCORD_CALLBACK_URL = process.env.DISCORD_CALLBACK_URL || (IS_PRODUCTION ? null : '/auth/discord/callback');
if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
  passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: DISCORD_CALLBACK_URL || '/auth/discord/callback',
    scope: ['identify', 'email'],
  }, (accessToken, refreshToken, profile, done) => {
    const user = upsertUser({
      provider: 'discord',
      provider_id: profile.id,
      email: profile.email,
      name: profile.username,
      avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
    });
    done(null, user);
  }));
  console.log('✅ Discord OAuth configured');
}

function upsertUser({ provider, provider_id, email, name, avatar }) {
  const existing = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get(provider, provider_id);
  if (existing) {
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP, name = ?, avatar = ?, email = ? WHERE id = ?')
      .run(name, avatar, email, existing.id);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  }
  const info = db.prepare('INSERT INTO users (provider, provider_id, email, name, avatar) VALUES (?, ?, ?, ?, ?)')
    .run(provider, provider_id, email, name, avatar);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

// ===== Auth middleware =====
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Login required', loginUrl: '/login' });
}

// ===== Auth Routes =====
app.get('/auth/dev', (req, res) => {
  if (!DEV_LOGIN) return res.status(404).send('Not found');
  const user = upsertUser({
    provider: 'dev',
    provider_id: 'dev-user-' + (req.query.name || 'tester'),
    email: 'dev@kodari.local',
    name: req.query.name || 'Dev Tester',
    avatar: null,
  });
  req.login(user, (err) => {
    if (err) return res.status(500).send('Login failed');
    res.redirect('/generator');
  });
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=google' }),
  (req, res) => res.redirect('/generator'));

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: '/login?error=discord' }),
  (req, res) => res.redirect('/generator'));

app.post('/auth/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated()) {
    return res.json({
      authenticated: true,
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        avatar: req.user.avatar,
        provider: req.user.provider,
      },
    });
  }
  res.json({ authenticated: false });
});

// ==========================================
// MULTI-PROVIDER AI
// ==========================================
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-exp:free';
const OPENROUTER_SITE_URL = process.env.OPENROUTER_SITE_URL || 'http://localhost:3000';
const OPENROUTER_APP_NAME = process.env.OPENROUTER_APP_NAME || 'Kodari Clone';

console.log(`\n🎮 Kodari Clone Backend v3`);
console.log(`📡 http://localhost:${PORT}`);
console.log(`🌍 Environment: ${IS_PRODUCTION ? 'PRODUCTION' : 'development'}`);
console.log(`🤖 AI Provider: ${AI_PROVIDER}`);
console.log(`   OpenAI: ${OPENAI_API_KEY ? '✅' : '❌'} | Gemini: ${GEMINI_API_KEY ? '✅' : '❌'} | OpenRouter: ${OPENROUTER_API_KEY ? '✅' : '❌'}`);
console.log(`🔐 Dev Login: ${DEV_LOGIN ? '✅' : '❌'}`);
console.log(`🔵 Google: ${process.env.GOOGLE_CLIENT_ID ? '✅' : '❌'}`);
console.log(`🟣 Discord: ${process.env.DISCORD_CLIENT_ID ? '✅' : '❌'}\n`);

if (IS_PRODUCTION) {
  console.log('⚠️  Production deployment notes:');
  console.log('   • SQLite database is ephemeral — data resets on redeploy');
  console.log('   • Set GOOGLE_CALLBACK_URL and DISCORD_CALLBACK_URL to your Railway URL');
  console.log('   • Set NODE_ENV=production for secure cookies');
  console.log('   • Set SESSION_SECRET to a strong random string\n');
}

if (!process.env.SESSION_SECRET && IS_PRODUCTION) {
  console.warn('⚠️  SESSION_SECRET not set! Using insecure default. Set it in Railway env vars.');
}

// ===== OpenAI =====
async function callOpenAI(systemPrompt, userPrompt, jsonMode = true, model = OPENAI_MODEL) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ===== OpenRouter =====
async function callOpenRouter(systemPrompt, userPrompt, jsonMode = true, model = OPENROUTER_MODEL) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': OPENROUTER_SITE_URL,
      'X-Title': OPENROUTER_APP_NAME,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ===== Gemini =====
async function callGemini(systemPrompt, userPrompt, model = GEMINI_MODEL) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const m = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt });
  const result = await m.generateContent(userPrompt);
  return result.response.text();
}

// ===== Runtime config (can be overridden via /api/ai/config POST) =====
const runtimeConfig = {
  provider: AI_PROVIDER,
  models: {
    openai: OPENAI_MODEL,
    openrouter: OPENROUTER_MODEL,
    gemini: GEMINI_MODEL,
  },
  apiKeys: {
    openai: OPENAI_API_KEY,
    openrouter: OPENROUTER_API_KEY,
    gemini: GEMINI_API_KEY,
  },
};

// ===== Unified AI caller =====
async function callAI(systemPrompt, userPrompt, jsonMode = true) {
  const provider = runtimeConfig.provider;
  switch (provider) {
    case 'openai':
      if (!runtimeConfig.apiKeys.openai) throw new Error('OpenAI API key not configured. Add it in Settings or .env');
      return callOpenAI(systemPrompt, userPrompt, jsonMode, runtimeConfig.models.openai);
    case 'openrouter':
      if (!runtimeConfig.apiKeys.openrouter) throw new Error('OpenRouter API key not configured. Add it in Settings or .env');
      return callOpenRouter(systemPrompt, userPrompt, jsonMode, runtimeConfig.models.openrouter);
    case 'gemini':
      if (!runtimeConfig.apiKeys.gemini) throw new Error('Gemini API key not configured. Add it in Settings or .env');
      return callGemini(systemPrompt, userPrompt, runtimeConfig.models.gemini);
    default:
      throw new Error(`Unknown provider: ${provider}. Use openai | openrouter | gemini`);
  }
}

async function callAIChat(systemPrompt, userPrompt, history = []) {
  const provider = runtimeConfig.provider;
  if (provider === 'openai' || provider === 'openrouter') {
    const model = provider === 'openrouter' ? runtimeConfig.models.openrouter : runtimeConfig.models.openai;
    const key = provider === 'openrouter' ? runtimeConfig.apiKeys.openrouter : runtimeConfig.apiKeys.openai;
    const url = provider === 'openrouter'
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    };
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = OPENROUTER_SITE_URL;
      headers['X-Title'] = OPENROUTER_APP_NAME;
    }
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role === 'model' ? 'assistant' : 'user', content: h.content })),
      { role: 'user', content: userPrompt },
    ];
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `${provider} failed`);
    return data.choices[0].message.content;
  }
  if (provider === 'gemini') {
    return callGemini(systemPrompt, userPrompt, runtimeConfig.models.gemini);
  }
  throw new Error('No AI provider configured');
}

// ===== Prompts =====
const SYSTEM_PROMPT_GENERATE = `You are Kodari, an expert Minecraft plugin developer. Generate clean, working Java code for Bukkit/Spigot/Paper plugins.

Rules:
- Use Java 17
- Use the Bukkit/Spigot/Paper API
- Return ONLY valid JSON, no markdown fences
- Include proper package declaration
- Use modern Paper API when possible
- Add comments explaining key parts
- Include main class with onEnable() and onDisable()

You MUST return a JSON object with this exact structure:
{
  "files": {
    "src/main/java/com/kodari/<PluginName>.java": "...full java code...",
    "src/main/resources/plugin.yml": "...yml content...",
    "pom.xml": "...maven config...",
    "README.md": "...readme..."
  },
  "summary": "Brief description of what was created"
}`;

const SYSTEM_PROMPT_CHAT = `You are Kodari AI, a friendly Minecraft plugin development assistant. Help users with Java, Bukkit/Spigot/Paper API, plugin.yml, Maven, Gradle, and best practices. Keep answers concise and code-focused. Use markdown for code blocks.`;

// ===== Public endpoints =====

// Curated model lists per provider
const MODEL_CATALOG = {
  openai: [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast, cheap, great for code ($0.15/M tokens)' },
    { id: 'gpt-4o', name: 'GPT-4o', description: 'Best OpenAI model, expensive ($2.50/M)' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'Previous gen flagship' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Cheapest, decent quality' },
    { id: 'o1-mini', name: 'o1-mini', description: 'Reasoning model (beta)' },
  ],
  openrouter: [
    { id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: '⭐ Qwen 2.5 Coder 32B (Free)', description: 'Best free model for code generation' },
    { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', description: 'Fast multimodal, free tier' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', description: 'Strong general purpose, free' },
    { id: 'deepseek/deepseek-chat:free', name: 'DeepSeek V3 (Free)', description: 'Excellent reasoning, free' },
    { id: 'mistralai/mistral-small-3.2-24b-instruct:free', name: 'Mistral Small 3.2 (Free)', description: 'Fast European model, free' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Via OpenRouter ($0.15/M)' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Top quality ($3/M)' },
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google flagship ($1.25/M)' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Latest fast model' },
    { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', description: 'Cheapest, fastest' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Most capable' },
    { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Previous gen' },
    { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Fast, cheap' },
  ],
};

app.get('/api/ai/config', (req, res) => {
  res.json({
    current: {
      provider: runtimeConfig.provider,
      model: runtimeConfig.models[runtimeConfig.provider],
    },
    available: {
      openai: !!runtimeConfig.apiKeys.openai,
      openrouter: !!runtimeConfig.apiKeys.openrouter,
      gemini: !!runtimeConfig.apiKeys.gemini,
    },
    models: MODEL_CATALOG,
  });
});

// Update runtime config (no server restart needed)
app.post('/api/ai/config', requireAuth, (req, res) => {
  const { provider, model, apiKey } = req.body;
  if (provider && ['openai', 'openrouter', 'gemini'].includes(provider)) {
    if (!runtimeConfig.apiKeys[provider] && !apiKey) {
      return res.status(400).json({ error: `Provider "${provider}" has no API key configured. Provide one.` });
    }
    runtimeConfig.provider = provider;
    if (apiKey) runtimeConfig.apiKeys[provider] = apiKey;
  }
  if (model && MODEL_CATALOG[runtimeConfig.provider]?.some((m) => m.id === model)) {
    runtimeConfig.models[runtimeConfig.provider] = model;
  }
  res.json({
    success: true,
    current: {
      provider: runtimeConfig.provider,
      model: runtimeConfig.models[runtimeConfig.provider],
    },
  });
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { prompt, pluginName = 'MyPlugin', mcVersion = '1.20.4' } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const userPrompt = `Create a Minecraft plugin called "${pluginName}" for MC version ${mcVersion}.\n\nUser request: ${prompt}\n\nReturn a JSON object with files and summary.`;

    const text = await callAI(SYSTEM_PROMPT_GENERATE, userPrompt, true);

    let parsed;
    try {
      parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (e) {
      const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch (e2) {
        parsed = {
          files: {
            [`src/main/java/com/kodari/${pluginName}.java`]: text,
            'src/main/resources/plugin.yml': `name: ${pluginName}\nversion: 1.0\nmain: com.kodari.${pluginName}\napi-version: '1.20'\n`,
          },
          summary: 'Plugin generated (raw mode)',
        };
      }
    }

    try {
      db.prepare('INSERT INTO projects (user_id, name, mc_version, files, summary) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, pluginName, mcVersion, JSON.stringify(parsed.files || {}), parsed.summary || '');
    } catch (e) { console.error('Save failed:', e.message); }

    res.json({
      success: true,
      pluginName,
      mcVersion,
      files: parsed.files || {},
      summary: parsed.summary || 'Plugin generated successfully',
      provider: AI_PROVIDER,
      model: AI_PROVIDER === 'openrouter' ? OPENROUTER_MODEL : AI_PROVIDER === 'openai' ? OPENAI_MODEL : GEMINI_MODEL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Generate error:', err.message);
    res.status(500).json({ error: 'Failed to generate plugin', details: err.message });
  }
});

app.post('/api/chat', requireAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const reply = await callAIChat(SYSTEM_PROMPT_CHAT, message, history);
    res.json({ success: true, reply });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});

app.get('/api/templates', (req, res) => {
  res.json({
    success: true,
    templates: [
      { id: 'lightning-sword', name: '⚡ Lightning Sword', description: 'A sword that strikes lightning on right-click', prompt: 'Create a custom sword item that when right-clicked, summons lightning at the target location and deals extra damage.', icon: '⚡', difficulty: 'easy' },
      { id: 'join-message', name: '👋 Welcome Message', description: 'Custom join/quit broadcasts with sounds', prompt: 'Create a plugin that sends a custom colored welcome message when players join, a goodbye message when they leave, and plays a note block sound on first join.', icon: '👋', difficulty: 'beginner' },
      { id: 'custom-command', name: '💬 Custom Command', description: '/heal, /feed, /gm commands with tab completion', prompt: 'Create custom commands /heal (heals player), /feed (feeds player), and /gm <0|1|2|3> (changes gamemode) with proper tab completion and permission nodes kodari.heal, kodari.feed, kodari.gm.', icon: '💬', difficulty: 'easy' },
      { id: 'economy', name: '💰 Simple Economy', description: 'Player balance, /pay, /balance commands', prompt: 'Create a basic economy plugin with commands /balance (shows coins), /pay <player> <amount> (transfers coins), /eco give/take/set <player> <amount> (admin). Store balances in a config.yml file.', icon: '💰', difficulty: 'medium' },
      { id: 'minigame', name: '🎮 PvP Arena', description: 'Set spawn, teleport players, count down', prompt: 'Create a PvP arena plugin with /arena set, /arena join, /arena leave commands. On join, teleport to spawn, give kit (iron sword, bow, 32 arrows, cooked beef). On leave, restore inventory.', icon: '🎮', difficulty: 'advanced' },
      { id: 'block-logger', name: '📋 Block Logger', description: 'Log block breaks/places to file', prompt: 'Create a plugin that logs every block break and place event with player name, coordinates, block type, and timestamp to a daily log file in plugins/KodariLogger/logs/.', icon: '📋', difficulty: 'medium' },
    ],
  });
});

app.post('/api/export', requireAuth, async (req, res) => {
  try {
    const { pluginName = 'MyPlugin', files = {} } = req.body;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${pluginName}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    for (const [filepath, content] of Object.entries(files)) {
      archive.append(content, { name: filepath });
    }
    archive.append(`# How to build ${pluginName}.jar\n\n1. Install Maven\n2. Run: mvn clean package\n3. Copy .jar to plugins/ folder\n\nGenerated by Kodari AI`, { name: 'BUILD.txt' });
    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: 'Export failed', details: err.message });
  }
});

app.get('/api/projects', requireAuth, (req, res) => {
  const projects = db.prepare('SELECT id, name, mc_version, summary, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  res.json({ success: true, projects });
});

// ===== Frontend routes =====
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../frontend/pages/login.html')));
app.get('/generator', (req, res) => res.sendFile(path.join(__dirname, '../frontend/pages/generator.html')));
app.get('/templates', (req, res) => res.sendFile(path.join(__dirname, '../frontend/pages/templates.html')));
app.get('/docs', (req, res) => res.sendFile(path.join(__dirname, '../frontend/pages/docs.html')));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ai: {
      provider: AI_PROVIDER,
      openai: !!OPENAI_API_KEY,
      openrouter: !!OPENROUTER_API_KEY,
      gemini: !!GEMINI_API_KEY,
    },
    auth: {
      dev: DEV_LOGIN,
      google: !!process.env.GOOGLE_CLIENT_ID,
      discord: !!process.env.DISCORD_CLIENT_ID,
    },
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => console.log(`🎮 Kodari running at http://localhost:${PORT}`));