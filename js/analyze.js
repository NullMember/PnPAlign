// Card analysis: foreground/background separation, skew angle detection,
// and color statistics — all derived from one downscaled render of the card.

const Analyze = (() => {
  const ANALYZE_MAX_DIM = 500; // downscale target for analysis (speed; angle/stats are scale-invariant)

  function drawDownscaled(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return { canvas, ctx, w, h, scale };
  }

  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, wF = 0, maxVar = 0, threshold = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);
      if (varBetween > maxVar) {
        maxVar = varBetween;
        threshold = t;
      }
    }
    return threshold;
  }

  // Analyzes one card image: returns { angle (deg, correction to apply), colorStats {mean:[r,g,b], std:[r,g,b]}, maskCoverage }
  function analyzeCard(img) {
    const { ctx, w, h } = drawDownscaled(img, ANALYZE_MAX_DIM);
    const data = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const gray = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const g = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
      gray[i] = g;
      hist[g]++;
    }
    const threshold = otsuThreshold(hist, n);

    // Decide whether foreground is darker or lighter than background by sampling the outer border.
    let borderSum = 0, borderCount = 0;
    for (let x = 0; x < w; x++) {
      borderSum += gray[x] + gray[(h - 1) * w + x];
      borderCount += 2;
    }
    for (let y = 0; y < h; y++) {
      borderSum += gray[y * w] + gray[y * w + (w - 1)];
      borderCount += 2;
    }
    const borderMean = borderSum / borderCount;
    const foregroundIsDark = borderMean >= threshold;

    const isFg = (v) => (foregroundIsDark ? v < threshold : v >= threshold);

    // Boundary/silhouette points: per-row min/max x, per-column min/max y where foreground.
    const points = [];
    for (let y = 0; y < h; y++) {
      let minX = -1, maxX = -1;
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        if (isFg(gray[rowOff + x])) {
          if (minX === -1) minX = x;
          maxX = x;
        }
      }
      if (minX !== -1) {
        points.push({ x: minX, y });
        if (maxX !== minX) points.push({ x: maxX, y });
      }
    }
    for (let x = 0; x < w; x++) {
      let minY = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        if (isFg(gray[y * w + x])) {
          if (minY === -1) minY = y;
          maxY = y;
        }
      }
      if (minY !== -1) {
        points.push({ x, y: minY });
        if (maxY !== minY) points.push({ x, y: maxY });
      }
    }

    let angle = 0;
    let maskCoverage = 0;
    let fgCount = 0;
    for (let i = 0; i < n; i++) if (isFg(gray[i])) fgCount++;
    maskCoverage = fgCount / n;

    if (points.length >= 3 && maskCoverage > 0.02 && maskCoverage < 0.98) {
      const rect = Geometry.minAreaRect(points);
      const rectAngleDeg = (rect.angle * 180) / Math.PI;
      const normalized = Geometry.normalizeAngleDeg(rectAngleDeg);
      angle = -normalized; // rotate image by this much to level the card
    }

    // Color stats over the foreground mask only (falls back to whole image if mask is degenerate).
    const useMask = maskCoverage > 0.02 && maskCoverage < 0.98;
    let rs = 0, gs = 0, bs = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      if (useMask && !isFg(gray[i])) continue;
      const o = i * 4;
      rs += data[o]; gs += data[o + 1]; bs += data[o + 2];
      cnt++;
    }
    if (cnt === 0) cnt = 1;
    const mean = [rs / cnt, gs / cnt, bs / cnt];
    let rv = 0, gv = 0, bv = 0;
    for (let i = 0; i < n; i++) {
      if (useMask && !isFg(gray[i])) continue;
      const o = i * 4;
      rv += (data[o] - mean[0]) ** 2;
      gv += (data[o + 1] - mean[1]) ** 2;
      bv += (data[o + 2] - mean[2]) ** 2;
    }
    const std = [Math.sqrt(rv / cnt), Math.sqrt(gv / cnt), Math.sqrt(bv / cnt)];

    return {
      angle,
      colorStats: { mean, std },
      maskCoverage,
      maskReliable: useMask,
    };
  }

  return { analyzeCard };
})();
