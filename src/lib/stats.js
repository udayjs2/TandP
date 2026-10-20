// Small statistics helpers for the analytics reports.
export const linearFit = (ys) => {
  const n = ys.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0, r2: 0 };
  const xs = ys.map((_, i) => i);
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  ys.forEach((y, i) => { sxy += (xs[i] - mx) * (y - my); sxx += (xs[i] - mx) ** 2; syy += (y - my) ** 2; });
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
};
export const movingAvg = (ys, w = 3) => ys.map((_, i) => {
  const part = ys.slice(Math.max(0, i - w + 1), i + 1);
  return part.reduce((a, b) => a + b, 0) / part.length;
});
// next `k` values continuing the straight-line trend (never below 0 when floor0)
export const projectLinear = (ys, k, floor0 = false) => {
  const { slope, intercept } = linearFit(ys);
  return Array.from({ length: k }, (_, j) => {
    const v = intercept + slope * (ys.length + j);
    return floor0 ? Math.max(0, v) : v;
  });
};
