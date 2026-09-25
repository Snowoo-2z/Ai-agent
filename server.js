const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = Number(process.env.PORT) || 10000;
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.SESSION_SECRET || (isProduction ? '' : 'local-development-session-secret');

const config = {
  githubToken: process.env.GITHUB_TOKEN,
  githubOwner: process.env.GITHUB_OWNER,
  githubRepo: process.env.GITHUB_REPO,
  githubBranch: process.env.GITHUB_BRANCH || 'main',
  mistralApiKey: process.env.MISTRAL_API_KEY,
  mistralModel: process.env.MISTRAL_MODEL || 'ministral-8b-latest',
  tavilyApiKey: process.env.TAVILY_API_KEY
};

class AppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.expose = options.expose !== false;
    this.cause = options.cause;
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireSetting(value, name) {
  if (!value) {
    throw new AppError(503, `La configuration ${name} est manquante.`);
  }
}

function githubEndpoint(repoPath) {
  const encodedPath = repoPath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/repos/${encodeURIComponent(config.githubOwner)}/${encodeURIComponent(config.githubRepo)}/contents/${encodedPath}`;
}

async function githubRequest(endpoint, options = {}) {
  requireSetting(config.githubToken, 'GITHUB_TOKEN');
  requireSetting(config.githubOwner, 'GITHUB_OWNER');
  requireSetting(config.githubRepo, 'GITHUB_REPO');

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.githubToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'aster-chat',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  let response;
  try {
    response = await fetch(`https://api.github.com${endpoint}`, {
      ...options,
      headers
    });
  } catch (error) {
    throw new AppError(502, 'GitHub est momentanément inaccessible.', { cause: error });
  }

  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
  }

  if (!response.ok) {
    const githubMessage = typeof data?.message === 'string' ? data.message : '';
    if (response.status === 404) {
      throw new AppError(404, 'Ressource GitHub introuvable.', { cause: githubMessage });
    }
    if (response.status === 409) {
      throw new AppError(409, 'Le dépôt GitHub a changé. Réessaie dans un instant.', { cause: githubMessage });
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError(502, 'Le dépôt GitHub refuse cette opération.', { cause: githubMessage });
    }
    throw new AppError(502, 'GitHub n’a pas pu traiter cette opération.', { cause: githubMessage });
  }

  return { data, response };
}

function decodeGitHubFile(data) {
  if (!data || data.type !== 'file' || typeof data.content !== 'string') {
    throw new AppError(502, 'Le fichier GitHub est dans un format inattendu.');
  }
  try {
    return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  } catch (error) {
    throw new AppError(502, 'Impossible de décoder un fichier GitHub.', { cause: error });
  }
}

async function readJsonFile(repoPath, { optional = false } = {}) {
  try {
    const { data } = await githubRequest(githubEndpoint(repoPath));
    const raw = decodeGitHubFile(data);
    try {
      return { value: JSON.parse(raw), sha: data.sha };
    } catch (error) {
      throw new AppError(502, 'Un fichier de données GitHub contient un JSON invalide.', { cause: error });
    }
  } catch (error) {
    if (optional && error instanceof AppError && error.status === 404) return null;
    throw error;
  }
}

async function writeJsonFile(repoPath, value, { sha, message }) {
  const body = {
    message,
    content: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8').toString('base64'),
    branch: config.githubBranch
  };
  if (sha) body.sha = sha;

  const { data } = await githubRequest(githubEndpoint(repoPath), {
    method: 'PUT',
    body: JSON.stringify(body)
  });

  return { sha: data?.content?.sha || data?.commit?.sha };
}

async function deleteGitHubFile(repoPath, sha, message) {
  await githubRequest(githubEndpoint(repoPath), {
    method: 'DELETE',
    body: JSON.stringify({
      message,
      sha,
      branch: config.githubBranch
    })
  });
}

async function listGitHubDirectory(repoPath) {
  try {
    const { data } = await githubRequest(githubEndpoint(repoPath));
    if (!Array.isArray(data)) return [];
    return data.filter((entry) => entry.type === 'file' && entry.name.endsWith('.json'));
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return [];
    throw error;
  }
}

function normalizeUsername(input) {
  const username = String(input || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{2,23})$/.test(username) || username === '.' || username === '..') {
    throw new AppError(400, 'Le pseudo doit contenir 3 à 24 caractères (lettres, chiffres, point, tiret ou underscore).');
  }
  return username;
}

function normalizeEmail(input) {
  const email = String(input || '').trim().toLowerCase();
  if (email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(400, 'Adresse email invalide.');
  }
  return email;
}

function validatePassword(input) {
  if (typeof input !== 'string' || input.length < 8 || input.length > 128) {
    throw new AppError(400, 'Le mot de passe doit contenir entre 8 et 128 caractères.');
  }
  return input;
}

function cleanText(input, maxLength = 12000) {
  const value = String(input ?? '').trim();
  if (!value) throw new AppError(400, 'Le message ne peut pas être vide.');
  if (value.length > maxLength) throw new AppError(400, `Le message est limité à ${maxLength} caractères.`);
  return value;
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derivedKey).toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== 'string') return false;
  const [algorithm, saltHex, keyHex] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !keyHex) return false;
  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const actual = Buffer.from(await scrypt(password, salt, expected.length, { N: 16384, r: 8, p: 1 }));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sessionCookie(username) {
  if (!SESSION_SECRET) throw new AppError(503, 'La configuration SESSION_SECRET est manquante.');
  const payload = Buffer.from(JSON.stringify({
    username,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = value;
    return cookies;
  }, {});
}

function sessionUsername(req) {
  const token = readCookies(req.headers.cookie).aster_session;
  if (!token || !SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.username || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return normalizeUsername(decoded.username);
  } catch {
    return null;
  }
}

function setSession(res, username) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `aster_session=${sessionCookie(username)}; Max-Age=${SESSION_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearSession(res) {
  const secure = isProduction ? '; Secure' : '';
  res.setHeader('Set-Cookie', `aster_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function requireAuth(req, res, next) {
  const username = sessionUsername(req);
  if (!username) return res.status(401).json({ error: 'Ta session a expiré. Reconnecte-toi.' });
  req.username = username;
  next();
}

function publicProfile(profile) {
  return { pseudo: profile.pseudo, email: profile.email, createdAt: profile.createdAt };
}

function profilePath(username) {
  return `users/${username}/profile.json`;
}

function conversationsPath(username) {
  return `users/${username}/conversations`;
}

function conversationPath(username, id) {
  return `${conversationsPath(username)}/${id}.json`;
}

function validateConversationId(id) {
  if (!/^conv_[a-zA-Z0-9-]{10,80}$/.test(id)) {
    throw new AppError(400, 'Identifiant de conversation invalide.');
  }
  return id;
}

function makeConversationTitle(text) {
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() || 'Nouvelle conversation';
  return firstLine.length > 48 ? `${firstLine.slice(0, 47).trimEnd()}…` : firstLine;
}

function newConversation(title = 'Nouvelle conversation') {
  return {
    id: `conv_${crypto.randomUUID()}`,
    title: title.trim().slice(0, 80) || 'Nouvelle conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
}

function conversationSummary(conversation) {
  const lastMessage = conversation.messages?.[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
    preview: lastMessage?.content?.slice(0, 96) || 'Aucun message pour le moment'
  };
}

function validateConversationShape(conversation, expectedId) {
  if (!conversation || conversation.id !== expectedId || !Array.isArray(conversation.messages)) {
    throw new AppError(502, 'Cette conversation est invalide.');
  }
  return conversation;
}

async function getUserProfile(username) {
  const result = await readJsonFile(profilePath(username), { optional: true });
  return result?.value || null;
}

async function getConversation(username, id, { optional = false } = {}) {
  validateConversationId(id);
  const result = await readJsonFile(conversationPath(username, id), { optional: true });
  if (!result) {
    if (optional) return null;
    throw new AppError(404, 'Conversation introuvable.');
  }
  return { conversation: validateConversationShape(result.value, id), sha: result.sha };
}

function parisClock(date = new Date()) {
  const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
  const timeFormatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    hourCycle: 'h23'
  });
  const yearFormatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric'
  });
  return {
    date: dateFormatter.format(date),
    time: timeFormatter.format(date),
    year: yearFormatter.format(date),
    iso: date.toISOString(),
    timezone: 'Europe/Paris'
  };
}

async function fetchExternalJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchWeb(query) {
  const cleanQuery = String(query || '').trim().slice(0, 240);
  if (!cleanQuery) return { error: 'La recherche est vide.' };

  if (config.tavilyApiKey) {
    const tavily = await fetchExternalJson('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.tavilyApiKey,
        query: cleanQuery,
        search_depth: 'basic',
        max_results: 5,
        include_answer: true
      })
    });
    if (tavily) {
      return {
        provider: 'Tavily',
        query: cleanQuery,
        answer: tavily.answer || null,
        results: (tavily.results || []).slice(0, 5).map((result) => ({
          title: String(result.title || '').slice(0, 200),
          url: String(result.url || '').slice(0, 500),
          content: String(result.content || '').slice(0, 1200)
        }))
      };
    }
  }

  const duck = await fetchExternalJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=0`);
  if (!duck) return { provider: 'DuckDuckGo', query: cleanQuery, results: [], error: 'Le moteur de recherche est momentanément indisponible.' };

  const results = [];
  if (duck.AbstractText && duck.AbstractURL) {
    results.push({
      title: duck.Heading || cleanQuery,
      url: duck.AbstractURL,
      content: duck.AbstractText.slice(0, 1200)
    });
  }
  const collectTopics = (topics = []) => {
    for (const topic of topics) {
      if (results.length >= 5) break;
      if (topic.Text && topic.FirstURL) {
        results.push({ title: topic.Text.split(' - ')[0].slice(0, 200), url: topic.FirstURL, content: topic.Text.slice(0, 1200) });
      } else if (Array.isArray(topic.Topics)) {
        collectTopics(topic.Topics);
      }
    }
  };
  collectTopics(duck.RelatedTopics);
  return { provider: 'DuckDuckGo', query: cleanQuery, results };
}

const advancedMarkdownCommands = [
  {
    command: 'diagram',
    aliases: ['schéma', 'schema', 'diagramme', 'flowchart', 'flux'],
    description: 'Construit un schéma SVG de flux avec des nœuds, des connexions, des flèches et des libellés.',
    syntax: '```advanced-diagram\n{"width":600,"height":300,"nodes":[{"id":"user","x":40,"y":110,"width":120,"height":60,"label":"Utilisateur"}],"edges":[]}\n```'
  },
  {
    command: 'geometry',
    aliases: ['figure', 'schéma', 'schema', 'diagramme', 'géométrie', 'geometrie'],
    description: 'Construit une figure géométrique SVG avec grille, axes, points, segments, polygones et cercles.',
    syntax: '```advanced-geometry\n{"width":100,"height":100,"polygons":[{"points":[[10,80],[50,10],[90,80]]}],"points":[{"x":50,"y":10,"label":"A"}]}\n```'
  },
  {
    command: 'chart',
    aliases: ['graphique', 'graphe', 'courbe'],
    description: 'Construit un graphique SVG de type line, bar ou scatter à partir de séries numériques.',
    syntax: '```advanced-chart\n{"type":"line","labels":["Jan","Fév","Mar"],"series":[{"name":"Série A","values":[12,19,15]}]}\n```'
  },
  {
    command: 'math',
    aliases: ['mathématiques', 'mathematiques', 'formule'],
    description: 'Affiche une formule, une équation et ses étapes de résolution dans un bloc mathématique lisible.',
    syntax: '```advanced-math\n{"expression":"a² + b² = c²","steps":["...","..."]}\n```'
  }
];

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function advancedText(value, fallback = '', maxLength = 240) {
  const text = String(value ?? fallback).trim();
  return text.slice(0, maxLength);
}

function advancedPoint(value) {
  if (Array.isArray(value)) {
    return { x: clampNumber(value[0], -10000, 10000, 0), y: clampNumber(value[1], -10000, 10000, 0) };
  }
  if (!value || typeof value !== 'object') return null;
  return {
    x: clampNumber(value.x, -10000, 10000, 0),
    y: clampNumber(value.y, -10000, 10000, 0),
    label: advancedText(value.label, '', 48),
    color: advancedText(value.color, '', 40)
  };
}

function advancedPointList(values, max = 80) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, max).map(advancedPoint).filter(Boolean);
}

function normalizeDiagramSpec(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const width = clampNumber(source.width, 240, 1600, 600);
  const height = clampNumber(source.height, 160, 1000, 300);
  const rawNodes = Array.isArray(source.nodes) ? source.nodes.slice(0, 40) : [];
  const defaultWidth = Math.min(150, Math.max(84, width / Math.max(rawNodes.length, 1) - 24));
  const defaultHeight = 56;
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(rawNodes.length, 1))));
  const nodes = rawNodes.map((node, index) => {
    const nodeWidth = clampNumber(node?.width, 48, 360, defaultWidth);
    const nodeHeight = clampNumber(node?.height, 30, 180, defaultHeight);
    const hasX = Number.isFinite(Number(node?.x ?? node?.left));
    const hasY = Number.isFinite(Number(node?.y ?? node?.top));
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: advancedText(node?.id ?? node?.key, `node-${index + 1}`, 64),
      x: clampNumber(node?.x ?? node?.left, 0, width - nodeWidth, 24 + column * (nodeWidth + 42)),
      y: clampNumber(node?.y ?? node?.top, 0, height - nodeHeight, 30 + row * (nodeHeight + 34)),
      width: nodeWidth,
      height: nodeHeight,
      label: advancedText(node?.label ?? node?.text ?? node?.name, `Nœud ${index + 1}`, 160),
      fill: advancedText(node?.fill ?? node?.background, '', 40),
      color: advancedText(node?.color ?? node?.stroke, '', 40),
      shape: ['ellipse', 'circle', 'diamond'].includes(String(node?.shape || '').toLowerCase()) ? String(node.shape).toLowerCase() : 'rect',
      labelPosition: advancedText(node?.labelPosition, 'center', 20)
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(source.edges) ? source.edges : (source.connections || [])).slice(0, 80).map((edge) => ({
    from: Number.isInteger(edge?.from) ? nodes[edge.from]?.id : advancedText(edge?.from ?? edge?.source ?? edge?.start, '', 64),
    to: Number.isInteger(edge?.to) ? nodes[edge.to]?.id : advancedText(edge?.to ?? edge?.target ?? edge?.end, '', 64),
    startX: clampNumber(edge?.startX ?? edge?.x1, 0, width, 0),
    startY: clampNumber(edge?.startY ?? edge?.y1, 0, height, 0),
    endX: clampNumber(edge?.endX ?? edge?.x2, 0, width, 0),
    endY: clampNumber(edge?.endY ?? edge?.y2, 0, height, 0),
    label: advancedText(edge?.label ?? edge?.text, '', 100),
    color: advancedText(edge?.color ?? edge?.stroke, '', 40),
    dashed: Boolean(edge?.dashed),
    arrow: edge?.arrow !== false
  })).filter((edge) => (edge.from && nodeIds.has(edge.from)) || (edge.to && nodeIds.has(edge.to)) || (edge.endX !== 0 || edge.endY !== 0));
  return {
    width,
    height,
    title: advancedText(source.title, 'Schéma', 120),
    grid: source.grid === false ? false : { step: clampNumber(source.grid?.step, 1, 1000, 20) },
    axes: false,
    nodes,
    edges
  };
}

function normalizeGeometrySpec(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const width = clampNumber(source.width ?? source.viewBox?.width, 40, 10000, 100);
  const height = clampNumber(source.height ?? source.viewBox?.height, 40, 10000, 100);
  const points = advancedPointList(source.points || source.vertices || source.coordinates);
  const pointAt = (value) => {
    if (Number.isInteger(value) && points[value]) return points[value];
    return advancedPoint(value);
  };
  const normalizePair = (value) => {
    if (!Array.isArray(value) || value.length < 2) return null;
    const from = pointAt(value[0]);
    const to = pointAt(value[1]);
    return from && to ? { from, to, label: advancedText(value.label, '', 48), color: advancedText(value.color, '', 40), dashed: Boolean(value.dashed) } : null;
  };
  const segments = (Array.isArray(source.segments) ? source.segments : (source.edges || []))
    .slice(0, 100)
    .map((segment) => {
      if (Array.isArray(segment)) return normalizePair(segment);
      return normalizePair([segment?.from, segment?.to]) && {
        ...normalizePair([segment?.from, segment?.to]),
        label: advancedText(segment?.label, '', 48),
        color: advancedText(segment?.color, '', 40),
        dashed: Boolean(segment?.dashed)
      };
    })
    .filter(Boolean);
  const polygons = (Array.isArray(source.polygons) ? source.polygons : []).slice(0, 30).map((polygon) => ({
    points: advancedPointList(polygon?.points || polygon, 80),
    label: advancedText(polygon?.label, '', 48),
    fill: advancedText(polygon?.fill, '', 40),
    color: advancedText(polygon?.color || polygon?.stroke, '', 40)
  })).filter((polygon) => polygon.points.length >= 3);
  if (!polygons.length && ['triangle', 'polygon'].includes(String(source.shape || '').toLowerCase()) && points.length >= 3) {
    polygons.push({ points, label: advancedText(source.label, '', 48), fill: advancedText(source.fill, '', 40), color: advancedText(source.color, '', 40) });
  }
  const circles = (Array.isArray(source.circles) ? source.circles : []).slice(0, 40).map((circle) => ({
    center: advancedPoint(circle?.center || { x: circle?.cx, y: circle?.cy }),
    radius: clampNumber(circle?.radius ?? circle?.r, 0.1, 10000, 10),
    label: advancedText(circle?.label, '', 48),
    color: advancedText(circle?.color || circle?.stroke, '', 40),
    fill: advancedText(circle?.fill, '', 40)
  })).filter((circle) => circle.center);
  if (!circles.length && String(source.shape || '').toLowerCase() === 'circle' && source.center) {
    circles.push({ center: advancedPoint(source.center), radius: clampNumber(source.radius, 0.1, 10000, 10), label: advancedText(source.label, '', 48), color: advancedText(source.color, '', 40), fill: advancedText(source.fill, '', 40) });
  }
  const diagram = Array.isArray(source.nodes) ? normalizeDiagramSpec(source) : null;
  return {
    width,
    height,
    title: advancedText(source.title, 'Figure géométrique', 120),
    grid: source.grid === false ? false : { step: clampNumber(source.grid?.step, 1, 1000, 10) },
    axes: source.axes !== false,
    points: points.slice(0, 80),
    segments,
    polygons,
    circles,
    nodes: diagram?.nodes || [],
    edges: diagram?.edges || [],
    labels: Array.isArray(source.labels) ? source.labels.slice(0, 80).map((label) => ({
      ...advancedPoint(label),
      text: advancedText(label?.text || label?.label, '', 80)
    })).filter((label) => label.text) : []
  };
}

function normalizeChartSpec(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const labels = (Array.isArray(source.labels) ? source.labels : []).slice(0, 60).map((label) => advancedText(label, '', 40));
  const sourceSeries = Array.isArray(source.series) ? source.series : [];
  const series = sourceSeries.slice(0, 8).map((item, index) => {
    const values = (Array.isArray(item?.values) ? item.values : []).slice(0, labels.length || 60).map((value) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.round(number * 10000) / 10000 : null;
    });
    return {
      name: advancedText(item?.name, `Série ${index + 1}`, 60),
      values,
      color: advancedText(item?.color, '', 40)
    };
  }).filter((item) => item.values.some((value) => value !== null));
  return {
    type: ['line', 'bar', 'scatter'].includes(source.type) ? source.type : 'line',
    title: advancedText(source.title, 'Graphique', 120),
    xLabel: advancedText(source.xLabel, '', 80),
    yLabel: advancedText(source.yLabel, '', 80),
    labels,
    series
  };
}

function normalizeMathSpec(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    title: advancedText(source.title, 'Mathématiques', 120),
    expression: advancedText(source.expression || source.formula, 'Expression mathématique', 1000),
    steps: Array.isArray(source.steps) ? source.steps.slice(0, 20).map((step) => advancedText(step, '', 500)).filter(Boolean) : [],
    result: advancedText(source.result, '', 500)
  };
}

function searchAdvancedMarkdown(query) {
  const cleanQuery = String(query || '').trim().slice(0, 160);
  const terms = cleanQuery.toLowerCase().split(/\s+/).filter(Boolean);
  const commands = advancedMarkdownCommands.filter((item) => !terms.length || terms.some((term) => [item.command, ...item.aliases, item.description].join(' ').toLowerCase().includes(term)));
  return {
    tool: 'Advanced Markdown',
    query: cleanQuery,
    commands: (commands.length ? commands : advancedMarkdownCommands).map(({ command, description, syntax }) => ({ command, description, syntax }))
  };
}

function advancedMarkdownResult(command, specInput, title) {
  const normalizedCommand = String(command || '').toLowerCase();
  if (!['diagram', 'geometry', 'chart', 'math'].includes(normalizedCommand)) {
    return { error: 'Commande Advanced Markdown inconnue. Utilise diagram, geometry, chart ou math.' };
  }
  let source = {};
  if (typeof specInput === 'string') {
    try {
      const parsed = JSON.parse(specInput);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) source = { ...parsed };
    } catch {
      source = {};
    }
  } else if (specInput && typeof specInput === 'object' && !Array.isArray(specInput)) {
    source = { ...specInput };
  }
  if (title) source.title = title;
  const spec = normalizedCommand === 'diagram'
    ? normalizeDiagramSpec(source)
    : normalizedCommand === 'geometry'
      ? normalizeGeometrySpec(source)
      : normalizedCommand === 'chart'
        ? normalizeChartSpec(source)
        : normalizeMathSpec(source);
  const renderBlock = `\`\`\`advanced-${normalizedCommand}\n${JSON.stringify(spec)}\n\`\`\``;
  return { tool: 'Advanced Markdown', command: normalizedCommand, spec, renderBlock };
}

const mistralTools = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: 'Retourne la date et l’heure exacte en temps réel dans le fuseau Europe/Paris. Utilise cet outil chaque fois que l’utilisateur demande l’heure exacte.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Recherche des informations publiques sur le web. Utilise cet outil pour les actualités, les informations récentes, les faits à vérifier ou quand tu ne connais pas la réponse.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'La requête de recherche, courte et précise.' } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'advanced_markdown_search',
      description: 'Cherche dans le catalogue des commandes du tool Advanced Markdown. Utilise-le si tu dois découvrir la syntaxe d’une figure géométrique, d’un graphique ou d’un bloc mathématique.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Le besoin à chercher, par exemple geometry, graphique ou formule.' } },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'advanced_markdown',
      description: 'Construit un bloc Advanced Markdown sécurisé et directement affichable dans le chat. Appelle cet outil pour tout schéma, dessin, construction géométrique ou graphique. Utilise diagram pour les schémas de flux, geometry pour les figures SVG, chart pour les graphiques et math pour les équations avec étapes.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['diagram', 'geometry', 'chart', 'math'], description: 'La commande Advanced Markdown à exécuter.' },
          title: { type: 'string', description: 'Titre facultatif du bloc.' },
          spec: { type: 'object', description: 'Paramètres structurés de la figure, du graphique ou de la formule.' }
        },
        required: ['command', 'spec'],
        additionalProperties: false
      }
    }
  }
];

async function runMistralTool(toolCall) {
  const name = toolCall?.function?.name;
  let argumentsObject = {};
  try {
    argumentsObject = typeof toolCall?.function?.arguments === 'string'
      ? JSON.parse(toolCall.function.arguments || '{}')
      : (toolCall?.function?.arguments || {});
  } catch {
    return { error: 'Les arguments de la fonction sont invalides.' };
  }

  if (name === 'get_current_time') return parisClock();
  if (name === 'web_search') return searchWeb(argumentsObject.query);
  if (name === 'advanced_markdown_search') return searchAdvancedMarkdown(argumentsObject.query);
  if (name === 'advanced_markdown') {
    const command = argumentsObject.command || argumentsObject.action || argumentsObject.type;
    const spec = argumentsObject.spec ?? argumentsObject.data ?? argumentsObject.options ?? argumentsObject;
    return advancedMarkdownResult(command, spec, argumentsObject.title);
  }
  return { error: `Fonction inconnue: ${name}` };
}

async function requestMistral(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mistralApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new AppError(504, 'Mistral met trop de temps à répondre.');
    throw new AppError(502, 'Mistral est momentanément inaccessible.', { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError(502, 'La clé API Mistral est refusée.');
    }
    throw new AppError(502, 'Mistral n’a pas pu générer de réponse.', { cause: data?.message || raw });
  }
  return data;
}

async function requestMistralStream(payload, onToken) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mistralApiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new AppError(504, 'Mistral met trop de temps à répondre.');
    throw new AppError(502, 'Mistral est momentanément inaccessible.', { cause: error });
  }

  if (!response.ok) {
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    clearTimeout(timeout);
    if (response.status === 401 || response.status === 403) throw new AppError(502, 'La clé API Mistral est refusée.');
    throw new AppError(502, 'Mistral n’a pas pu générer de réponse.', { cause: data?.message || raw });
  }
  if (!response.body?.getReader) {
    clearTimeout(timeout);
    throw new AppError(502, 'Le streaming Mistral n’est pas disponible sur ce serveur.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  const contentParts = [];
  const toolCallMap = new Map();

  const consumeData = (rawData) => {
    const data = rawData.trim();
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') finished = true;
      return;
    }
    let chunk;
    try { chunk = JSON.parse(data); } catch { return; }
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    const content = typeof delta.content === 'string' ? delta.content : (typeof choice?.text === 'string' ? choice.text : '');
    if (content) {
      contentParts.push(content);
      onToken?.(content);
    }
    if (Array.isArray(delta.tool_calls)) {
      delta.tool_calls.forEach((call, fallbackIndex) => {
        const index = Number.isInteger(call.index) ? call.index : fallbackIndex;
        const existing = toolCallMap.get(index) || {
          id: call.id || `call_${index}`,
          type: call.type || 'function',
          function: { name: '', arguments: '' }
        };
        if (call.id) existing.id = call.id;
        if (call.type) existing.type = call.type;
        if (call.function?.name) existing.function.name += call.function.name;
        if (call.function?.arguments) existing.function.arguments += String(call.function.arguments);
        toolCallMap.set(index, existing);
      });
    }
  };

  try {
    while (!finished) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.startsWith('data:')) consumeData(line.slice(5));
      });
    }
    buffer += decoder.decode();
    buffer.split(/\r?\n/).forEach((line) => {
      if (line.startsWith('data:')) consumeData(line.slice(5));
    });
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }

  return {
    content: contentParts.join(''),
    toolCalls: [...toolCallMap.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
  };
}

async function callMistralStreaming(conversation, emit) {
  requireSetting(config.mistralApiKey, 'MISTRAL_API_KEY');
  const messages = buildMistralMessages(conversation);
  const advancedBlocks = [];
  const usedTools = [];

  for (let turn = 0; turn < 4; turn += 1) {
    emit('status', { message: turn ? 'Aster intègre le résultat de son outil' : 'Aster rédige la réponse' });
    const stream = await requestMistralStream({
      model: config.mistralModel,
      messages,
      tools: mistralTools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1400
    }, (text) => emit('token', { text }));

    if (!stream.toolCalls.length) {
      let answer = stream.content.trim();
      const missingBlocks = advancedBlocks.filter((block) => !answer.includes(block));
      if (!answer && missingBlocks.length) {
        answer = 'Voici le rendu demandé :';
        emit('token', { text: answer });
      }
      if (missingBlocks.length) {
        const appended = `\n\n${missingBlocks.join('\n\n')}`;
        emit('token', { text: appended });
        answer += appended;
      }
      if (!answer) throw new AppError(502, 'Mistral a renvoyé une réponse vide.');
      return { content: answer, tools: usedTools };
    }

    const assistantMessage = {
      role: 'assistant',
      content: stream.content || null,
      tool_calls: stream.toolCalls
    };
    messages.push(assistantMessage);
    for (const toolCall of stream.toolCalls) {
      const result = await runMistralTool(toolCall);
      const toolEntry = { name: toolCall.function?.name || 'unknown' };
      if (result?.command) toolEntry.command = result.command;
      if (!usedTools.some((item) => item.name === toolEntry.name && item.command === toolEntry.command)) usedTools.push(toolEntry);
      if (result?.renderBlock && !advancedBlocks.includes(result.renderBlock)) advancedBlocks.push(result.renderBlock);
      emit('tool', toolEntry);
      messages.push({
        role: 'tool',
        name: toolCall.function?.name || 'unknown',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, 6000)
      });
    }
  }

  throw new AppError(502, 'Aster n’a pas terminé l’appel de ses fonctions.');
}

function buildMistralMessages(conversation) {
  const clock = parisClock();
  return [
    {
      role: 'system',
      content: `Tu es Aster, un assistant IA utile, clair et chaleureux. Réponds en français sauf si l’utilisateur te parle dans une autre langue. Nous sommes le ${clock.date}, l’année actuelle est ${clock.year}, et il est ${clock.time} dans le fuseau Europe/Paris. La liste des outils disponibles est exposée dans l’appel : get_current_time, web_search, advanced_markdown_search et advanced_markdown. Les fonctions te donnent l’heure réelle et permettent de rechercher le web : appelle get_current_time pour toute demande d’heure exacte, et web_search pour les informations récentes ou à vérifier. Tu peux utiliser Markdown (titres, listes, tableaux, liens et blocs de code) pour rendre tes réponses lisibles. Pour tout schéma, dessin, construction de géométrie, équation ou graphique, tu dois appeler Advanced Markdown au lieu de répondre seulement avec du texte ou un bloc de code. Si tu ne connais pas la commande, appelle d’abord advanced_markdown_search, puis appelle advanced_markdown avec un spec JSON. Quand advanced_markdown renvoie renderBlock, recopie ce bloc exactement dans ta réponse, sur sa propre ligne : l’interface le transforme en rendu SVG ou mathématique sécurisé directement dans le chat. Les syntaxes reconnues sont les blocs advanced-diagram, advanced-geometry, advanced-chart et advanced-math. Structure tes réponses avec des listes ou des étapes quand cela améliore la lisibilité. Ne prétends pas avoir accès à des informations privées ou à des actions que tu n’as pas effectuées.`
    },
    ...conversation.messages.slice(-14).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: String(message.content).slice(0, 7000)
    }))
  ];
}

async function callMistral(conversation) {
  requireSetting(config.mistralApiKey, 'MISTRAL_API_KEY');
  const messages = buildMistralMessages(conversation);
  const advancedBlocks = [];
  const usedTools = [];

  for (let turn = 0; turn < 4; turn += 1) {
    const data = await requestMistral({
      model: config.mistralModel,
      messages,
      tools: mistralTools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1400
    });
    const assistantMessage = data?.choices?.[0]?.message;
    if (!assistantMessage) throw new AppError(502, 'Mistral a renvoyé une réponse vide.');

    const toolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];
    if (!toolCalls.length) {
      const content = assistantMessage.content;
      if (typeof content !== 'string' || !content.trim()) throw new AppError(502, 'Mistral a renvoyé une réponse vide.');
      const answer = content.trim();
      const missingBlocks = advancedBlocks.filter((block) => !answer.includes(block));
      return {
        content: missingBlocks.length ? `${answer}\n\n${missingBlocks.join('\n\n')}` : answer,
        tools: usedTools
      };
    }

    messages.push(assistantMessage);
    for (const toolCall of toolCalls) {
      const result = await runMistralTool(toolCall);
      const toolEntry = { name: toolCall.function?.name || 'unknown' };
      if (result?.command) toolEntry.command = result.command;
      if (!usedTools.some((item) => item.name === toolEntry.name && item.command === toolEntry.command)) usedTools.push(toolEntry);
      if (result?.renderBlock && !advancedBlocks.includes(result.renderBlock)) advancedBlocks.push(result.renderBlock);
      messages.push({
        role: 'tool',
        name: toolCall.function?.name || 'unknown',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result).slice(0, 6000)
      });
    }
  }

  throw new AppError(502, 'Aster n’a pas terminé l’appel de ses fonctions.');
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'aster-chat' });
});

app.get('/api/session', asyncRoute(async (req, res) => {
  const username = sessionUsername(req);
  if (!username) return res.json({ user: null });
  const profile = await getUserProfile(username);
  if (!profile) {
    clearSession(res);
    return res.json({ user: null });
  }
  res.json({ user: publicProfile(profile) });
}));

app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.pseudo);
  const email = normalizeEmail(req.body?.email);
  const password = validatePassword(req.body?.password);
  const existing = await readJsonFile(profilePath(username), { optional: true });
  if (existing) throw new AppError(409, 'Ce pseudo est déjà utilisé.');

  const profile = {
    pseudo: username,
    email,
    password: await hashPassword(password),
    createdAt: new Date().toISOString()
  };
  await writeJsonFile(profilePath(username), profile, {
    message: `Créer le profil de ${username}`
  });
  setSession(res, username);
  res.status(201).json({ user: publicProfile(profile) });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const username = normalizeUsername(req.body?.pseudo);
  const password = validatePassword(req.body?.password);
  const result = await readJsonFile(profilePath(username), { optional: true });
  if (!result || !(await verifyPassword(password, result.value.password))) {
    throw new AppError(401, 'Pseudo ou mot de passe incorrect.');
  }
  setSession(res, username);
  res.json({ user: publicProfile(result.value) });
}));

app.post('/api/auth/logout', (req, res) => {
  clearSession(res);
  res.status(204).end();
});

app.get('/api/conversations', requireAuth, asyncRoute(async (req, res) => {
  const entries = await listGitHubDirectory(conversationsPath(req.username));
  const conversations = (await Promise.all(entries.map(async (entry) => {
    const result = await readJsonFile(conversationPath(req.username, entry.name.replace(/\.json$/, '')), { optional: true });
    if (!result) return null;
    try {
      return conversationSummary(validateConversationShape(result.value, result.value.id));
    } catch {
      return null;
    }
  }))).filter(Boolean).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ conversations });
}));

app.post('/api/conversations', requireAuth, asyncRoute(async (req, res) => {
  const requestedTitle = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
  const conversation = newConversation(requestedTitle || 'Nouvelle conversation');
  // Un brouillon reste en mémoire côté client. Le fichier GitHub n’est créé qu’au premier message.
  res.status(201).json({ conversation, persisted: false });
}));

app.get('/api/conversations/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await getConversation(req.username, req.params.id);
  res.json({ conversation: result.conversation });
}));

app.patch('/api/conversations/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await getConversation(req.username, req.params.id);
  const title = cleanText(req.body?.title, 80);
  result.conversation.title = title;
  result.conversation.updatedAt = new Date().toISOString();
  await writeJsonFile(conversationPath(req.username, result.conversation.id), result.conversation, {
    sha: result.sha,
    message: `Renommer la conversation ${result.conversation.id}`
  });
  res.json({ conversation: result.conversation });
}));

app.delete('/api/conversations/:id', requireAuth, asyncRoute(async (req, res) => {
  const result = await getConversation(req.username, req.params.id);
  await deleteGitHubFile(
    conversationPath(req.username, result.conversation.id),
    result.sha,
    `Supprimer la conversation ${result.conversation.id}`
  );
  res.status(204).end();
}));

function sendSse(res, event, payload) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

app.post('/api/conversations/:id/messages/stream', requireAuth, async (req, res, next) => {
  let headersSent = false;
  let workingConversation = null;
  try {
    const content = cleanText(req.body?.content);
    const id = validateConversationId(req.params.id);
    const result = await getConversation(req.username, id, { optional: true });
    const conversation = result?.conversation || newConversation();
    workingConversation = conversation;
    conversation.id = id;
    const userMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    };
    if (conversation.messages.length === 0 || conversation.title === 'Nouvelle conversation') conversation.title = makeConversationTitle(content);
    conversation.messages.push(userMessage);
    conversation.updatedAt = new Date().toISOString();

    const savedUser = await writeJsonFile(conversationPath(req.username, conversation.id), conversation, {
      sha: result?.sha,
      message: `Ajouter un message à ${conversation.id}`
    });

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    headersSent = true;
    sendSse(res, 'meta', { conversationId: conversation.id, title: conversation.title });
    sendSse(res, 'status', { message: 'Message enregistré, Aster commence à répondre' });

    const resultFromModel = await callMistralStreaming(conversation, (event, payload) => sendSse(res, event, payload));
    sendSse(res, 'complete', { message: 'Réponse reçue, finalisation de la conversation' });
    const assistantMessage = {
      id: `msg_${crypto.randomUUID()}`,
      role: 'assistant',
      content: resultFromModel.content,
      tools: Array.isArray(resultFromModel.tools) ? resultFromModel.tools : [],
      createdAt: new Date().toISOString()
    };
    conversation.messages.push(assistantMessage);
    conversation.updatedAt = new Date().toISOString();
    await writeJsonFile(conversationPath(req.username, conversation.id), conversation, {
      sha: savedUser.sha,
      message: `Réponse IA dans ${conversation.id}`
    });
    sendSse(res, 'done', { conversation, message: assistantMessage, persisted: true });
    res.end();
  } catch (error) {
    if (headersSent || res.headersSent) {
      sendSse(res, 'error', { error: error.expose === false ? 'Une erreur est survenue.' : error.message, conversation: workingConversation });
      return res.end();
    }
    next(error);
  }
});

app.post('/api/conversations/:id/messages', requireAuth, asyncRoute(async (req, res) => {
  const content = cleanText(req.body?.content);
  const id = validateConversationId(req.params.id);
  const result = await getConversation(req.username, id, { optional: true });
  const conversation = result?.conversation || newConversation();
  // Le premier message transforme le brouillon local en vrai fichier GitHub.
  conversation.id = id;
  const userMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: 'user',
    content,
    createdAt: new Date().toISOString()
  };

  if (conversation.messages.length === 0 || conversation.title === 'Nouvelle conversation') {
    conversation.title = makeConversationTitle(content);
  }
  conversation.messages.push(userMessage);
  conversation.updatedAt = new Date().toISOString();

  const savedUser = await writeJsonFile(conversationPath(req.username, conversation.id), conversation, {
    sha: result?.sha,
    message: `Ajouter un message à ${conversation.id}`
  });

  let assistantResult;
  try {
    assistantResult = await callMistral(conversation);
  } catch (error) {
    return res.status(error.status || 502).json({
      error: error.expose === false ? 'Une erreur est survenue.' : error.message,
      conversation
    });
  }

  const assistantMessage = {
    id: `msg_${crypto.randomUUID()}`,
    role: 'assistant',
    content: assistantResult.content,
    tools: Array.isArray(assistantResult.tools) ? assistantResult.tools : [],
    createdAt: new Date().toISOString()
  };
  conversation.messages.push(assistantMessage);
  conversation.updatedAt = new Date().toISOString();
  await writeJsonFile(conversationPath(req.username, conversation.id), conversation, {
    sha: savedUser.sha,
    message: `Réponse IA dans ${conversation.id}`
  });

  res.json({ conversation, message: assistantMessage, persisted: true });
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Endpoint introuvable.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && error.body) {
    return res.status(400).json({ error: 'Le JSON envoyé est invalide.' });
  }
  console.error(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  res.status(status).json({
    error: error.expose === false || status >= 500 ? (status >= 500 ? 'Une erreur interne est survenue.' : error.message) : error.message
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Aster Chat écoute sur le port ${PORT}`);
});
