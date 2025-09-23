/*
 * gridVirtualization.js (Phase 1.1 scaffolding)
 * Utility helpers for row-based virtualization of a justified photo grid.
 * Core logic to be filled in Phase 1.2.
 */

/**
 * Compute display aspect ratios for photos using best-effort metadata fields.
 * Returns an array of ratios aligned with input order.
 */
export function computeAspectRatios(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return [];
  return photos.map((p) => {
    const md = p?.metadata || {};
    const w = md.exif_image_width || md.ExifImageWidth || md.ImageWidth || md.width || md.PixelXDimension;
    const h = md.exif_image_height || md.ExifImageHeight || md.ImageHeight || md.height || md.PixelYDimension;
    let r = 3 / 2; // default 1.5
    if (w && h && w > 0 && h > 0) {
      const ori = md.orientation || md.Orientation;
      if (ori === 6 || ori === 8) r = h / w; else r = w / h;
    }
    return Math.max(0.3, Math.min(3.5, r));
  });
}

/**
 * Build justified rows that aim to fill container width by scaling a target height.
 * Returns an array of rows; each row is array of { idx, w, h }.
 */
export function buildJustifiedRows({ containerWidth, targetRowH, gap, ratios }) {
  if (!containerWidth || !ratios || ratios.length === 0) return [];
  const rowsOut = [];
  let row = [];
  let sumR = 0;
  const maxRowH = targetRowH * 1.4;
  const minRowH = targetRowH * 0.7;
  const usableWidth = containerWidth;
  for (let i = 0; i < ratios.length; i++) {
    const r = ratios[i] || 1.5;
    row.push({ idx: i, r });
    sumR += r;
    const totalGaps = (row.length - 1) * gap;
    const rowWidthAtTarget = sumR * targetRowH + totalGaps;
    if (rowWidthAtTarget >= usableWidth || i === ratios.length - 1) {
      let h = (usableWidth - totalGaps) / sumR;
      h = Math.max(minRowH, Math.min(maxRowH, h));
      const rowItems = row.map((it) => ({ idx: it.idx, w: Math.round(it.r * h), h }));
      rowsOut.push(rowItems);
      row = [];
      sumR = 0;
    }
  }
  return rowsOut;
}

/**
 * Compute cumulative heights (prefix sum) of rows including row gaps. Used to fast-map scrollY to row index.
 */
export function computeCumulativeHeights(rows, rowGap = 0) {
  const cum = [0];
  let acc = 0;
  for (let i = 0; i < rows.length; i++) {
    const rh = rows[i]?.[0]?.h || 0;
    acc += rh;
    if (i < rows.length - 1) acc += rowGap;
    cum.push(acc);
  }
  return cum; // length = rows.length + 1, cum[i] is offsetTop of row i
}

/**
 * Given scrollTop, viewportHeight, and cumulativeHeights, return [startRow, endRow] inclusive range to render.
 * Overscan adds extra rows above and below.
 */
export function getVisibleRowRange({ scrollTop, viewportHeight, cumulativeHeights, overscan = 2 }) {
  const total = cumulativeHeights[cumulativeHeights.length - 1] || 0;
  const startY = Math.max(0, scrollTop - 1);
  const endY = Math.min(total, scrollTop + viewportHeight + 1);

  // Binary search helpers
  const lowerBound = (arr, x) => {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] < x) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const startRow = Math.max(0, lowerBound(cumulativeHeights, startY) - 1 - overscan);
  const endRow = Math.min(cumulativeHeights.length - 2, lowerBound(cumulativeHeights, endY) + overscan);
  return [startRow, endRow];
}
