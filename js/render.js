// Full per-card render pipeline: color -> rotation -> crop, at any target resolution.

const Render = (() => {
  function suggestedCrop(width, height, angleDeg) {
    const rad = (Math.abs(angleDeg) * Math.PI) / 180;
    if (rad < 1e-6) return { top: 0, right: 0, bottom: 0, left: 0 };
    const { w: iw, h: ih } = Geometry.rotatedRectWithMaxArea(width, height, rad);
    const tb = Math.ceil((height - ih) / 2) + 1;
    const lr = Math.ceil((width - iw) / 2) + 1;
    return { top: tb, bottom: tb, left: lr, right: lr };
  }

  // Renders one card at the given output max-dimension. Returns a canvas.
  // card: { img, autoColorTransform, autoAngle, autoScale }
  // options: { colorEnabled, manualColor, rotationEnabled, autoAngleEnabled, manualRotationDeg, perCardRotationDeg,
  //            autoScaleEnabled, cropTargetSize:{w,h} (final output size, in the reference card's full-resolution pixels) }
  function renderCard(card, options, maxDim) {
    const img = card.img;
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;

    // cardScale resamples this card so its printed content is the same physical pixel
    // size as the reference's — otherwise a card scanned at a slightly different zoom/DPI
    // ends up a different size than everyone else even after rotation+crop line up their edges.
    const cardScale = options.autoScaleEnabled && card.autoScale ? card.autoScale : 1;
    const targetW = naturalW * cardScale;
    const targetH = naturalH * cardScale;
    const previewScale = maxDim ? Math.min(1, maxDim / Math.max(targetW, targetH)) : 1;
    const w = Math.max(1, Math.round(targetW * previewScale));
    const h = Math.max(1, Math.round(targetH * previewScale));

    // Step 1: draw at working resolution (this also applies the scale correction)
    let canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    let ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    // Step 2: color
    if (options.colorEnabled) {
      const imageData = ctx.getImageData(0, 0, w, h);
      const auto = options.autoColorEnabled ? card.autoColorTransform : null;
      ColorAlign.applyToImageData(imageData, auto, options.manualColor || {});
      ctx.putImageData(imageData, 0, 0);
    }

    // Step 3: rotation
    let effectiveAngle = 0;
    if (options.rotationEnabled) {
      const auto = options.autoAngleEnabled ? card.autoAngle || 0 : 0;
      const manual = options.manualRotationDeg || 0;
      const perCard = options.perCardRotationDeg && options.perCardRotationDeg[card.id] || 0;
      effectiveAngle = auto + manual + perCard;
    }
    if (Math.abs(effectiveAngle) > 0.001) {
      const rotated = document.createElement('canvas');
      rotated.width = w;
      rotated.height = h;
      const rctx = rotated.getContext('2d');
      rctx.translate(w / 2, h / 2);
      rctx.rotate((effectiveAngle * Math.PI) / 180);
      rctx.translate(-w / 2, -h / 2);
      rctx.drawImage(canvas, 0, 0);
      canvas = rotated;
      ctx = rctx;
    }

    // Step 4: crop to a fixed output size, centered. Cropping to an explicit target size
    // (rather than trimming the same pixel amount off each edge) keeps every card's final
    // dimensions identical even when a card's own raw canvas size differs slightly from the
    // reference's — which cardScale alone doesn't guarantee, since it only normalizes the
    // printed content's size, not any background margin around it.
    let cw = w, ch = h;
    if (options.cropTargetSize) {
      const targetW = Math.round(options.cropTargetSize.w * previewScale);
      const targetH = Math.round(options.cropTargetSize.h * previewScale);
      cw = Math.min(w, Math.max(1, targetW));
      ch = Math.min(h, Math.max(1, targetH));
    }
    if (cw !== w || ch !== h) {
      const left = Math.round((w - cw) / 2);
      const top = Math.round((h - ch) / 2);
      const cropped = document.createElement('canvas');
      cropped.width = cw;
      cropped.height = ch;
      cropped.getContext('2d').drawImage(canvas, left, top, cw, ch, 0, 0, cw, ch);
      canvas = cropped;
    }

    return canvas;
  }

  return { renderCard, suggestedCrop };
})();
