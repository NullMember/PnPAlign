// Full per-card render pipeline: color -> rotation -> position -> crop, at any target resolution.

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
  // card: { img, autoColorTransform, autoAngle, autoScale, autoOffset }
  // options: { colorEnabled, manualColor, rotationEnabled, autoAngleEnabled, manualRotationDeg, perCardRotationDeg,
  //            autoScaleEnabled, autoPositionEnabled, crop:{top,right,bottom,left} (pixel amounts to trim,
  //            in the reference card's full-resolution pixels, anchored at that exact offset on every card) }
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

    // Step 4: position (translation) alignment. Rotation/scale line up the card's size and
    // skew, but the printed content can still sit in a different spot within the frame from
    // scan to scan; this shifts the card so its content lands where the reference's does, so
    // the anchored crop below (step 5) removes the same content on every card.
    if (options.autoPositionEnabled && card.autoOffset) {
      const dx = Math.round(card.autoOffset.dx * previewScale);
      const dy = Math.round(card.autoOffset.dy * previewScale);
      if (dx !== 0 || dy !== 0) {
        const shifted = document.createElement('canvas');
        shifted.width = w;
        shifted.height = h;
        shifted.getContext('2d').drawImage(canvas, dx, dy);
        canvas = shifted;
      }
    }

    // Step 5: crop, anchored at an explicit (left, top) offset rather than re-centered. Once
    // position alignment (step 4) has already lined every card's content up with the
    // reference's, the same absolute pixel amounts should come off the same edges on every
    // card — a center-crop would instead remove equal amounts from opposite edges regardless
    // of which edge position-alignment actually left a blank margin on, wasting real content
    // to reach the same safety margin. Falls back to clamping (not re-centering) if a card's
    // own working canvas is smaller than the crop window calls for — cardScale only
    // normalizes the printed content's size, not any background margin around it, so a card
    // that needed a lot of scale-down correction can still end up with less canvas to spare
    // than the reference; that card's final size will be smaller than the rest as a result.
    let cw = w, ch = h, left = 0, top = 0;
    if (options.crop) {
      const cropLeft = Math.round(options.crop.left * previewScale);
      const cropTop = Math.round(options.crop.top * previewScale);
      const cropRight = Math.round(options.crop.right * previewScale);
      const cropBottom = Math.round(options.crop.bottom * previewScale);
      left = cropLeft;
      top = cropTop;
      cw = Math.max(1, w - cropLeft - cropRight);
      ch = Math.max(1, h - cropTop - cropBottom);
      if (left + cw > w) left = Math.max(0, w - cw);
      if (top + ch > h) top = Math.max(0, h - ch);
      cw = Math.min(cw, w - left);
      ch = Math.min(ch, h - top);
    }
    if (cw !== w || ch !== h || left !== 0 || top !== 0) {
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
