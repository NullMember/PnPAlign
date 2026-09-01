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
  // card: { img, autoColorTransform, autoAngle }
  // options: { colorEnabled, manualColor, rotationEnabled, autoAngleEnabled, manualRotationDeg, perCardRotationDeg, crop:{top,right,bottom,left}, cropIsForMaxDim (the width/height the crop values were computed against) }
  function renderCard(card, options, maxDim) {
    const img = card.img;
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    const scale = maxDim ? Math.min(1, maxDim / Math.max(naturalW, naturalH)) : 1;
    const w = Math.max(1, Math.round(naturalW * scale));
    const h = Math.max(1, Math.round(naturalH * scale));

    // Step 1: draw at working resolution
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

    // Step 4: crop (crop values are defined against options.cropRefDim = {w,h}; scale to this render's resolution)
    let crop = options.crop || { top: 0, right: 0, bottom: 0, left: 0 };
    if (options.cropRefDim) {
      const sx = w / options.cropRefDim.w;
      const sy = h / options.cropRefDim.h;
      crop = {
        top: Math.round(crop.top * sy),
        bottom: Math.round(crop.bottom * sy),
        left: Math.round(crop.left * sx),
        right: Math.round(crop.right * sx),
      };
    }
    const cw = Math.max(1, w - crop.left - crop.right);
    const ch = Math.max(1, h - crop.top - crop.bottom);
    if (crop.top || crop.bottom || crop.left || crop.right) {
      const cropped = document.createElement('canvas');
      cropped.width = cw;
      cropped.height = ch;
      const cctx = cropped.getContext('2d');
      cctx.drawImage(canvas, crop.left, crop.top, cw, ch, 0, 0, cw, ch);
      canvas = cropped;
    }

    return canvas;
  }

  return { renderCard, suggestedCrop };
})();
