import { computeTargetSize } from './image-size';

export interface ProcessingOptions {
  longSidePx: number;
  /** WebPの品質(0〜1) */
  quality: number;
}

export interface ProcessedImage {
  blob: Blob;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

/**
 * 解析用に、縮小・グレースケール化してWebPに圧縮する。人が見て判別できなくても、
 * 辺や角の位置が読み取れればよい(要件定義書10章)。元画像は保持しない。
 * EXIFは再エンコードで失われるため、呼び出し側で必要な値(焦点距離・元サイズ等)を別に保存する。
 */
export async function processToAnalysisImage(
  source: ImageBitmap,
  options: ProcessingOptions,
): Promise<ProcessedImage> {
  const originalWidth = source.width;
  const originalHeight = source.height;
  const { width, height } = computeTargetSize(originalWidth, originalHeight, options.longSidePx);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2Dコンテキストを取得できませんでした');
  ctx.drawImage(source, 0, 0, width, height);

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画像の圧縮に失敗しました'))),
      'image/webp',
      options.quality,
    );
  });
  return { blob, width, height, originalWidth, originalHeight };
}
