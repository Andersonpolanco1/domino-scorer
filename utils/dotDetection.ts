/**
 * Domino dot detection using computer vision.
 * Works with dominoes of any color by using relative contrast
 * between dots and tile background (Otsu's thresholding).
 */

export interface DetectionResult {
  totalDots: number;
  tilesFound: number;
  confidence: 'high' | 'medium' | 'low';
  dotCentroids: { x: number; y: number; circularity?: number }[];
  tileGroups: number[][];
}

/**
 * Main detection function.
 * Takes a flat RGBA pixel array (from canvas/image) plus dimensions.
 */
export function detectDominoDotsFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): DetectionResult {
  // Step 1: Convert to grayscale
  const gray = toGrayscale(pixels, width, height);

  // Step 2: Gaussian blur to reduce noise
  const blurred = gaussianBlur(gray, width, height);

  // Step 3: Otsu's threshold - works regardless of domino color
  const threshold = otsuThreshold(blurred);

  // Step 4: Create binary image (dark = dots)
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < blurred.length; i++) {
    binary[i] = blurred[i] < threshold ? 1 : 0;
  }

  // Step 5: Connected components to find dot blobs
  const { labels, componentSizes, nextLabel } = connectedComponents(binary, width, height);

  // Step 6: Filter by area - dots are small circular blobs
  const minArea = Math.max(6, Math.floor(width * height * 0.00004));
  const maxArea = Math.floor(width * height * 0.006);

  const validLabels = new Set<number>();
  for (let l = 1; l < nextLabel; l++) {
    const sz = componentSizes[l];
    if (sz >= minArea && sz <= maxArea) validLabels.add(l);
  }

  if (validLabels.size === 0) {
    return { totalDots: 0, tilesFound: 0, confidence: 'low', dotCentroids: [], tileGroups: [] };
  }

  // Step 7: Compute centroids
  const sums: Record<number, { sx: number; sy: number; n: number }> = {};
  for (const l of validLabels) sums[l] = { sx: 0, sy: 0, n: 0 };

  for (let i = 0; i < width * height; i++) {
    const l = labels[i];
    if (validLabels.has(l)) {
      sums[l].sx += i % width;
      sums[l].sy += Math.floor(i / width);
      sums[l].n++;
    }
  }

  // bounding boxes for circularity estimate
  const bbox: Record<number, { minX: number; maxX: number; minY: number; maxY: number }> = {};
  for (const l of validLabels) bbox[l] = { minX: width, maxX: 0, minY: height, maxY: 0 };
  for (let i = 0; i < width * height; i++) {
    const l = labels[i];
    if (validLabels.has(l)) {
      const x = i % width, y = Math.floor(i / width);
      const b = bbox[l];
      if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
      if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
    }
  }
  const dotCentroids = Array.from(validLabels).map(l => {
    const b = bbox[l];
    const w = (b.maxX - b.minX) + 1, h = (b.maxY - b.minY) + 1;
    const boxArea = w * h;
    // circularity: ratio of blob area to bounding box area (circle ~0.785, square=1, line~low)
    const fill = sums[l].n / boxArea;
    const aspect = Math.min(w, h) / Math.max(w, h);
    const circularity = fill * aspect; // high for round compact blobs
    return { x: sums[l].sx / sums[l].n, y: sums[l].sy / sums[l].n, circularity };
  });

  // Step 7b: Filter by circularity (dots are round; text/edges are not)
  const circularDots = dotCentroids.filter(d => d.circularity > 0.55);
  const finalDots = circularDots.length >= 1 ? circularDots : dotCentroids;

  // Step 8: Group dots into tiles by proximity
  const groupDist = Math.min(width, height) * 0.14;
  const tileGroups = clusterByDistance(finalDots, groupDist);

  // Step 9: Confidence based on dot count and grouping
  const totalDots = finalDots.length;
  let confidence: 'high' | 'medium' | 'low' = 'low';
  if (tileGroups.length >= 1 && totalDots <= 56) confidence = 'medium';
  if (tileGroups.length >= 1 && totalDots >= 2 && totalDots <= 42) confidence = 'high';

  return {
    totalDots,
    tilesFound: tileGroups.length,
    confidence,
    dotCentroids: finalDots,
    tileGroups,
  };
}

function toGrayscale(pixels: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return gray;
}

function gaussianBlur(gray: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  const k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let s = 0;
      let ki = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          s += gray[(y + dy) * width + (x + dx)] * k[ki++];
        }
      }
      out[y * width + x] = Math.round(s / 16);
    }
  }
  return out;
}

function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, max = 0, threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; threshold = i; }
  }
  return threshold;
}

function connectedComponents(
  binary: Uint8Array,
  width: number,
  height: number
): { labels: Int32Array; componentSizes: Record<number, number>; nextLabel: number } {
  const labels = new Int32Array(width * height);
  const componentSizes: Record<number, number> = {};
  let nextLabel = 1;

  function fill(start: number, label: number): number {
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      if (idx < 0 || idx >= width * height) continue;
      if (labels[idx] || !binary[idx]) continue;
      labels[idx] = label;
      size++;
      const x = idx % width;
      const y = Math.floor(idx / width);
      if (x > 0) stack.push(idx - 1);
      if (x < width - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - width);
      if (y < height - 1) stack.push(idx + width);
    }
    return size;
  }

  for (let i = 0; i < width * height; i++) {
    if (binary[i] && !labels[i]) {
      const sz = fill(i, nextLabel);
      componentSizes[nextLabel] = sz;
      nextLabel++;
    }
  }

  return { labels, componentSizes, nextLabel };
}

function clusterByDistance(
  points: { x: number; y: number; circularity?: number }[],
  maxDist: number
): number[][] {
  const used = new Set<number>();
  const groups: number[][] = [];

  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const group: number[] = [i];
    used.add(i);

    // Expand group with BFS
    const queue = [i];
    while (queue.length) {
      const cur = queue.shift()!;
      for (let j = 0; j < points.length; j++) {
        if (used.has(j)) continue;
        const dx = points[cur].x - points[j].x;
        const dy = points[cur].y - points[j].y;
        if (Math.sqrt(dx * dx + dy * dy) < maxDist) {
          group.push(j);
          used.add(j);
          queue.push(j);
        }
      }
    }
    groups.push(group);
  }

  return groups;
}
