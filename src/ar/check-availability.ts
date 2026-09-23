/**
 * WebXR / Hit Test の対応可否を判定する（F-001）。
 * webxr-native / threejs のどちらの実装を採用するかによらず必要な、
 * 環境チェックの共通ロジック。
 */
export interface AvailabilityResult {
  available: boolean;
  reason?: string;
}

/** ブラウザのWebXR型定義（@types/webxr等の外部パッケージに依存させないための最小限の宣言） */
interface MinimalXRSystem {
  isSessionSupported(mode: 'immersive-ar' | 'immersive-vr' | 'inline'): Promise<boolean>;
}

export async function checkWebXrAvailability(): Promise<AvailabilityResult> {
  if (!window.isSecureContext) {
    return { available: false, reason: 'HTTPS（セキュアな接続）が必要です。' };
  }

  const xr = (navigator as Navigator & { xr?: MinimalXRSystem }).xr;
  if (!xr) {
    return {
      available: false,
      reason: 'このブラウザはWebXRに対応していません。Android版Google Chromeでお試しください。',
    };
  }

  let supported = false;
  try {
    supported = await xr.isSessionSupported('immersive-ar');
  } catch {
    supported = false;
  }

  if (!supported) {
    return {
      available: false,
      reason:
        'この端末・ブラウザではAR（immersive-ar）がサポートされていません。Google Play開発者サービス（AR）がインストールされているか確認してください。',
    };
  }

  return { available: true };
}
