/**
 * Biedronka Promo Hunter – App Logic
 * Handles search, progress tracking, gallery, and lightbox
 */

(function () {
  'use strict';

  // === DOM Elements ===
  const sectionSearch = document.getElementById('section-search');
  const sectionProgress = document.getElementById('section-progress');
  const sectionResults = document.getElementById('section-results');
  const sectionSettings = document.getElementById('section-settings');

  const searchInput = document.getElementById('search-input');
  const searchBtn = document.getElementById('search-btn');
  const discordToggle = document.getElementById('discord-toggle');

  const progressPercent = document.getElementById('progress-percent');
  const progressTitle = document.getElementById('progress-title');
  const progressDetail = document.getElementById('progress-detail');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const progressRingFill = document.getElementById('progress-ring-fill');
  const stopBtn = document.getElementById('stop-btn');

  const resultsCount = document.getElementById('results-count');
  const galleryGrid = document.getElementById('gallery-grid');
  const noResults = document.getElementById('no-results');
  const newSearchBtn = document.getElementById('new-search-btn');

  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxInfo = document.getElementById('lightbox-info');
  const lightboxClose = document.getElementById('lightbox-close');
  const lightboxPrev = document.getElementById('lightbox-prev');
  const lightboxNext = document.getElementById('lightbox-next');

  const navLinks = document.querySelectorAll('.nav-link');

  // === State ===
  let foundImages = [];
  let currentLightboxIndex = -1;
  let isSearching = false;
  let currentKeyword = '';
  let thumbnailWidth = 300; // default thumbnail width in px

  // === SVG Gradient for Progress Ring (inject into SVG) ===
  const ringSvg = document.querySelector('.ring-svg');
  if (ringSvg) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    const gradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
    gradient.id = 'ring-gradient';
    gradient.setAttribute('x1', '0%');
    gradient.setAttribute('y1', '0%');
    gradient.setAttribute('x2', '100%');
    gradient.setAttribute('y2', '100%');

    const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#ecc94b');

    const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#e53e3e');

    gradient.appendChild(stop1);
    gradient.appendChild(stop2);
    defs.appendChild(gradient);
    ringSvg.insertBefore(defs, ringSvg.firstChild);
  }

  // === Navigation ===
  function showSection(sectionId) {
    [sectionSearch, sectionProgress, sectionResults, sectionSettings].forEach((s) => {
      if (s) s.classList.remove('active');
    });

    navLinks.forEach((link) => {
      link.classList.remove('active');
      if (link.dataset.section === sectionId) {
        link.classList.add('active');
      }
    });

    const target = document.getElementById('section-' + sectionId);
    if (target) {
      target.classList.add('active');
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      if (isSearching) {
        showToast('Poczekaj aż wyszukiwanie się zakończy lub zatrzymaj je przyciskiem „Zatrzymaj”.');
        return;
      }
      if (section === 'results' && foundImages.length === 0) return;
      showSection(section);
    });
  });

  // === Toast notification ===
  let toastTimeout = null;
  function showToast(message) {
    let toast = document.getElementById('search-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'search-toast';
      toast.className = 'toast-notification';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove('toast-hide');
    toast.classList.add('toast-show');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('toast-show');
      toast.classList.add('toast-hide');
    }, 3500);
  }

  // === Title Bar Controls ===
  document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimizeWindow());
  document.getElementById('btn-maximize').addEventListener('click', () => window.api.maximizeWindow());
  document.getElementById('btn-close').addEventListener('click', () => window.api.closeWindow());

  // === Search ===
  function startSearch() {
    const keyword = searchInput.value.trim();
    if (!keyword || isSearching) return;

    isSearching = true;
    currentKeyword = keyword;
    foundImages = [];
    galleryGrid.innerHTML = '';
    noResults.style.display = 'none';
    searchBtn.disabled = true;

    // Set keyword in results header
    const resultsKeyword = document.getElementById('results-keyword');
    if (resultsKeyword) resultsKeyword.textContent = keyword;

    // Reset progress
    setProgress(0, 0);
    progressTitle.textContent = 'Skanowanie gazetek...';
    progressDetail.textContent = 'Inicjalizacja...';

    showSection('progress');
    if (window.particleSystem) window.particleSystem.setSearching(true);
    window.api.startSearch(keyword, discordToggle.checked);
  }

  searchBtn.addEventListener('click', startSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startSearch();
  });

  stopBtn.addEventListener('click', () => {
    window.api.stopSearch();
    finishSearch(foundImages.length);
  });

  newSearchBtn.addEventListener('click', () => {
    showSection('search');
    searchInput.focus();
    searchInput.select();
  });

  // === Progress ===
  function setProgress(current, total) {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    progressPercent.textContent = pct + '%';
    progressBarFill.style.width = pct + '%';

    // Update ring
    const circumference = 2 * Math.PI * 52; // r=52
    const offset = circumference - (pct / 100) * circumference;
    progressRingFill.style.strokeDashoffset = offset;
  }

  // === Gallery ===
  function addImageCard(imagePath, leafletName, pageNumber) {
    const index = foundImages.length;
    const resultNumber = index + 1;
    foundImages.push({ path: imagePath, leafletName, pageNumber });

    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.style.animationDelay = `${Math.min(index * 0.05, 0.6)}s`;

    const thumbSrc = 'local-image://' + imagePath + '?thumb=' + thumbnailWidth;

    card.innerHTML = `
      <img src="${thumbSrc}" alt="Wynik ${resultNumber}" loading="lazy">
      <div class="card-badge">${resultNumber}</div>
    `;

    card.addEventListener('click', () => openLightbox(index));
    galleryGrid.appendChild(card);

    // Update count in results header
    resultsCount.textContent = foundImages.length;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // === Lightbox ===
  function openLightbox(index) {
    if (index < 0 || index >= foundImages.length) return;
    currentLightboxIndex = index;

    const img = foundImages[index];
    lightboxImg.src = 'local-image://' + img.path;
    lightboxInfo.textContent = `Wynik ${index + 1} z ${foundImages.length}`;

    lightbox.classList.add('active');
    updateLightboxNav();
  }

  function closeLightbox() {
    lightbox.classList.remove('active');
    currentLightboxIndex = -1;
  }

  function updateLightboxNav() {
    lightboxPrev.style.visibility = currentLightboxIndex > 0 ? 'visible' : 'hidden';
    lightboxNext.style.visibility = currentLightboxIndex < foundImages.length - 1 ? 'visible' : 'hidden';
  }

  lightboxClose.addEventListener('click', closeLightbox);
  document.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);

  lightboxPrev.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentLightboxIndex > 0) openLightbox(currentLightboxIndex - 1);
  });

  lightboxNext.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentLightboxIndex < foundImages.length - 1) openLightbox(currentLightboxIndex + 1);
  });

  document.addEventListener('keydown', (e) => {
    if (!lightbox.classList.contains('active')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft' && currentLightboxIndex > 0) openLightbox(currentLightboxIndex - 1);
    if (e.key === 'ArrowRight' && currentLightboxIndex < foundImages.length - 1) openLightbox(currentLightboxIndex + 1);
  });

  // === Finish Search ===
  function finishSearch(count) {
    isSearching = false;
    searchBtn.disabled = false;
    if (window.particleSystem) window.particleSystem.setSearching(false);

    if (count > 0) {
      noResults.style.display = 'none';
    } else {
      noResults.style.display = 'flex';
    }

    resultsCount.textContent = count;
    showSection('results');
  }

  // === IPC Event Handling ===
  window.api.onSearchEvent((evt) => {
    console.log('[search-event]', evt.type, evt);
    switch (evt.type) {
      case 'status':
        progressDetail.textContent = evt.message;
        break;

      case 'progress':
        console.log(`[progress] ${evt.current}/${evt.total}`);
        setProgress(evt.current, evt.total);
        if (evt.leaflet === 'cache') {
          progressTitle.textContent = `Cache: ${evt.current} / ${evt.total}`;
          progressDetail.textContent = `Przeszukuję indeks cache...`;
        } else if (evt.leaflet) {
          progressTitle.textContent = `OCR: ${evt.current} / ${evt.total}`;
          progressDetail.textContent = `${evt.leaflet} — Strona ${evt.page}`;
        } else {
          progressTitle.textContent = `Postęp: ${evt.current} / ${evt.total}`;
        }
        break;

      case 'found':
        addImageCard(evt.path, evt.leaflet_name, evt.page_number);
        progressTitle.textContent = `Znaleziono: ${foundImages.length} wyników`;
        break;

      case 'error':
        progressDetail.textContent = '⚠ ' + evt.message;
        break;

      case 'done':
        finishSearch(evt.found_count);
        break;

      case 'process-ended':
        if (isSearching) {
          finishSearch(foundImages.length);
        }
        break;
    }
  });

  // === Auto-focus search input ===
  searchInput.focus();

  // === Settings: Discord webhook (file-based config) ===
  const webhookInput = document.getElementById('settings-webhook');
  const webhookSaveBtn = document.getElementById('settings-webhook-save');
  const webhookStatus = document.getElementById('webhook-status');
  const settingsDiscordToggle = document.getElementById('settings-discord-toggle');
  const thumbQualitySlider = document.getElementById('settings-thumb-quality');
  const thumbQualityLabel = document.getElementById('thumb-quality-label');

  // Load config from file on startup
  async function loadAppConfig() {
    try {
      const config = await window.api.loadConfig();
      if (webhookInput && config.discordWebhookUrl) {
        webhookInput.value = config.discordWebhookUrl;
      }
      if (config.discordEnabled) {
        discordToggle.checked = true;
        if (settingsDiscordToggle) settingsDiscordToggle.checked = true;
      }
      if (config.thumbnailWidth) {
        thumbnailWidth = config.thumbnailWidth;
        if (thumbQualitySlider) thumbQualitySlider.value = thumbnailWidth;
        if (thumbQualityLabel) thumbQualityLabel.textContent = thumbnailWidth + ' px';
      }
    } catch {}
  }
  loadAppConfig();

  async function saveAppConfig() {
    const config = {
      discordWebhookUrl: webhookInput ? webhookInput.value.trim() : '',
      discordEnabled: discordToggle.checked,
      thumbnailWidth: thumbnailWidth,
    };
    await window.api.saveConfig(config);
  }

  // Sync settings toggle with search-page toggle
  if (settingsDiscordToggle) {
    settingsDiscordToggle.addEventListener('change', () => {
      discordToggle.checked = settingsDiscordToggle.checked;
      saveAppConfig();
    });
    discordToggle.addEventListener('change', () => {
      settingsDiscordToggle.checked = discordToggle.checked;
      saveAppConfig();
    });
  }

  // Thumbnail quality slider
  if (thumbQualitySlider) {
    thumbQualitySlider.addEventListener('input', () => {
      const val = parseInt(thumbQualitySlider.value, 10);
      if (thumbQualityLabel) thumbQualityLabel.textContent = val + ' px';
    });
    thumbQualitySlider.addEventListener('change', () => {
      thumbnailWidth = parseInt(thumbQualitySlider.value, 10);
      saveAppConfig();
    });
  }

  if (webhookSaveBtn) {
    webhookSaveBtn.addEventListener('click', async () => {
      const url = webhookInput.value.trim();
      if (url && url.startsWith('https://discord.com/api/webhooks/')) {
        await saveAppConfig();
        webhookStatus.textContent = 'Zapisano do config.json!';
        webhookStatus.className = 'settings-status success';
        webhookStatus.style.display = 'block';
      } else if (!url) {
        await saveAppConfig();
        webhookStatus.textContent = 'Webhook usunięty.';
        webhookStatus.className = 'settings-status success';
        webhookStatus.style.display = 'block';
      } else {
        webhookStatus.textContent = 'Niepoprawny URL webhooka Discord.';
        webhookStatus.className = 'settings-status error';
        webhookStatus.style.display = 'block';
      }
      setTimeout(() => { webhookStatus.style.display = 'none'; }, 3000);
    });
  }
})();
