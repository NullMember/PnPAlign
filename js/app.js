(() => {
  const state = {
    cards: [], // {id, name, img, analyzed, autoColorTransform, autoAngle, colorStats, maskReliable}
    referenceId: null,
    selectedId: null,
    nextId: 1,

    colorEnabled: false,
    autoColorEnabled: true,
    manualColor: { brightness: 0, contrast: 0, saturation: 0, rGain: 1, gGain: 1, bGain: 1 },

    rotationEnabled: false,
    autoAngleEnabled: true,
    manualRotationDeg: 0,
    perCardRotationDeg: {},

    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    cropRefDim: null, // {w,h} of the card the crop values were computed against
  };

  const el = (id) => document.getElementById(id);
  const gallery = el('gallery');
  const cardCountEl = el('cardCount');
  const previewNameEl = el('previewName');
  const beforeCanvas = el('beforeCanvas');
  const afterCanvas = el('afterCanvas');
  const guideCanvas = el('guideCanvas');
  const guideRow = el('guideRow');
  const exportStatus = el('exportStatus');

  const PREVIEW_MAX_DIM = 520;
  const THUMB_MAX_DIM = 150;

  function getReference() {
    return state.cards.find((c) => c.id === state.referenceId) || null;
  }
  function getSelected() {
    return state.cards.find((c) => c.id === state.selectedId) || null;
  }

  function ensureAnalyzed(card) {
    if (card.analyzed) return;
    const result = Analyze.analyzeCard(card.img);
    card.autoAngle = result.angle;
    card.colorStats = result.colorStats;
    card.maskReliable = result.maskReliable;
    card.analyzed = true;
  }

  function currentOptions(cropRefOverride) {
    return {
      colorEnabled: state.colorEnabled,
      autoColorEnabled: state.autoColorEnabled,
      manualColor: state.manualColor,
      rotationEnabled: state.rotationEnabled,
      autoAngleEnabled: state.autoAngleEnabled,
      manualRotationDeg: state.manualRotationDeg,
      perCardRotationDeg: state.perCardRotationDeg,
      crop: state.crop,
      cropRefDim: cropRefOverride || state.cropRefDim,
    };
  }

  // ---------- File loading ----------

  function loadFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    let remaining = files.length;
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const card = {
          id: state.nextId++,
          name: file.name,
          img,
          analyzed: false,
        };
        state.cards.push(card);
        if (state.referenceId === null) state.referenceId = card.id;
        if (state.selectedId === null) state.selectedId = card.id;
        renderGallery();
        updateButtonsEnabled();
        if (state.selectedId === card.id) updatePreview();
      };
      img.src = url;
    });
  }

  el('fileInput').addEventListener('change', (e) => loadFiles(e.target.files));

  const dropzone = el('dropzone');
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  // ---------- Gallery ----------

  function renderGallery() {
    gallery.innerHTML = '';
    cardCountEl.textContent = state.cards.length ? `(${state.cards.length})` : '';
    state.cards.forEach((card) => {
      const div = document.createElement('div');
      div.className = 'card-thumb';
      if (card.id === state.selectedId) div.classList.add('selected');
      if (card.id === state.referenceId) div.classList.add('reference');

      const star = document.createElement('div');
      star.className = 'ref-star';
      star.textContent = '★';
      star.title = 'Set as reference card';
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        state.referenceId = card.id;
        renderGallery();
        recomputeAutoColorIfNeeded();
        updatePreview();
      });

      const remove = document.createElement('div');
      remove.className = 'remove-x';
      remove.textContent = '×';
      remove.title = 'Remove card';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCard(card.id);
      });

      const img = document.createElement('img');
      img.src = card.img.src;
      img.alt = card.name;

      const nameEl = document.createElement('div');
      nameEl.className = 'thumb-name';
      nameEl.textContent = card.name;
      nameEl.title = card.name;

      div.appendChild(star);
      div.appendChild(remove);
      div.appendChild(img);
      div.appendChild(nameEl);
      div.addEventListener('click', () => {
        state.selectedId = card.id;
        renderGallery();
        updatePreview();
      });
      gallery.appendChild(div);
    });
  }

  function removeCard(id) {
    state.cards = state.cards.filter((c) => c.id !== id);
    delete state.perCardRotationDeg[id];
    if (state.referenceId === id) state.referenceId = state.cards[0]?.id ?? null;
    if (state.selectedId === id) state.selectedId = state.cards[0]?.id ?? null;
    renderGallery();
    updateButtonsEnabled();
    updatePreview();
  }

  function updateButtonsEnabled() {
    const has = state.cards.length > 0;
    const hasTwo = state.cards.length > 0;
    el('autoColorBtn').disabled = !hasTwo;
    el('autoRotateBtn').disabled = !hasTwo;
    el('suggestCropBtn').disabled = !hasTwo;
    el('downloadOneBtn').disabled = !has;
    el('downloadAllBtn').disabled = !has;
  }

  // ---------- Color controls ----------

  el('autoColorBtn').addEventListener('click', () => {
    const ref = getReference();
    if (!ref) return;
    ensureAnalyzed(ref);
    state.cards.forEach((card) => {
      ensureAnalyzed(card);
      card.autoColorTransform = ColorAlign.computeAutoTransform(card.colorStats, ref.colorStats);
    });
    state.colorEnabled = true;
    state.autoColorEnabled = true;
    el('colorEnabled').checked = true;
    el('colorEnabled').disabled = false;
    el('autoColorEnabled').checked = true;
    el('autoColorEnabled').disabled = false;
    refreshAll();
  });

  function recomputeAutoColorIfNeeded() {
    if (!state.colorEnabled || !state.autoColorEnabled) return;
    const ref = getReference();
    if (!ref) return;
    ensureAnalyzed(ref);
    state.cards.forEach((card) => {
      ensureAnalyzed(card);
      card.autoColorTransform = ColorAlign.computeAutoTransform(card.colorStats, ref.colorStats);
    });
    refreshAll();
  }

  el('colorEnabled').addEventListener('change', (e) => {
    state.colorEnabled = e.target.checked;
    refreshAll();
  });
  el('autoColorEnabled').addEventListener('change', (e) => {
    state.autoColorEnabled = e.target.checked;
    refreshAll();
  });

  function bindSlider(id, outId, key, isFloat, formatter) {
    const input = el(id);
    const out = el(outId);
    input.addEventListener('input', () => {
      const v = isFloat ? parseFloat(input.value) : parseInt(input.value, 10);
      state.manualColor[key] = v;
      out.textContent = formatter ? formatter(v) : v;
      updatePreview();
    });
    input.addEventListener('change', () => refreshThumbnails());
  }
  bindSlider('brightness', 'brightnessOut', 'brightness', false);
  bindSlider('contrast', 'contrastOut', 'contrast', false);
  bindSlider('saturation', 'saturationOut', 'saturation', false);
  bindSlider('rGain', 'rGainOut', 'rGain', true, (v) => v.toFixed(2));
  bindSlider('gGain', 'gGainOut', 'gGain', true, (v) => v.toFixed(2));
  bindSlider('bGain', 'bGainOut', 'bGain', true, (v) => v.toFixed(2));

  el('resetColorBtn').addEventListener('click', () => {
    state.manualColor = { brightness: 0, contrast: 0, saturation: 0, rGain: 1, gGain: 1, bGain: 1 };
    el('brightness').value = 0; el('brightnessOut').textContent = '0';
    el('contrast').value = 0; el('contrastOut').textContent = '0';
    el('saturation').value = 0; el('saturationOut').textContent = '0';
    el('rGain').value = 1; el('rGainOut').textContent = '1.00';
    el('gGain').value = 1; el('gGainOut').textContent = '1.00';
    el('bGain').value = 1; el('bGainOut').textContent = '1.00';
    refreshAll();
  });

  // ---------- Rotation controls ----------

  el('autoRotateBtn').addEventListener('click', () => {
    state.cards.forEach((card) => ensureAnalyzed(card));
    state.rotationEnabled = true;
    state.autoAngleEnabled = true;
    el('rotationEnabled').checked = true;
    el('rotationEnabled').disabled = false;
    el('autoAngleEnabled').checked = true;
    el('autoAngleEnabled').disabled = false;
    autoSuggestCrop();
    refreshAll();
  });

  el('rotationEnabled').addEventListener('change', (e) => {
    state.rotationEnabled = e.target.checked;
    refreshAll();
  });
  el('autoAngleEnabled').addEventListener('change', (e) => {
    state.autoAngleEnabled = e.target.checked;
    refreshAll();
  });

  el('manualRotation').addEventListener('input', (e) => {
    state.manualRotationDeg = parseFloat(e.target.value);
    el('manualRotationOut').textContent = state.manualRotationDeg.toFixed(1);
    updatePreview();
  });
  el('manualRotation').addEventListener('change', () => {
    refreshThumbnails();
  });

  el('perCardRotation').addEventListener('input', (e) => {
    const card = getSelected();
    if (!card) return;
    state.perCardRotationDeg[card.id] = parseFloat(e.target.value) || 0;
    updatePreview();
  });
  el('perCardRotation').addEventListener('change', () => refreshThumbnails());

  el('resetRotationBtn').addEventListener('click', () => {
    state.manualRotationDeg = 0;
    state.perCardRotationDeg = {};
    el('manualRotation').value = 0;
    el('manualRotationOut').textContent = '0.0';
    el('perCardRotation').value = 0;
    refreshAll();
  });

  // ---------- Crop controls ----------

  function currentMaxAbsAngle() {
    let max = 0;
    state.cards.forEach((card) => {
      const auto = state.autoAngleEnabled ? card.autoAngle || 0 : 0;
      const perCard = state.perCardRotationDeg[card.id] || 0;
      const total = auto + state.manualRotationDeg + perCard;
      max = Math.max(max, Math.abs(total));
    });
    return max;
  }

  function autoSuggestCrop() {
    const ref = getReference() || state.cards[0];
    if (!ref) return;
    const w = ref.img.naturalWidth || ref.img.width;
    const h = ref.img.naturalHeight || ref.img.height;
    const maxAngle = currentMaxAbsAngle();
    const crop = Render.suggestedCrop(w, h, maxAngle);
    state.crop = crop;
    state.cropRefDim = { w, h };
    el('cropTop').value = crop.top;
    el('cropBottom').value = crop.bottom;
    el('cropLeft').value = crop.left;
    el('cropRight').value = crop.right;
  }

  el('suggestCropBtn').addEventListener('click', () => {
    autoSuggestCrop();
    refreshAll();
  });

  ['cropTop', 'cropBottom', 'cropLeft', 'cropRight'].forEach((id) => {
    el(id).addEventListener('input', () => {
      state.crop = {
        top: parseInt(el('cropTop').value, 10) || 0,
        bottom: parseInt(el('cropBottom').value, 10) || 0,
        left: parseInt(el('cropLeft').value, 10) || 0,
        right: parseInt(el('cropRight').value, 10) || 0,
      };
      if (!state.cropRefDim) {
        const ref = getReference() || state.cards[0];
        if (ref) state.cropRefDim = { w: ref.img.naturalWidth || ref.img.width, h: ref.img.naturalHeight || ref.img.height };
      }
      updatePreview();
    });
    el(id).addEventListener('change', () => refreshThumbnails());
  });

  el('showCropGuide').addEventListener('change', () => updatePreview());

  // ---------- Preview ----------

  function drawImageToCanvas(canvas, img, maxDim) {
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
    canvas.width = Math.round(naturalW * scale);
    canvas.height = Math.round(naturalH * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  function copyCanvas(dest, src) {
    dest.width = src.width;
    dest.height = src.height;
    dest.getContext('2d').drawImage(src, 0, 0);
  }

  function updatePreview() {
    const card = getSelected();
    if (!card) {
      previewNameEl.textContent = '— select a card —';
      [beforeCanvas, afterCanvas, guideCanvas].forEach((c) => {
        c.width = 0;
        c.height = 0;
      });
      return;
    }
    previewNameEl.textContent = card.name + (card.id === state.referenceId ? '  (reference)' : '');
    ensureAnalyzed(card);

    drawImageToCanvas(beforeCanvas, card.img, PREVIEW_MAX_DIM);

    if (card.id === state.referenceId && state.colorEnabled && state.autoColorEnabled) {
      // reference should already match itself; still show its own manual/rotation edits
    }

    const finalCanvas = Render.renderCard(card, currentOptions(), PREVIEW_MAX_DIM);
    copyCanvas(afterCanvas, finalCanvas);

    // Guide: rotated but uncropped, with red crop overlay
    const showGuide = state.rotationEnabled && el('showCropGuide').checked;
    guideRow.style.display = showGuide ? '' : 'none';
    if (showGuide) {
      const naturalW = card.img.naturalWidth || card.img.width;
      const naturalH = card.img.naturalHeight || card.img.height;
      const uncroppedOptions = currentOptions();
      uncroppedOptions.crop = { top: 0, right: 0, bottom: 0, left: 0 };
      const uncropped = Render.renderCard(card, uncroppedOptions, PREVIEW_MAX_DIM);
      copyCanvas(guideCanvas, uncropped);
      const gctx = guideCanvas.getContext('2d');
      let crop = state.crop;
      if (state.cropRefDim) {
        const sx = uncropped.width / state.cropRefDim.w;
        const sy = uncropped.height / state.cropRefDim.h;
        crop = {
          top: crop.top * sy,
          bottom: crop.bottom * sy,
          left: crop.left * sx,
          right: crop.right * sx,
        };
      }
      gctx.strokeStyle = '#dc2626';
      gctx.lineWidth = 2;
      gctx.setLineDash([6, 4]);
      gctx.strokeRect(crop.left, crop.top, uncropped.width - crop.left - crop.right, uncropped.height - crop.top - crop.bottom);
    }
  }

  function refreshThumbnails() {
    document.querySelectorAll('.card-thumb img').forEach((imgEl, idx) => {
      const card = state.cards[idx];
      if (!card) return;
      const canvas = Render.renderCard(card, currentOptions(), THUMB_MAX_DIM);
      imgEl.src = canvas.toDataURL('image/png');
    });
  }

  function refreshAll() {
    updatePreview();
    refreshThumbnails();
  }

  // ---------- Export ----------

  function downloadCanvas(canvas, filename, format) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(url), 4000);
          resolve();
        },
        format,
        0.95
      );
    });
  }

  function extForFormat(format) {
    return format === 'image/jpeg' ? 'jpg' : 'png';
  }

  el('downloadOneBtn').addEventListener('click', async () => {
    const card = getSelected();
    if (!card) return;
    const format = el('exportFormat').value;
    const canvas = Render.renderCard(card, currentOptions(), null); // null = full resolution
    const baseName = card.name.replace(/\.[^.]+$/, '');
    await downloadCanvas(canvas, `${baseName}_aligned.${extForFormat(format)}`, format);
  });

  el('downloadAllBtn').addEventListener('click', async () => {
    const format = el('exportFormat').value;
    const btn = el('downloadAllBtn');
    btn.disabled = true;
    for (let i = 0; i < state.cards.length; i++) {
      const card = state.cards[i];
      exportStatus.textContent = `Exporting ${i + 1} / ${state.cards.length}: ${card.name}...`;
      const canvas = Render.renderCard(card, currentOptions(), null);
      const baseName = card.name.replace(/\.[^.]+$/, '');
      await downloadCanvas(canvas, `${baseName}_aligned.${extForFormat(format)}`, format);
      await new Promise((r) => setTimeout(r, 250)); // avoid browser blocking rapid-fire downloads
    }
    exportStatus.textContent = `Done — exported ${state.cards.length} card(s).`;
    btn.disabled = false;
  });

  updateButtonsEnabled();
})();
