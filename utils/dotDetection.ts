/**
 * Domino dot detection — computer vision, 100% offline.
 * Works on iOS and Android via React Native.
 *
 * FIXES vs original:
 *  1. decodeToPixels was reading raw JPEG-compressed bytes as pixels (wrong).
 *     Now uses a WebView canvas approach (see CameraScreen) to get real RGBA data.
 *  2. clusterByDistance maxDist was too large, merging two adjacent tiles into one.
 *     Now uses a tighter default (7% of the shorter dimension) and splits
 *     groups that are suspiciously large into sub-tiles.
 */

export interface DetectionResult {
  totalDots: number;
  tilesFound: number;
  confidence: "high" | "medium" | "low";
  dotCentroids: { x: number; y: number; circularity?: number }[];
  tileGroups: number[][];
}

/**
 * Main detection function.
 * Receives a flat RGBA Uint8ClampedArray decoded by a real canvas (not raw JPEG bytes).
 */
export function detectDominoDotsFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): DetectionResult {
  // 1. Grayscale
  const gray = toGrayscale(pixels, width, height);

  // 2. Gaussian blur (5×5 — more noise reduction than original 3×3)
  const blurred = gaussianBlur5(gray, width, height);

  // 3. Otsu threshold
  const threshold = otsuThreshold(blurred);

  // 4. Binary: dark pixels = 1
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < blurred.length; i++) {
    binary[i] = blurred[i] < threshold ? 1 : 0;
  }

  // 5. Connected components
  const { labels, componentSizes, nextLabel } = connectedComponents(
    binary,
    width,
    height,
  );

  // 6. Filter blobs by area
  //    Dots on a domino tile are small — typically 0.005%–0.4% of image area
  const imageArea = width * height;
  const minArea = Math.max(8, Math.floor(imageArea * 0.00005));
  const maxArea = Math.floor(imageArea * 0.004); // ← tighter upper bound (was 0.006)

  const validLabels = new Set<number>();
  for (let l = 1; l < nextLabel; l++) {
    const sz = componentSizes[l];
    if (sz >= minArea && sz <= maxArea) validLabels.add(l);
  }

  if (validLabels.size === 0) {
    return {
      totalDots: 0,
      tilesFound: 0,
      confidence: "low",
      dotCentroids: [],
      tileGroups: [],
    };
  }

  // 7. Centroids + bounding boxes → circularity
  const sums: Record<number, { sx: number; sy: number; n: number }> = {};
  for (const l of validLabels) sums[l] = { sx: 0, sy: 0, n: 0 };

  const bbox: Record<
    number,
    { minX: number; maxX: number; minY: number; maxY: number }
  > = {};
  for (const l of validLabels)
    bbox[l] = { minX: width, maxX: 0, minY: height, maxY: 0 };

  for (let i = 0; i < width * height; i++) {
    const l = labels[i];
    if (!validLabels.has(l)) continue;
    const x = i % width;
    const y = Math.floor(i / width);
    sums[l].sx += x;
    sums[l].sy += y;
    sums[l].n++;
    const b = bbox[l];
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }

  const dotCentroids = Array.from(validLabels).map((l) => {
    const b = bbox[l];
    const bw = b.maxX - b.minX + 1;
    const bh = b.maxY - b.minY + 1;
    const fill = sums[l].n / (bw * bh);
    const aspect = Math.min(bw, bh) / Math.max(bw, bh);
    return {
      x: sums[l].sx / sums[l].n,
      y: sums[l].sy / sums[l].n,
      circularity: fill * aspect,
    };
  });

  // 8. Circularity filter — keep round blobs (dots), reject lines/edges/text
  //    Lowered threshold slightly (0.45) to handle worn/blurry dots
  const circularDots = dotCentroids.filter((d) => (d.circularity ?? 0) > 0.45);
  const finalDots = circularDots.length >= 1 ? circularDots : dotCentroids;

  // 9. Cluster into tiles — FIXED: use 7% of shorter dimension
  //    Old: width * 0.14  → ~98px for 700px wide — too large, merges two tiles
  //    New: shorter side * 0.07 → ~35–50px typically — keeps tiles separate
  const shortSide = Math.min(width, height);
  const groupDist = shortSide * 0.07;
  const rawGroups = clusterByDistance(finalDots, groupDist);

  // 10. Post-process groups: a single domino has at most 6 dots per half (12 total).
  //     If a group has >12 dots, split it — likely two tiles were merged.
  const tileGroups = splitLargeGroups(rawGroups, finalDots, 12);

  // 11. Confidence
  const totalDots = finalDots.length;
  let confidence: "high" | "medium" | "low" = "low";
  if (tileGroups.length >= 1 && totalDots <= 56) confidence = "medium";
  if (tileGroups.length >= 1 && totalDots >= 2 && totalDots <= 42)
    confidence = "high";

  return {
    totalDots,
    tilesFound: tileGroups.length,
    confidence,
    dotCentroids: finalDots,
    tileGroups,
  };
}

// ─── Image processing helpers ────────────────────────────────────────────────

function toGrayscale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = Math.round(
      0.299 * pixels[i * 4] +
        0.587 * pixels[i * 4 + 1] +
        0.114 * pixels[i * 4 + 2],
    );
  }
  return gray;
}

/** 5×5 Gaussian blur — better noise reduction than 3×3 for real camera images */
function gaussianBlur5(
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const k = [
    2, 4, 5, 4, 2, 4, 9, 12, 9, 4, 5, 12, 15, 12, 5, 4, 9, 12, 9, 4, 2, 4, 5, 4,
    2,
  ];
  const kSum = 159;
  const out = new Uint8Array(width * height);
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let s = 0,
        ki = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          s += gray[(y + dy) * width + (x + dx)] * k[ki++];
        }
      }
      out[y * width + x] = Math.round(s / kSum);
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
  let sumB = 0,
    wB = 0,
    max = 0,
    threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB,
      mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = i;
    }
  }
  return threshold;
}

function connectedComponents(
  binary: Uint8Array,
  width: number,
  height: number,
) {
  const labels = new Int32Array(width * height);
  const componentSizes: Record<number, number> = {};
  let nextLabel = 1;

  function fill(start: number, label: number): number {
    const stack = [start];
    let size = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      if (idx < 0 || idx >= width * height || labels[idx] || !binary[idx])
        continue;
      labels[idx] = label;
      size++;
      const x = idx % width,
        y = Math.floor(idx / width);
      if (x > 0) stack.push(idx - 1);
      if (x < width - 1) stack.push(idx + 1);
      if (y > 0) stack.push(idx - width);
      if (y < height - 1) stack.push(idx + width);
    }
    return size;
  }

  for (let i = 0; i < width * height; i++) {
    if (binary[i] && !labels[i]) {
      componentSizes[nextLabel] = fill(i, nextLabel);
      nextLabel++;
    }
  }
  return { labels, componentSizes, nextLabel };
}

function clusterByDistance(
  points: { x: number; y: number }[],
  maxDist: number,
): number[][] {
  const used = new Set<number>();
  const groups: number[][] = [];
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    const group: number[] = [i];
    used.add(i);
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

/**
 * If a cluster has more dots than maxDotsPerTile, split it into sub-tiles
 * using a simple median-cut on the longest axis.
 */
function splitLargeGroups(
  groups: number[][],
  points: { x: number; y: number }[],
  maxDotsPerTile: number,
): number[][] {
  const result: number[][] = [];
  for (const group of groups) {
    if (group.length <= maxDotsPerTile) {
      result.push(group);
      continue;
    }
    // Find bounding box of group
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const idx of group) {
      const p = points[idx];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const spanX = maxX - minX,
      spanY = maxY - minY;
    // Split on the longer axis at the median
    const axis: "x" | "y" = spanX >= spanY ? "x" : "y";
    const sorted = [...group].sort((a, b) => points[a][axis] - points[b][axis]);
    const mid = Math.floor(sorted.length / 2);
    result.push(sorted.slice(0, mid));
    result.push(sorted.slice(mid));
  }
  return result;
}
