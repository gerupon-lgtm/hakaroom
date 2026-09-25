export const PHOTO_TOTAL_CAP_BYTES = 200 * 1024 * 1024;

export interface PhotoMeta {
  id: string;
  capturedAt: string;
  byteSize: number;
}

/** 合計が capBytes 以下になるまで、撮影日時の古い写真から削除対象のIDを返す。 */
export function selectPhotosToEvict(photos: PhotoMeta[], capBytes: number): string[] {
  let total = photos.reduce((sum, p) => sum + p.byteSize, 0);
  const oldestFirst = [...photos].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const evict: string[] = [];
  for (const photo of oldestFirst) {
    if (total <= capBytes) break;
    evict.push(photo.id);
    total -= photo.byteSize;
  }
  return evict;
}
