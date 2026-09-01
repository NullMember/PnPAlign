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

    autoScaleEnabled: true,
    autoPositionEnabled: true,

    crop: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  const el = (id) => document.getElementById(id);
  const gallery = el('gallery');
  const cardCountEl = el('cardCount');
  const previewNameEl = el('previewName');
  const referenceCanvas = el('referenceCanvas');
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
    card.cardSize = result.cardSize;
    card.colorStats = result.colorStats;
    card.maskReliable = result.maskReliable;
    card.analyzed = true;
  }

  // Scale each card so its printed content matches the reference's physical size —
  // otherwise cards scanned at a slightly different zoom/DPI stay a different size
  // than everyone else even after rotation and crop line their edges up.
  function computeAutoScales() {
    const ref = getReference();
    if (!ref || !ref.cardSize) {
      state.cards.forEach((c) => (c.autoScale = 1));
      return;
    }
    state.cards.forEach((card) => {
      if (card.id === ref.id || !card.cardSize) {
        card.autoScale = 1;
        return;
      }
      const scaleLong = ref.cardSize.long / card.cardSize.long;
      const scaleShort = ref.cardSize.short / card.cardSize.short;
      card.autoScale = Math.max(0.8, Math.min(1.25, (scaleLong + scaleShort) / 2));
    });
  }

  const OFFSET_CORR_MAX_DIM = 300; // downscale target for position-alignment search (speed; shift is scaled back up to full res)

  function canvasGray(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Float64Array(w * h);
    for (let i = 0, n = w * h; i < n; i++) {
      const o = i * 4;
      gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    return { gray, w, h };
  }

  // Finds, per card, the pixel shift (in that card's own full-resolution post-scale space)
  // that best lines its printed content up with the reference's. Must run after rotation and
  // scale are already known (computeAutoScales) — this only corrects leftover translation, on
  // top of an already-leveled, already-matched-size render, using Offset.computeOffset on a
  // downscaled grayscale rendering of each (uncropped, rotated, scaled) card.
  function computeAutoOffsets() {
    const ref = getReference();
    if (!ref) {
      state.cards.forEach((c) => (c.autoOffset = { dx: 0, dy: 0 }));
      return;
    }
    const baseOptions = { ...currentOptions(), colorEnabled: false, autoPositionEnabled: false, crop: null };

    const refCanvas = Render.renderCard(ref, baseOptions, OFFSET_CORR_MAX_DIM);
    const { gray: refGray, w: refW, h: refH } = canvasGray(refCanvas);
    ref.autoOffset = { dx: 0, dy: 0 };

    state.cards.forEach((card) => {
      if (card.id === ref.id) return;
      const cardCanvas = Render.renderCard(card, baseOptions, OFFSET_CORR_MAX_DIM);
      const cardPreviewScale = previewScaleFor(card, baseOptions, OFFSET_CORR_MAX_DIM);
      const { gray: cardGray, w: cardW, h: cardH } = canvasGray(cardCanvas);
      const { dx, dy } = Offset.computeOffset(refGray, refW, refH, cardGray, cardW, cardH);
      // dx/dy come back in this low-res render's pixel space — convert to the card's own
      // full-resolution (post-scale) pixel space so render.js can rescale it consistently
      // for any output size, the same way autoAngle/autoScale already are.
      card.autoOffset = { dx: dx / cardPreviewScale, dy: dy / cardPreviewScale };
    });
  }

  function currentOptions() {
    return {
      colorEnabled: state.colorEnabled,
      autoColorEnabled: state.autoColorEnabled,
      manualColor: state.manualColor,
      rotationEnabled: state.rotationEnabled,
      autoAngleEnabled: state.autoAngleEnabled,
      manualRotationDeg: state.manualRotationDeg,
      perCardRotationDeg: state.perCardRotationDeg,
      autoScaleEnabled: state.autoScaleEnabled,
      autoPositionEnabled: state.autoPositionEnabled,
      crop: state.crop,
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
        if (state.autoScaleEnabled || state.autoPositionEnabled) {
          state.cards.forEach((c) => ensureAnalyzed(c));
          if (state.autoScaleEnabled) computeAutoScales();
          if (state.autoPositionEnabled) computeAutoOffsets();
        }
        refreshAll();
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
    el('autoScaleBtn').disabled = !hasTwo;
    el('autoPositionBtn').disabled = !hasTwo;
    el('suggestCropBtn').disabled = !hasTwo;
    el('downloadOneBtn').disabled = !has;
    el('downloadAllBtn').disabled = !has;
    el('downloadAllZipBtn').disabled = !has;
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
  // Rotation, scale, and position are independent alignment stages, each with its own
  // detect button and enable toggle — you can run them in any order, or skip one entirely.
  // They still compose in a fixed pipeline order at render time (see render.js): scale is
  // baked into the working-resolution draw, then rotation, then position, then crop — scale
  // first keeps angle/position math in normalized units, and position runs last (right
  // before crop) since it's measured against whatever rotation is currently applied and
  // should correct whatever drift that rotation leaves behind, not get undone by it.

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

  // ---------- Scale controls ----------

  el('autoScaleBtn').addEventListener('click', () => {
    state.cards.forEach((card) => ensureAnalyzed(card));
    state.autoScaleEnabled = true;
    el('autoScaleEnabled').checked = true;
    el('autoScaleEnabled').disabled = false;
    computeAutoScales();
    autoSuggestCrop();
    refreshAll();
  });

  el('autoScaleEnabled').addEventListener('change', (e) => {
    state.autoScaleEnabled = e.target.checked;
    refreshAll();
  });

  // ---------- Position controls ----------

  el('autoPositionBtn').addEventListener('click', () => {
    state.cards.forEach((card) => ensureAnalyzed(card));
    state.autoPositionEnabled = true;
    el('autoPositionEnabled').checked = true;
    el('autoPositionEnabled').disabled = false;
    computeAutoOffsets();
    autoSuggestCrop();
    refreshAll();
  });

  el('autoPositionEnabled').addEventListener('change', (e) => {
    state.autoPositionEnabled = e.target.checked;
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

  // Worst case across all 4 edges: the rotation-derived margin (same on both sides of an
  // axis, since different cards can skew in either direction) plus, per edge, the largest
  // position-alignment shift that would leave that specific edge with a blank margin. A
  // card shifted right (positive dx) exposes blank on its LEFT; shifted left exposes blank
  // on its RIGHT; same logic for dy/top/bottom. Taking the max per edge across all cards
  // (rather than a single combined pixel budget split evenly) keeps the crop anchored and
  // no larger than it needs to be on each side.
  function autoSuggestCrop() {
    const ref = getReference() || state.cards[0];
    if (!ref) return;
    const w = ref.img.naturalWidth || ref.img.width;
    const h = ref.img.naturalHeight || ref.img.height;
    const maxAngle = currentMaxAbsAngle();
    const rot = Render.suggestedCrop(w, h, maxAngle);

    let extraLeft = 0, extraRight = 0, extraTop = 0, extraBottom = 0;
    if (state.autoPositionEnabled) {
      state.cards.forEach((card) => {
        const off = card.autoOffset;
        if (!off) return;
        extraLeft = Math.max(extraLeft, off.dx);
        extraRight = Math.max(extraRight, -off.dx);
        extraTop = Math.max(extraTop, off.dy);
        extraBottom = Math.max(extraBottom, -off.dy);
      });
    }

    const crop = {
      top: Math.ceil(rot.top + extraTop),
      bottom: Math.ceil(rot.bottom + extraBottom),
      left: Math.ceil(rot.left + extraLeft),
      right: Math.ceil(rot.right + extraRight),
    };
    state.crop = crop;
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

  // Mirrors Render.renderCard's internal scale math, needed here only to place the
  // crop-guide overlay rectangle at the right size on the uncropped preview canvas.
  function previewScaleFor(card, options, maxDim) {
    const naturalW = card.img.naturalWidth || card.img.width;
    const naturalH = card.img.naturalHeight || card.img.height;
    const cardScale = options.autoScaleEnabled && card.autoScale ? card.autoScale : 1;
    const targetW = naturalW * cardScale;
    const targetH = naturalH * cardScale;
    return maxDim ? Math.min(1, maxDim / Math.max(targetW, targetH)) : 1;
  }

  function updatePreview() {
    const ref = getReference();
    if (ref) {
      ensureAnalyzed(ref);
      const refCanvas = Render.renderCard(ref, currentOptions(), PREVIEW_MAX_DIM);
      copyCanvas(referenceCanvas, refCanvas);
    } else {
      referenceCanvas.width = 0;
      referenceCanvas.height = 0;
    }

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

    const finalCanvas = Render.renderCard(card, currentOptions(), PREVIEW_MAX_DIM);
    copyCanvas(afterCanvas, finalCanvas);

    // Guide: rotated/positioned but uncropped, with red crop overlay. The overlay rectangle
    // is drawn at the crop's actual anchored (left, top) offset — not re-centered — so it
    // doubles as a check that this card's content really did land where the reference's did;
    // if a card still has residual position drift, the rectangle will visibly miss its icons.
    const showGuide = (state.rotationEnabled || state.autoScaleEnabled || state.autoPositionEnabled) && el('showCropGuide').checked;
    guideRow.style.display = showGuide ? '' : 'none';
    if (showGuide) {
      const options = currentOptions();
      const uncroppedOptions = { ...options, crop: null };
      const uncropped = Render.renderCard(card, uncroppedOptions, PREVIEW_MAX_DIM);
      copyCanvas(guideCanvas, uncropped);
      const gctx = guideCanvas.getContext('2d');
      const previewScale = previewScaleFor(card, options, PREVIEW_MAX_DIM);
      const crop = options.crop;
      const left = crop ? Math.round(crop.left * previewScale) : 0;
      const top = crop ? Math.round(crop.top * previewScale) : 0;
      const right = crop ? Math.round(crop.right * previewScale) : 0;
      const bottom = crop ? Math.round(crop.bottom * previewScale) : 0;
      const rectW = Math.max(1, uncropped.width - left - right);
      const rectH = Math.max(1, uncropped.height - top - bottom);
      gctx.strokeStyle = '#dc2626';
      gctx.lineWidth = 2;
      gctx.setLineDash([6, 4]);
      gctx.strokeRect(left, top, rectW, rectH);
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

  function canvasToBytes(canvas, format) {
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
        },
        format,
        0.95
      );
    });
  }

  function uniqueZipName(name, used) {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) {
      candidate = name.replace(/(\.[^.]+)$/, `_${n}$1`);
      n++;
    }
    used.add(candidate);
    return candidate;
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

  el('downloadAllZipBtn').addEventListener('click', async () => {
    const format = el('exportFormat').value;
    const ext = extForFormat(format);
    const btn = el('downloadAllZipBtn');
    btn.disabled = true;
    const used = new Set();
    const files = [];
    for (let i = 0; i < state.cards.length; i++) {
      const card = state.cards[i];
      exportStatus.textContent = `Preparing ZIP ${i + 1} / ${state.cards.length}: ${card.name}...`;
      const canvas = Render.renderCard(card, currentOptions(), null);
      const bytes = await canvasToBytes(canvas, format);
      const baseName = card.name.replace(/\.[^.]+$/, '');
      const name = uniqueZipName(`${baseName}_aligned.${ext}`, used);
      files.push({ name, data: bytes });
    }
    exportStatus.textContent = `Building ZIP archive...`;
    const zipBlob = Zip.createZip(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'aligned_cards.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    exportStatus.textContent = `Done — zipped ${state.cards.length} card(s).`;
    btn.disabled = false;
  });

  updateButtonsEnabled();
})();
