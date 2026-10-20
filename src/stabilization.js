// Small rigid-motion estimator. Coordinates map a reference image into the
// current image. Only translation and rotation are fitted; no scale or shear.
export const identity = () => ({ a: 1, b: 0, x: 0, y: 0 });

function shrink(image) {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = 2 * y * image.width + 2 * x;
      pixels[y * width + x] =
        (image.pixels[i] +
          image.pixels[i + 1] +
          image.pixels[i + image.width] +
          image.pixels[i + image.width + 1]) /
        4;
    }
  }
  return { pixels, width, height };
}

function patch(image, x, y, radius) {
  x = Math.round(x);
  y = Math.round(y);
  if (
    x < radius ||
    y < radius ||
    x >= image.width - radius ||
    y >= image.height - radius
  )
    return null;
  const values = [];
  let sum = 0,
    squares = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const value = image.pixels[(y + dy) * image.width + x + dx];
      values.push(value);
      sum += value;
      squares += value * value;
    }
  }
  const mean = sum / values.length;
  const energy = squares - sum * mean;
  if (energy / values.length < 6) return null;
  return { values: values.map((v) => v - mean), energy, radius };
}

function search(image, template, px, py, radius) {
  if (!template) return null;
  const r = template.radius,
    n = template.values.length;
  let best = null;
  for (
    let y = Math.max(r, Math.round(py) - radius);
    y <= Math.min(image.height - r - 1, Math.round(py) + radius);
    y++
  ) {
    for (
      let x = Math.max(r, Math.round(px) - radius);
      x <= Math.min(image.width - r - 1, Math.round(px) + radius);
      x++
    ) {
      let sum = 0,
        squares = 0,
        dot = 0,
        k = 0;
      for (let dy = -r; dy <= r; dy++) {
        let index = (y + dy) * image.width + x - r;
        for (let dx = -r; dx <= r; dx++) {
          const value = image.pixels[index++];
          sum += value;
          squares += value * value;
          dot += template.values[k++] * value;
        }
      }
      const energy = squares - (sum * sum) / n;
      if (energy < n * 6) continue;
      const score = dot / Math.sqrt(energy * template.energy);
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  return best;
}

function features(image) {
  const candidates = [],
    { pixels: p, width: w, height: h } = image;
  for (let y = 10; y < h - 10; y += 2) {
    for (let x = 10; x < w - 10; x += 2) {
      let xx = 0,
        yy = 0,
        xy = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const i = (y + dy) * w + x + dx;
          const gx = (p[i + 1] - p[i - 1]) / 2;
          const gy = (p[i + w] - p[i - w]) / 2;
          xx += gx * gx;
          yy += gy * gy;
          xy += gx * gy;
        }
      }
      const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 2;
      if (score > 50) candidates.push({ x, y, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = [];
  for (const candidate of candidates) {
    if (
      chosen.every(
        (p) => Math.hypot(p.x - candidate.x, p.y - candidate.y) >= 14,
      )
    )
      chosen.push(candidate);
    if (chosen.length === 100) break;
  }
  return chosen;
}

function fit(points) {
  const n = points.length;
  const center = points.reduce(
    (c, p) => [
      c[0] + p.x / n,
      c[1] + p.y / n,
      c[2] + p.qx / n,
      c[3] + p.qy / n,
    ],
    [0, 0, 0, 0],
  );
  let dot = 0,
    cross = 0;
  for (const p of points) {
    const x = p.x - center[0],
      y = p.y - center[1];
    const qx = p.qx - center[2],
      qy = p.qy - center[3];
    dot += x * qx + y * qy;
    cross += x * qy - y * qx;
  }
  const angle = Math.atan2(cross, dot),
    a = Math.cos(angle),
    b = Math.sin(angle);
  return {
    a,
    b,
    x: center[2] - a * center[0] + b * center[1],
    y: center[3] - b * center[0] - a * center[1],
  };
}

export function robustMotion(points) {
  if (points.length < 6) return null;
  let best = [];
  // Deterministic RANSAC rejects clouds, changing aurora and ambiguous matches.
  for (let i = 0; i < points.length; i++) {
    for (
      let j = i + 1;
      j < points.length;
      j += Math.max(1, Math.floor(points.length / 12))
    ) {
      const pair = [points[i], points[j]];
      if (Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) < 30)
        continue;
      const m = fit(pair);
      if (Math.abs(Math.atan2(m.b, m.a)) > Math.PI / 12) continue;
      const inliers = points.filter(
        (p) =>
          Math.hypot(
            m.a * p.x - m.b * p.y + m.x - p.qx,
            m.b * p.x + m.a * p.y + m.y - p.qy,
          ) < 2,
      );
      if (inliers.length > best.length) best = inliers;
    }
  }
  if (best.length < Math.max(6, points.length * 0.45)) return null;
  const xs = best.map((p) => p.x),
    ys = best.map((p) => p.y);
  if (
    Math.max(...xs) - Math.min(...xs) < 40 ||
    Math.max(...ys) - Math.min(...ys) < 30
  )
    return null;
  return fit(best);
}

export class Stabilizer {
  constructor(reference) {
    this.reference = reference;
    this.coarse = shrink(reference);
    this.points = features(reference).map((p) => ({
      ...p,
      full: patch(reference, p.x, p.y, 7),
      coarse: patch(this.coarse, p.x / 2, p.y / 2, 5),
    }));
    this.previous = identity();
  }
  align(current) {
    const coarse = shrink(current),
      matches = [];
    const m = this.previous;
    for (const p of this.points) {
      const px = m.a * p.x - m.b * p.y + m.x;
      const py = m.b * p.x + m.a * p.y + m.y;
      const rough = search(coarse, p.coarse, px / 2, py / 2, 14);
      if (!rough || rough.score < 0.72) continue;
      const fine = search(current, p.full, rough.x * 2, rough.y * 2, 3);
      if (!fine || fine.score < 0.8) continue;
      matches.push({ x: p.x, y: p.y, qx: fine.x, qy: fine.y });
    }
    const motion = robustMotion(matches);
    if (!motion) return null;
    this.previous = motion;
    return motion;
  }
}

// Crop in reference coordinates; guarantee each output corner is inside every
// accepted source frame. Use one fixed crop for the whole clip (no zoom pumping).
export function cropZoom(motions, width, height) {
  let zoom = 1.04;
  for (const m of motions) {
    for (const x of [-width / 2, width / 2]) {
      for (const y of [-height / 2, height / 2]) {
        const cx = (m.a * width) / 2 - (m.b * height) / 2 + m.x;
        const cy = (m.b * width) / 2 + (m.a * height) / 2 + m.y;
        const dx = m.a * x - m.b * y,
          dy = m.b * x + m.a * y;
        const roomX = dx >= 0 ? width - 2 - cx : cx - 2;
        const roomY = dy >= 0 ? height - 2 - cy : cy - 2;
        if (roomX <= 0 || roomY <= 0) return Infinity;
        zoom = Math.max(zoom, Math.abs(dx) / roomX, Math.abs(dy) / roomY);
      }
    }
  }
  return zoom;
}

// Preserve the sequence even when individual estimates are missing. Interpolate
// between reliable neighbors and use the nearest estimate at either end.
export function completeMotions(samples, width, height, referenceIndex = 0) {
  const reliable = samples.map((motion) => {
    if (
      !motion ||
      ![motion.a, motion.b, motion.x, motion.y].every(Number.isFinite)
    )
      return null;
    return cropZoom([motion], width, height) <= 1.6 ? motion : null;
  });
  const indices = reliable.flatMap((motion, index) => (motion ? [index] : []));
  const aligned = indices.filter((index) => index !== referenceIndex).length;
  if (!aligned) return { motions: null, zoom: 1, aligned: 0 };
  let next = 0;
  const motions = reliable.map((motion, index) => {
    if (motion) return motion;
    while (next < indices.length && indices[next] < index) next++;
    const left = indices[Math.max(0, next - 1)];
    const right = indices[Math.min(indices.length - 1, next)];
    const t =
      right === left
        ? 0
        : Math.max(0, Math.min(1, (index - left) / (right - left)));
    const a = reliable[left],
      b = reliable[right];
    const angleA = Math.atan2(a.b, a.a),
      angleB = Math.atan2(b.b, b.a);
    const delta = Math.atan2(
      Math.sin(angleB - angleA),
      Math.cos(angleB - angleA),
    );
    const angle = angleA + delta * t;
    return {
      a: Math.cos(angle),
      b: Math.sin(angle),
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  });
  let zoom = cropZoom(motions, width, height);
  // Limit correction strength if interpolated rotation would expose an edge.
  if (zoom > 1.6) {
    let low = 0,
      high = 1;
    const damp = (strength) =>
      motions.map((m) => {
        const angle = Math.atan2(m.b, m.a) * strength;
        return {
          a: Math.cos(angle),
          b: Math.sin(angle),
          x: m.x * strength,
          y: m.y * strength,
        };
      });
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      if (cropZoom(damp(mid), width, height) <= 1.6) low = mid;
      else high = mid;
    }
    const limited = damp(low);
    zoom = cropZoom(limited, width, height);
    return { motions: limited, zoom, aligned };
  }
  return { motions, zoom, aligned };
}
