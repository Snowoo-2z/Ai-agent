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
    logo: 'aster',
    animation: 'breathe'
  };

  const $ = (selector, parent = document) => parent.querySelector(selector);
  const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
  const icon = (name, className = 'icon') => `<svg class="${className}"><use href="#icon-${name}"></use></svg>`;
  const logoIcon = (className = 'icon') => {
    const pixel = state.logo.startsWith('pixel-') ? ' pixel-icon' : '';
    return `<svg class="${className}${pixel} logo-motion-${state.animation}" data-aster-logo aria-hidden="true"><use data-aster-use href="#icon-${state.logo}"></use></svg>`;
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
    themeButton: $('#theme-button'),
    settingsButton: $('#settings-button'),
    settingsDrawer: $('#settings-drawer'),
    settingsScrim: $('#settings-scrim'),
    selectedLogoLabel: $('#selected-logo-label'),
    selectedAnimationLabel: $('#selected-animation-label'),
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
    const lines = String(value ?? '').replace(/\r\n?/g, '\n').split('\n');
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
    return output.join('') || '<p></p>';
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
    const use = elements.themeButton?.querySelector('use');
    if (use) use.setAttribute('href', theme === 'dark' ? '#icon-sun' : '#icon-moon');
    elements.themeButton?.setAttribute('aria-label', theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre');
  }

  const logoLabels = {
    aster: 'Aster',
    orbit: 'Orbite',
    bloom: 'Bloom',
    prism: 'Prisme',
    'pixel-star': 'Pixel étoile',
    'pixel-orbit': 'Pixel orbite',
    'pixel-bloom': 'Pixel bloom',
    'pixel-heart': 'Pixel cœur'
  };

  const animationLabels = {
    breathe: 'Respiration',
    float: 'Flottement',
    spin: 'Rotation',
    pulse: 'Impulsion',
    bounce: 'Rebond',
    wiggle: 'Vibration',
    twinkle: 'Scintillement',
    glitch: 'Glitch',
    drift: 'Dérive',
    swing: 'Balancement',
    sparkle: 'Étincelle',
    wave: 'Onde'
  };

  function applyLogoVisuals() {
    const isPixel = state.logo.startsWith('pixel-');
    $$('[data-aster-logo]').forEach((logo) => {
      logo.classList.toggle('pixel-icon', isPixel);
      Object.keys(animationLabels).forEach((animation) => logo.classList.remove(`logo-motion-${animation}`));
      logo.classList.add(`logo-motion-${state.animation}`);
    });
    $$('[data-aster-use]').forEach((use) => use.setAttribute('href', `#icon-${state.logo}`));
  }

  function setLogo(logo) {
    const validLogos = Object.keys(logoLabels);
    state.logo = validLogos.includes(logo) ? logo : 'aster';
    localStorage.setItem('aster-logo', state.logo);
    applyLogoVisuals();
    $$('[data-logo-choice]').forEach((button) => {
      const active = button.dataset.logoChoice === state.logo;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    if (elements.selectedLogoLabel) elements.selectedLogoLabel.textContent = logoLabels[state.logo];
  }

  function setLogoAnimation(animation) {
    const validAnimations = Object.keys(animationLabels);
    state.animation = validAnimations.includes(animation) ? animation : 'breathe';
    localStorage.setItem('aster-logo-animation', state.animation);
    applyLogoVisuals();
    $$('[data-animation-choice]').forEach((button) => {
      const active = button.dataset.animationChoice === state.animation;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    if (elements.selectedAnimationLabel) elements.selectedAnimationLabel.textContent = animationLabels[state.animation];
  }

  function initialisePreferences() {
    const savedTheme = localStorage.getItem('aster-theme');
    const preferredTheme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    setTheme(savedTheme || preferredTheme);
    setLogo(localStorage.getItem('aster-logo') || 'aster');
    setLogoAnimation(localStorage.getItem('aster-logo-animation') || 'breathe');
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
    elements.themeButton.addEventListener('click', () => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    elements.settingsButton.addEventListener('click', openSettings);
    $('#close-settings').addEventListener('click', closeSettings);
    elements.settingsScrim.addEventListener('click', closeSettings);
    $$('[data-logo-choice]').forEach((button) => button.addEventListener('click', () => setLogo(button.dataset.logoChoice)));
    $$('[data-animation-choice]').forEach((button) => button.addEventListener('click', () => setLogoAnimation(button.dataset.animationChoice)));
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
