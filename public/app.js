(() => {
  'use strict';

  const state = {
    user: null,
    conversations: [],
    drafts: new Map(),
    activeConversation: null,
    loading: false,
    toastTimer: null,
    authMode: 'login',
    logo: 'cat',
    autoAnimation: 'breathe',
    autoAnimationTimer: null,
    autoAnimationStep: 0,
    interfaceStyle: 'nocturne'
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const icon = (name, className = 'icon') => `<svg class="${className}"><use href="#icon-${name}"></use></svg>`;
  const logoIcon = (className = 'icon') => {
    const pixel = state.logo.startsWith('pixel-') ? ' pixel-icon' : '';
    return `<svg class="${className} character-icon${pixel} logo-motion-${state.autoAnimation}" data-aster-logo data-companion="${state.logo}" aria-hidden="true"><use data-aster-use href="#icon-${state.logo}"></use></svg>`;
  };

  const elements = {
    authView: $('#auth-view'),
    appView: $('#app-view'),
    authTitle: $('#auth-title'),
    authSubtitle: $('#auth-subtitle'),
    authAlert: $('#auth-alert'),
    loginForm: $('#login-form'),
    registerForm: $('#register-form'),
    sidebar: $('#sidebar'),
    mobileScrim: $('#mobile-scrim'),
    conversationList: $('#conversation-list'),
    conversationEmpty: $('#sidebar-empty'),
    conversationCount: $('#conversation-count'),
    activeTitle: $('#active-title'),
    welcomeView: $('#welcome-view'),
    welcomeName: $('#welcome-name'),
    messages: $('#messages'),
    typing: $('#typing-indicator'),
    messageForm: $('#message-form'),
    messageInput: $('#message-input'),
    sendButton: $('#send-button'),
    userName: $('#user-name'),
    userEmail: $('#user-email'),
    userAvatar: $('#user-avatar'),
    deleteButton: $('#delete-chat-button'),
    settingsButton: $('#settings-button'),
    settingsDrawer: $('#settings-drawer'),
    settingsScrim: $('#settings-scrim'),
    selectedLogoLabel: $('#selected-logo-label'),
    selectedStyleLabel: $('#selected-style-label'),
    toast: $('#toast'),
    chatScroll: $('#chat-scroll')
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function safeMarkdownUrl(rawUrl) {
    const candidate = String(rawUrl).replace(/&amp;/g, '&').trim();
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
      return escapeHtml(candidate);
    } catch {
      return null;
    }
  }

  function advancedFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function advancedSvgColor(value, fallback) {
    const candidate = String(value || '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(candidate) || /^[a-z]{1,24}$/i.test(candidate) || /^(?:rgb|rgba|hsl|hsla)\([^<>"`;]{1,80}\)$/i.test(candidate)) return candidate;
    return fallback;
  }

  function advancedPoint(value) {
    if (Array.isArray(value)) return { x: advancedFiniteNumber(value[0]), y: advancedFiniteNumber(value[1]) };
    if (!value || typeof value !== 'object') return null;
    return { x: advancedFiniteNumber(value.x), y: advancedFiniteNumber(value.y), label: String(value.label || '').slice(0, 48), color: value.color };
  }

  function advancedPointString(points) {
    return points.map((point) => `${advancedFiniteNumber(point.x)},${advancedFiniteNumber(point.y)}`).join(' ');
  }

  function renderAdvancedGeometry(spec = {}) {
    const width = Math.min(10000, Math.max(40, advancedFiniteNumber(spec.width, 100)));
    const height = Math.min(10000, Math.max(40, advancedFiniteNumber(spec.height, 100)));
    const title = escapeHtml(spec.title || 'Figure géométrique');
    const parts = [];
    const gridStep = Math.min(1000, Math.max(1, advancedFiniteNumber(spec.grid?.step, 10)));
    if (spec.grid !== false) {
      for (let x = 0; x <= width; x += gridStep) parts.push(`<line class="advanced-grid-line" x1="${x}" y1="0" x2="${x}" y2="${height}"/>`);
      for (let y = 0; y <= height; y += gridStep) parts.push(`<line class="advanced-grid-line" x1="0" y1="${y}" x2="${width}" y2="${y}"/>`);
    }
    if (spec.axes !== false) {
      parts.push(`<line class="advanced-axis-line" x1="0" y1="${height}" x2="${width}" y2="${height}"/>`);
      parts.push(`<line class="advanced-axis-line" x1="0" y1="0" x2="0" y2="${height}"/>`);
    }
    (Array.isArray(spec.polygons) ? spec.polygons : []).forEach((polygon) => {
      const points = (Array.isArray(polygon.points) ? polygon.points : []).map(advancedPoint).filter(Boolean);
      if (points.length < 3) return;
      const fill = advancedSvgColor(polygon.fill, 'rgba(125, 115, 255, .18)');
      const stroke = advancedSvgColor(polygon.color, 'var(--advanced-accent)');
      parts.push(`<polygon class="advanced-polygon" points="${advancedPointString(points)}" fill="${fill}" stroke="${stroke}"/>`);
      if (polygon.label) {
        const center = points.reduce((total, point) => ({ x: total.x + point.x / points.length, y: total.y + point.y / points.length }), { x: 0, y: 0 });
        parts.push(`<text class="advanced-shape-label" x="${center.x}" y="${center.y}" text-anchor="middle">${escapeHtml(polygon.label)}</text>`);
      }
    });
    (Array.isArray(spec.segments) ? spec.segments : []).forEach((segment) => {
      const from = advancedPoint(segment.from);
      const to = advancedPoint(segment.to);
      if (!from || !to) return;
      const color = advancedSvgColor(segment.color, 'var(--advanced-accent)');
      parts.push(`<line class="advanced-segment${segment.dashed ? ' dashed' : ''}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${color}"/>`);
      if (segment.label) parts.push(`<text class="advanced-shape-label" x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2 - 3}" text-anchor="middle">${escapeHtml(segment.label)}</text>`);
    });
    (Array.isArray(spec.circles) ? spec.circles : []).forEach((circle) => {
      const center = advancedPoint(circle.center);
      if (!center) return;
      const radius = Math.max(.1, advancedFiniteNumber(circle.radius, 10));
      const stroke = advancedSvgColor(circle.color, 'var(--advanced-accent)');
      const fill = advancedSvgColor(circle.fill, 'rgba(105, 222, 180, .08)');
      parts.push(`<circle class="advanced-circle" cx="${center.x}" cy="${center.y}" r="${radius}" fill="${fill}" stroke="${stroke}"/>`);
      if (circle.label) parts.push(`<text class="advanced-shape-label" x="${center.x}" y="${center.y - radius - 3}" text-anchor="middle">${escapeHtml(circle.label)}</text>`);
    });
    (Array.isArray(spec.points) ? spec.points : []).forEach((value) => {
      const point = advancedPoint(value);
      if (!point) return;
      const color = advancedSvgColor(point.color, 'var(--advanced-highlight)');
      parts.push(`<circle class="advanced-point" cx="${point.x}" cy="${point.y}" r="2.5" fill="${color}"/>`);
      if (point.label) parts.push(`<text class="advanced-point-label" x="${point.x + 3}" y="${point.y - 4}">${escapeHtml(point.label)}</text>`);
    });
    (Array.isArray(spec.labels) ? spec.labels : []).forEach((value) => {
      const point = advancedPoint(value);
      if (!point || !value.text) return;
      parts.push(`<text class="advanced-point-label" x="${point.x}" y="${point.y}">${escapeHtml(value.text)}</text>`);
    });
    return `<figure class="advanced-card advanced-geometry-card"><figcaption>${title}<span>Advanced Markdown · géométrie</span></figcaption><div class="advanced-visual-wrap"><svg class="advanced-svg geometry-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">${parts.join('')}</svg></div></figure>`;
  }

  function renderAdvancedChart(spec = {}) {
    const labels = Array.isArray(spec.labels) ? spec.labels.map((label) => String(label || '').slice(0, 40)) : [];
    const series = (Array.isArray(spec.series) ? spec.series : []).map((item) => ({
      name: String(item?.name || 'Série').slice(0, 60),
      color: item?.color,
      values: Array.isArray(item?.values) ? item.values.map((value) => Number.isFinite(Number(value)) ? Number(value) : null) : []
    })).filter((item) => item.values.some((value) => value !== null));
    if (!labels.length || !series.length) return `<figure class="advanced-card advanced-chart-card"><figcaption>${escapeHtml(spec.title || 'Graphique')}<span>Advanced Markdown · graphique</span></figcaption><p class="advanced-empty">Aucune donnée numérique à afficher.</p></figure>`;
    const width = 680;
    const height = 330;
    const margin = { top: 30, right: 24, bottom: 48, left: 52 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const values = series.flatMap((item) => item.values).filter((value) => value !== null);
    const min = Math.min(0, ...values);
    const max = Math.max(1, ...values);
    const range = max - min || 1;
    const xFor = (index) => margin.left + (labels.length === 1 ? innerWidth / 2 : (index / (labels.length - 1)) * innerWidth);
    const yFor = (value) => margin.top + ((max - value) / range) * innerHeight;
    const parts = [];
    for (let tick = 0; tick <= 4; tick += 1) {
      const value = min + ((max - min) * tick) / 4;
      const y = yFor(value);
      parts.push(`<line class="advanced-grid-line" x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}"/>`);
      parts.push(`<text class="advanced-axis-label" x="${margin.left - 8}" y="${y + 3}" text-anchor="end">${escapeHtml(Number(value.toFixed(2)).toString())}</text>`);
    }
    labels.forEach((label, index) => {
      const x = labels.length === 1 ? xFor(index) : xFor(index);
      const rotate = labels.length > 8 ? ` transform="rotate(-35 ${x} ${height - 16})"` : '';
      parts.push(`<text class="advanced-axis-label" x="${x}" y="${height - 16}" text-anchor="middle"${rotate}>${escapeHtml(label)}</text>`);
    });
    const chartType = ['line', 'bar', 'scatter'].includes(spec.type) ? spec.type : 'line';
    const palette = ['var(--advanced-accent)', 'var(--advanced-highlight)', 'var(--advanced-third)', '#f5b971', '#e989b5', '#9b8cff', '#7cd6c0', '#d8e27f'];
    if (chartType === 'bar') {
      const groupWidth = innerWidth / labels.length;
      const barWidth = Math.max(2, (groupWidth / Math.max(series.length, 1)) * .72);
      series.forEach((item, seriesIndex) => {
        const color = advancedSvgColor(item.color, palette[seriesIndex % palette.length]);
        item.values.forEach((value, index) => {
          if (value === null) return;
          const x = margin.left + index * groupWidth + seriesIndex * (groupWidth / series.length) + (groupWidth / series.length - barWidth) / 2;
          const y = yFor(Math.max(value, 0));
          const zero = yFor(0);
          parts.push(`<rect class="advanced-bar" x="${x}" y="${Math.min(y, zero)}" width="${barWidth}" height="${Math.max(1, Math.abs(zero - y))}" rx="3" fill="${color}"/>`);
        });
      });
    } else {
      series.forEach((item, seriesIndex) => {
        const color = advancedSvgColor(item.color, palette[seriesIndex % palette.length]);
        let path = '';
        item.values.forEach((value, index) => {
          if (value === null) { path = ''; return; }
          const command = path ? 'L' : 'M';
          path += `${command} ${xFor(index)} ${yFor(value)} `;
          if (chartType === 'scatter') parts.push(`<circle class="advanced-scatter" cx="${xFor(index)}" cy="${yFor(value)}" r="4" fill="${color}"/>`);
        });
        if (chartType === 'line' && path) parts.push(`<path class="advanced-line" d="${path.trim()}" stroke="${color}"/>`);
        if (chartType === 'line') item.values.forEach((value, index) => { if (value !== null) parts.push(`<circle class="advanced-line-point" cx="${xFor(index)}" cy="${yFor(value)}" r="3.5" fill="${color}"/>`); });
      });
    }
    const legend = series.map((item, index) => `<span><i style="background:${advancedSvgColor(item.color, palette[index % palette.length])}"></i>${escapeHtml(item.name)}</span>`).join('');
    const axisText = [spec.xLabel, spec.yLabel].filter(Boolean).map((value) => escapeHtml(value)).join(' · ');
    return `<figure class="advanced-card advanced-chart-card"><figcaption>${escapeHtml(spec.title || 'Graphique')}<span>Advanced Markdown · ${escapeHtml(chartType)}${axisText ? ` · ${axisText}` : ''}</span></figcaption><div class="advanced-visual-wrap"><svg class="advanced-svg chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(spec.title || 'Graphique')}">${parts.join('')}</svg></div><div class="advanced-legend">${legend}</div></figure>`;
  }

  function renderAdvancedMath(spec = {}) {
    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    return `<figure class="advanced-card advanced-math-card"><figcaption>${escapeHtml(spec.title || 'Mathématiques')}<span>Advanced Markdown · formule</span></figcaption><div class="advanced-expression">${escapeHtml(spec.expression || 'Expression mathématique')}</div>${steps.length ? `<ol class="advanced-steps">${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}${spec.result ? `<div class="advanced-result"><small>Résultat</small><strong>${escapeHtml(spec.result)}</strong></div>` : ''}</figure>`;
  }

  function renderAdvancedBlock(command, rawSpec) {
    try {
      const spec = JSON.parse(rawSpec.trim());
      if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
      if (command === 'geometry') return renderAdvancedGeometry(spec);
      if (command === 'chart') return renderAdvancedChart(spec);
      if (command === 'math') return renderAdvancedMath(spec);
    } catch {
      return null;
    }
    return null;
  }

  function extractAdvancedBlocks(value) {
    const blocks = [];
    let source = String(value ?? '');
    const addBlock = (match, command, rawSpec) => {
      const rendered = renderAdvancedBlock(command.toLowerCase(), rawSpec);
      if (!rendered) return match;
      const token = `@@ASTER_ADVANCED_${blocks.length}@@`;
      blocks.push(rendered);
      return `\n${token}\n`;
    };
    source = source.replace(/```(?:advanced[-_](?:markdown[-_]?)?|aster[-_])?(geometry|chart|math)\s*\n([\s\S]*?)```/gi, addBlock);
    source = source.replace(/:::advanced[-_]?(?:markdown[-_]?)?(geometry|chart|math)\s*\n([\s\S]*?)\n:::/gi, addBlock);
    return { source, blocks };
  }

  function renderInlineMarkdown(value) {
    let text = escapeHtml(value);
    const placeholders = [];
    const stash = (html) => {
      const token = `@@ASTER_MARKDOWN_${placeholders.length}@@`;
      placeholders.push(html);
      return token;
    };

    text = text.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${code}</code>`));
    text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
      const safeUrl = safeMarkdownUrl(url);
      return safeUrl ? stash(`<img src="${safeUrl}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`) : _;
    });
    text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
      const safeUrl = safeMarkdownUrl(url);
      return safeUrl ? stash(`<a href="${safeUrl}"${title ? ` title="${title}"` : ''} target="_blank" rel="noopener noreferrer">${label}</a>`) : label;
    });
    text = text.replace(/(\*\*|__)(?=\S)(.+?\S)\1/g, '<strong>$2</strong>');
    text = text.replace(/(~~)(?=\S)(.+?\S)\1/g, '<del>$2</del>');
    text = text.replace(/(^|[\s(])([*_])(?=\S)(.+?\S)\2/g, '$1<em>$3</em>');
    text = text.replace(/@@ASTER_MARKDOWN_(\d+)@@/g, (_, index) => placeholders[Number(index)]);
    return text;
  }

  function tableCells(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  }

  function renderMarkdown(value) {
    const advanced = extractAdvancedBlocks(value);
    const lines = advanced.source.replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let codeLines = null;
    let codeLanguage = '';

    const flushParagraph = () => {
      if (!paragraph.length) return;
      const content = paragraph.join('\n');
      output.push(`<p>${renderInlineMarkdown(content).replace(/\n/g, '<br>')}</p>`);
      paragraph = [];
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trim();

      if (codeLines) {
        if (/^```/.test(trimmed)) {
          const languageClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
          output.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          codeLines = null;
          codeLanguage = '';
        } else {
          codeLines.push(line);
        }
        continue;
      }

      const fence = trimmed.match(/^```\s*([\w+-]*)\s*$/);
      if (fence) {
        flushParagraph();
        codeLines = [];
        codeLanguage = fence[1] || '';
        continue;
      }
      if (!trimmed) {
        flushParagraph();
        continue;
      }

      const nextLine = lines[index + 1]?.trim() || '';
      if (trimmed.includes('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine)) {
        flushParagraph();
        const headers = tableCells(line);
        const rows = [];
        index += 2;
        while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
          rows.push(tableCells(lines[index]));
          index += 1;
        }
        index -= 1;
        output.push(`<div class="markdown-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }

      const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
      if (heading) {
        flushParagraph();
        const level = heading[1].length;
        output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }
      if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(trimmed)) {
        flushParagraph();
        output.push('<hr>');
        continue;
      }
      if (/^>\s?/.test(trimmed)) {
        flushParagraph();
        const quoteLines = [];
        while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
          quoteLines.push(lines[index].trim().replace(/^>\s?/, ''));
          index += 1;
        }
        index -= 1;
        output.push(`<blockquote>${renderInlineMarkdown(quoteLines.join('\n')).replace(/\n/g, '<br>')}</blockquote>`);
        continue;
      }

      const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const orderedList = Boolean(ordered);
        const items = [];
        while (index < lines.length) {
          const current = lines[index].trim();
          const match = orderedList ? current.match(/^\d+[.)]\s+(.+)$/) : current.match(/^[-*+]\s+(.+)$/);
          if (!match) break;
          items.push(`<li>${renderInlineMarkdown(match[1])}</li>`);
          index += 1;
        }
        index -= 1;
        output.push(`<${orderedList ? 'ol' : 'ul'}>${items.join('')}</${orderedList ? 'ol' : 'ul'}>`);
        continue;
      }

      paragraph.push(line);
    }

    if (codeLines) {
      const languageClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
      output.push(`<pre><code${languageClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    }
    flushParagraph();
    const rendered = output.join('') || '<p></p>';
    return rendered.replace(/<p>@@ASTER_ADVANCED_(\d+)@@<\/p>/g, (_, index) => advanced.blocks[Number(index)] || '');
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }).replace('.', '');
  }

  async function request(url, options = {}) {
    const { headers: customHeaders = {}, ...requestOptions } = options;
    const response = await fetch(url, {
      credentials: 'same-origin',
      ...requestOptions,
      headers: { 'Content-Type': 'application/json', ...customHeaders }
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(payload?.error || 'Une erreur est survenue.');
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function showToast(message, type = '') {
    clearTimeout(state.toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast visible ${type}`.trim();
    state.toastTimer = setTimeout(() => {
      elements.toast.className = 'toast';
    }, 4200);
  }

  function showAuthError(message = '') {
    elements.authAlert.textContent = message;
  }

  function setButtonLoading(button, isLoading, loadingLabel = 'Chargement…') {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalLabel = button.querySelector('span')?.textContent || '';
      button.disabled = true;
      const label = button.querySelector('span');
      if (label) label.textContent = loadingLabel;
    } else {
      button.disabled = false;
      const label = button.querySelector('span');
      if (label && button.dataset.originalLabel) label.textContent = button.dataset.originalLabel;
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    const register = mode === 'register';
    $$('[data-auth-tab]').forEach((tab) => {
      const active = tab.dataset.authTab === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    elements.loginForm.classList.toggle('hidden', register);
    elements.registerForm.classList.toggle('hidden', !register);
    elements.authTitle.textContent = register ? 'Votre espace commence ici.' : 'Ravi de vous revoir.';
    elements.authSubtitle.textContent = register ? 'Créez votre espace privé en quelques secondes.' : 'Connectez-vous pour retrouver vos conversations.';
    showAuthError('');
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('aster-theme', theme);
  }

  const interfaceStyles = {
    nocturne: { label: 'Nocturne', theme: 'dark' },
    daylight: { label: 'Lumière', theme: 'light' },
    aurora: { label: 'Aurora', theme: 'dark' },
    sakura: { label: 'Sakura', theme: 'light' },
    terminal: { label: 'Terminal', theme: 'dark' },
    ocean: { label: 'Océan', theme: 'dark' },
    forest: { label: 'Forêt', theme: 'dark' },
    sunset: { label: 'Sunset', theme: 'dark' },
    paper: { label: 'Papier', theme: 'light' },
    mono: { label: 'Monochrome', theme: 'dark' }
  };

  function setInterfaceStyle(style) {
    const selected = interfaceStyles[style] ? style : 'nocturne';
    state.interfaceStyle = selected;
    document.documentElement.dataset.uiStyle = selected;
    localStorage.setItem('aster-interface-style', selected);
    setTheme(interfaceStyles[selected].theme);
    $$('[data-style-choice]').forEach((button) => {
      const active = button.dataset.styleChoice === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    if (elements.selectedStyleLabel) elements.selectedStyleLabel.textContent = interfaceStyles[selected].label;
  }

  const characterLabels = {
    cat: 'Chat',
    fox: 'Renard',
    robot: 'Robot',
    bunny: 'Lapin',
    'pixel-cat': 'Chat pixel',
    'pixel-fox': 'Renard pixel',
    'pixel-robot': 'Robot pixel',
    'pixel-bunny': 'Lapin pixel'
  };

  const animationNames = ['breathe', 'float', 'spin', 'pulse', 'bounce', 'wiggle', 'twinkle', 'glitch', 'drift', 'swing', 'sparkle', 'wave'];
  const characterAnimations = {
    cat: ['breathe', 'twinkle', 'float', 'bounce', 'wiggle', 'sparkle', 'swing', 'wave', 'drift', 'pulse', 'spin', 'glitch'],
    fox: ['float', 'drift', 'wiggle', 'bounce', 'sparkle', 'twinkle', 'swing', 'breathe', 'wave', 'pulse', 'spin', 'glitch'],
    robot: ['pulse', 'spin', 'glitch', 'wave', 'float', 'sparkle', 'breathe', 'drift', 'bounce', 'wiggle', 'twinkle', 'swing'],
    bunny: ['breathe', 'bounce', 'swing', 'twinkle', 'float', 'wiggle', 'sparkle', 'wave', 'drift', 'pulse', 'spin', 'glitch'],
    'pixel-cat': ['bounce', 'twinkle', 'glitch', 'float', 'wiggle', 'sparkle', 'breathe', 'wave', 'drift', 'pulse', 'spin', 'swing'],
    'pixel-fox': ['drift', 'bounce', 'wiggle', 'twinkle', 'glitch', 'float', 'sparkle', 'breathe', 'wave', 'pulse', 'spin', 'swing'],
    'pixel-robot': ['glitch', 'pulse', 'spin', 'wave', 'bounce', 'sparkle', 'breathe', 'drift', 'float', 'wiggle', 'twinkle', 'swing'],
    'pixel-bunny': ['breathe', 'bounce', 'twinkle', 'swing', 'float', 'wiggle', 'sparkle', 'wave', 'drift', 'pulse', 'spin', 'glitch']
  };

  function applyLogoVisuals() {
    const isPixel = state.logo.startsWith('pixel-');
    $$('[data-aster-logo]').forEach((logo) => {
      logo.classList.add('character-icon');
      logo.dataset.companion = state.logo;
      logo.classList.toggle('pixel-icon', isPixel);
      animationNames.forEach((animation) => logo.classList.remove(`logo-motion-${animation}`));
      logo.classList.add(`logo-motion-${state.autoAnimation}`);
    });
    $$('[data-aster-use]').forEach((use) => use.setAttribute('href', `#icon-${state.logo}`));
  }

  function cycleAutomaticAnimation() {
    const sequence = characterAnimations[state.logo] || characterAnimations.cat;
    state.autoAnimation = sequence[state.autoAnimationStep % sequence.length];
    state.autoAnimationStep += 1;
    applyLogoVisuals();
  }

  function startAutomaticAnimations() {
    window.clearInterval(state.autoAnimationTimer);
    state.autoAnimationStep = 0;
    cycleAutomaticAnimation();
    state.autoAnimationTimer = window.setInterval(cycleAutomaticAnimation, 3800);
  }

  function setLogo(character) {
    const validCharacters = Object.keys(characterLabels);
    state.logo = validCharacters.includes(character) ? character : 'cat';
    localStorage.setItem('aster-logo', state.logo);
    startAutomaticAnimations();
    $$('[data-logo-choice]').forEach((button) => {
      const active = button.dataset.logoChoice === state.logo;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    if (elements.selectedLogoLabel) elements.selectedLogoLabel.textContent = characterLabels[state.logo];
  }

  function initialisePreferences() {
    const savedStyle = localStorage.getItem('aster-interface-style');
    const savedTheme = localStorage.getItem('aster-theme');
    const preferredTheme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    if (savedStyle && interfaceStyles[savedStyle]) setInterfaceStyle(savedStyle);
    else setInterfaceStyle(savedTheme === 'light' || (!savedTheme && preferredTheme === 'light') ? 'daylight' : 'nocturne');
    setLogo(localStorage.getItem('aster-logo') || 'cat');
  }

  function openSettings() {
    elements.settingsDrawer.classList.add('open');
    elements.settingsDrawer.setAttribute('aria-hidden', 'false');
    elements.settingsScrim.classList.add('visible');
    elements.settingsButton.setAttribute('aria-expanded', 'true');
  }

  function closeSettings() {
    elements.settingsDrawer.classList.remove('open');
    elements.settingsDrawer.setAttribute('aria-hidden', 'true');
    elements.settingsScrim.classList.remove('visible');
    elements.settingsButton.setAttribute('aria-expanded', 'false');
  }

  function enterApp(user) {
    state.user = user;
    state.drafts.clear();
    elements.authView.classList.add('hidden');
    elements.appView.classList.remove('hidden');
    elements.userName.textContent = user.pseudo;
    elements.userEmail.textContent = user.email;
    elements.userAvatar.textContent = user.pseudo.slice(0, 1).toUpperCase();
    elements.welcomeName.textContent = user.pseudo.toUpperCase();
    loadConversations();
  }

  function leaveApp() {
    state.user = null;
    state.conversations = [];
    state.drafts.clear();
    state.activeConversation = null;
    closeSettings();
    closeSidebar();
    elements.appView.classList.add('hidden');
    elements.authView.classList.remove('hidden');
    setAuthMode('login');
    elements.loginForm.reset();
    elements.registerForm.reset();
  }

  async function boot() {
    initialisePreferences();
    bindEvents();
    try {
      const result = await request('/api/session');
      if (result.user) enterApp(result.user);
    } catch {
      // L'interface de connexion reste disponible même si la session ne peut pas être lue.
    }
  }

  async function submitAuth(form, mode) {
    const submit = $('.auth-submit', form);
    const data = Object.fromEntries(new FormData(form).entries());
    showAuthError('');
    setButtonLoading(submit, true, mode === 'login' ? 'Connexion…' : 'Création…');
    try {
      const result = await request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(data) });
      enterApp(result.user);
    } catch (error) {
      showAuthError(error.message);
    } finally {
      setButtonLoading(submit, false);
    }
  }

  async function loadConversations() {
    try {
      const result = await request('/api/conversations');
      state.conversations = result.conversations || [];
      renderConversationList();
      if (state.conversations.length) {
        const current = state.activeConversation?.id;
        const first = state.conversations.find((item) => item.id === current) || state.conversations[0];
        await selectConversation(first.id);
      } else {
        state.activeConversation = null;
        renderConversation();
      }
    } catch (error) {
      if (error.status === 401) return leaveApp();
      showToast(error.message, 'error');
    }
  }

  function conversationToSummary(conversation, draft = state.drafts.has(conversation.id)) {
    const last = conversation.messages?.[conversation.messages.length - 1];
    return {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages?.length || 0,
      preview: last?.content || 'Aucun message pour le moment',
      draft
    };
  }

  function renderConversationList() {
    elements.conversationCount.textContent = String(state.conversations.length);
    elements.conversationEmpty.classList.toggle('visible', state.conversations.length === 0);
    elements.conversationList.innerHTML = state.conversations.map((conversation) => `
      <button class="conversation-item ${state.activeConversation?.id === conversation.id ? 'active' : ''}" type="button" data-conversation-id="${escapeHtml(conversation.id)}">
        <span class="conversation-icon">${icon('message')}</span>
        <span class="conversation-item-copy">
          <span class="conversation-item-title">${escapeHtml(conversation.title)}</span>
          <span class="conversation-item-date">${conversation.draft ? 'Brouillon' : escapeHtml(formatDate(conversation.updatedAt))}</span>
        </span>
      </button>
    `).join('');
  }

  function renderConversation() {
    const conversation = state.activeConversation;
    const hasMessages = Boolean(conversation?.messages?.length);
    elements.welcomeView.classList.toggle('hidden', hasMessages);
    elements.messages.classList.toggle('hidden', !hasMessages);
    elements.activeTitle.textContent = conversation?.title || 'Nouvelle conversation';
    elements.deleteButton.disabled = !conversation;

    if (!hasMessages) {
      elements.messages.innerHTML = '';
      elements.chatScroll.scrollTop = 0;
      return;
    }

    const userInitial = state.user?.pseudo?.slice(0, 1).toUpperCase() || 'V';
    elements.messages.innerHTML = conversation.messages.map((message) => `
      <article class="message-row ${message.role === 'user' ? 'user' : 'assistant'}">
        ${message.role === 'user' ? `<div class="user-avatar">${escapeHtml(userInitial)}</div>` : `<div class="assistant-avatar">${logoIcon()}</div>`}
        <div class="message-content">
          <div class="message-meta"><span>${message.role === 'user' ? 'Vous' : 'Aster'}</span><span>${escapeHtml(formatDate(message.createdAt))}</span></div>
          <div class="message-bubble">${renderMarkdown(message.content)}</div>
        </div>
      </article>
    `).join('');
    scrollToBottom();
  }

  async function selectConversation(id) {
    if (state.loading) return;
    const draft = state.drafts.get(id);
    if (draft) {
      state.activeConversation = draft;
      renderConversationList();
      renderConversation();
      closeSidebar();
      return;
    }
    try {
      const result = await request(`/api/conversations/${encodeURIComponent(id)}`);
      state.activeConversation = result.conversation;
      renderConversationList();
      renderConversation();
      closeSidebar();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function createConversation() {
    if (state.loading) return null;
    const emptyDraft = [...state.drafts.values()].find((draft) => !draft.messages?.length);
    const conversation = emptyDraft || {
      id: `conv_${crypto.randomUUID()}`,
      title: 'Nouvelle conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    state.drafts.set(conversation.id, conversation);
    state.activeConversation = conversation;
    state.conversations = [conversationToSummary(conversation, true), ...state.conversations.filter((item) => item.id !== conversation.id)];
    renderConversationList();
    renderConversation();
    elements.messageInput.focus();
    closeSidebar();
    return conversation;
  }

  function updateConversationSummary(conversation) {
    state.drafts.delete(conversation.id);
    const summary = conversationToSummary(conversation, false);
    const index = state.conversations.findIndex((item) => item.id === conversation.id);
    if (index === -1) state.conversations.unshift(summary);
    else state.conversations[index] = summary;
    state.conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    renderConversationList();
  }

  async function sendMessage(content = elements.messageInput.value) {
    if (state.loading) return;
    const text = content.trim();
    if (!text) return;
    if (!state.activeConversation) createConversation();
    if (!state.activeConversation) return;

    state.loading = true;
    elements.messageInput.value = '';
    resizeInput();
    elements.sendButton.disabled = true;
    const optimistic = {
      id: `local_${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString()
    };
    state.activeConversation.messages = [...(state.activeConversation.messages || []), optimistic];
    if (!state.activeConversation.title || state.activeConversation.title === 'Nouvelle conversation') {
      state.activeConversation.title = text.split('\n')[0].slice(0, 48);
    }
    renderConversationList();
    renderConversation();
    elements.typing.classList.remove('hidden');
    scrollToBottom();

    try {
      const result = await request(`/api/conversations/${encodeURIComponent(state.activeConversation.id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: text })
      });
      state.activeConversation = result.conversation;
      updateConversationSummary(result.conversation);
      renderConversation();
    } catch (error) {
      if (error.payload?.conversation) {
        state.activeConversation = error.payload.conversation;
        updateConversationSummary(state.activeConversation);
        renderConversation();
      }
      showToast(error.message, 'error');
    } finally {
      state.loading = false;
      elements.typing.classList.add('hidden');
      elements.sendButton.disabled = false;
      elements.messageInput.focus();
    }
  }

  async function deleteActiveConversation() {
    const conversation = state.activeConversation;
    if (!conversation || state.loading) return;
    if (!window.confirm('Supprimer définitivement cette conversation ?')) return;
    try {
      if (state.drafts.has(conversation.id)) {
        state.drafts.delete(conversation.id);
      } else {
        await request(`/api/conversations/${encodeURIComponent(conversation.id)}`, { method: 'DELETE' });
      }
      state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
      state.activeConversation = null;
      renderConversationList();
      renderConversation();
      showToast('Conversation supprimée.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch {
      // Même si le réseau est indisponible, on quitte l'interface locale.
    }
    leaveApp();
  }

  function resizeInput() {
    elements.messageInput.style.height = 'auto';
    elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 180)}px`;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      elements.chatScroll.scrollTo({ top: elements.chatScroll.scrollHeight, behavior: 'smooth' });
    });
  }

  function openSidebar() {
    elements.sidebar.classList.add('open');
    elements.mobileScrim.classList.add('visible');
  }

  function closeSidebar() {
    elements.sidebar.classList.remove('open');
    elements.mobileScrim.classList.remove('visible');
  }

  function bindEvents() {
    $$('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab)));
    elements.loginForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitAuth(elements.loginForm, 'login');
    });
    elements.registerForm.addEventListener('submit', (event) => {
      event.preventDefault();
      submitAuth(elements.registerForm, 'register');
    });
    $$('.password-toggle').forEach((button) => button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.passwordTarget);
      input.type = input.type === 'password' ? 'text' : 'password';
    }));
    $('#new-chat-button').addEventListener('click', createConversation);
    $('#open-sidebar').addEventListener('click', openSidebar);
    $('#close-sidebar').addEventListener('click', closeSidebar);
    elements.mobileScrim.addEventListener('click', closeSidebar);
    $('#logout-button').addEventListener('click', logout);
    elements.deleteButton.addEventListener('click', deleteActiveConversation);
    elements.settingsButton.addEventListener('click', openSettings);
    $('#close-settings').addEventListener('click', closeSettings);
    elements.settingsScrim.addEventListener('click', closeSettings);
    $$('[data-logo-choice]').forEach((button) => button.addEventListener('click', () => setLogo(button.dataset.logoChoice)));
    $$('[data-style-choice]').forEach((button) => button.addEventListener('click', () => setInterfaceStyle(button.dataset.styleChoice)));
    elements.conversationList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-conversation-id]');
      if (button) selectConversation(button.dataset.conversationId);
    });
    elements.messageForm.addEventListener('submit', (event) => {
      event.preventDefault();
      sendMessage();
    });
    elements.messageInput.addEventListener('input', resizeInput);
    elements.messageInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    $$('.suggestion-card').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.suggestion)));
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        elements.messageInput.focus();
      }
      if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'n' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault();
        createConversation();
      }
      if (event.key === 'Escape') {
        closeSidebar();
        closeSettings();
      }
    });
  }

  boot();
})();
