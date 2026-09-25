/** 長辺が longSidePx を超える場合だけ、縦横比を保って縮小したサイズを返す（拡大はしない）。 */
export function computeTargetSize(
  width: number,
  height: number,
  longSidePx: number,
): { width: number; height: number } {
  const longSide = Math.max(width, height);
  if (longSide <= longSidePx) return { width, height };
  const scale = longSidePx / longSide;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
