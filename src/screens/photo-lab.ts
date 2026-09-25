import { processToAnalysisImage } from '../photo/process-image';
import { TiltSensor } from '../photo/tilt-sensor';
import { PHOTO_TOTAL_CAP_BYTES } from '../storage/photo-eviction';
import { deletePhoto, listPhotos, requestPersistence, savePhoto } from '../storage/photo-store';
import type { PhotoRecord } from '../types';

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}

/**
 * 技術検証D（写真方式）の第1段階: アプリ内撮影（傾きセンサー値の記録）と保存、ギャラリー取り込み。
 * 傾きセンサーがこの端末・ブラウザで十分に取れるかが写真方式の継続可否の鍵のため、
 * 生値・仰角・ロール・ばらつきをライブで表示する。補正・寸法計算は次の段階で追加する。
 */
export function renderPhotoLab(container: HTMLElement): void {
  container.innerHTML = `
    <section class="photo-lab">
      <h2>技術検証D: 写真方式（撮影・傾きセンサー）</h2>
      <p class="note">写真は解析用に縮小・グレースケール化して端末内(IndexedDB)に保存します。元画像は保存せず、サーバーへも送信しません。</p>
      <div class="photo-settings">
        <label>長辺(px)
          <select id="pl-longside">
            <option value="1024">1024</option>
            <option value="1600" selected>1600</option>
            <option value="2400">2400</option>
          </select>
        </label>
        <label>品質
          <select id="pl-quality">
            <option value="0.5">0.5</option>
            <option value="0.6" selected>0.6</option>
            <option value="0.8">0.8</option>
          </select>
        </label>
        <label>焦点距離(35mm換算・任意)
          <input id="pl-focal" type="text" inputmode="decimal" placeholder="例: 26" />
        </label>
      </div>
      <div class="photo-actions">
        <button type="button" id="pl-camera-toggle">カメラ起動</button>
        <button type="button" id="pl-capture" disabled>撮影</button>
        <label class="file-button">ギャラリーから取り込み<input id="pl-import" type="file" accept="image/*" multiple hidden /></label>
      </div>
      <video id="pl-video" class="photo-video" playsinline muted hidden></video>
      <pre id="pl-sensor" class="photo-sensor">傾きセンサー: 未取得（カメラ起動で開始）</pre>
      <p id="pl-message" class="note"></p>
      <div id="pl-summary" class="note"></div>
      <div id="pl-list" class="photo-list"></div>
    </section>
  `;

  const $ = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const video = $<HTMLVideoElement>('pl-video');
  const cameraToggle = $<HTMLButtonElement>('pl-camera-toggle');
  const captureButton = $<HTMLButtonElement>('pl-capture');
  const importInput = $<HTMLInputElement>('pl-import');
  const sensorEl = $<HTMLElement>('pl-sensor');
  const messageEl = $<HTMLElement>('pl-message');

  const sensor = new TiltSensor();
  let stream: MediaStream | null = null;
  let sensorTimer: number | null = null;
  let thumbUrls: string[] = [];

  const readOptions = () => ({
    longSidePx: Number.parseInt($<HTMLSelectElement>('pl-longside').value, 10),
    quality: Number.parseFloat($<HTMLSelectElement>('pl-quality').value),
  });
  const readFocal = (): number | null => {
    const v = Number.parseFloat($<HTMLInputElement>('pl-focal').value);
    return Number.isNaN(v) ? null : v;
  };

  function renderSensor(): void {
    const raw = sensor.raw;
    const cur = sensor.current();
    if (!raw || !cur) {
      sensorEl.textContent = '傾きセンサー: イベント未受信（センサー非対応、または権限が無い可能性）';
      return;
    }
    const snap = sensor.snapshot();
    sensorEl.textContent =
      `生値 ax=${raw.ax.toFixed(2)} ay=${raw.ay.toFixed(2)} az=${raw.az.toFixed(2)} (m/s²)\n` +
      `仰角 ${cur.elevationDeg.toFixed(1)}°（真下=-90 / 水平=0）  ロール ${cur.rollDeg.toFixed(1)}°\n` +
      `直近${snap?.sampleCount ?? 0}サンプルの仰角ばらつき(σ) ${snap ? snap.elevationStdDevDeg.toFixed(2) : '-'}°`;
  }

  async function startCamera(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 4032 }, height: { ideal: 3024 } },
        audio: false,
      });
    } catch (error) {
      messageEl.textContent = `カメラを起動できませんでした: ${(error as Error).message}`;
      return;
    }
    video.srcObject = stream;
    video.hidden = false;
    await video.play().catch(() => undefined);
    sensor.start();
    sensorTimer = window.setInterval(renderSensor, 200);
    captureButton.disabled = false;
    cameraToggle.textContent = 'カメラ停止';
    messageEl.textContent = '';
  }

  function stopCamera(): void {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    video.hidden = true;
    sensor.stop();
    if (sensorTimer !== null) window.clearInterval(sensorTimer);
    sensorTimer = null;
    captureButton.disabled = true;
    cameraToggle.textContent = 'カメラ起動';
  }

  async function grabFrame(): Promise<ImageBitmap> {
    const track = stream?.getVideoTracks()[0];
    const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike })
      .ImageCapture;
    if (track && ImageCaptureCtor) {
      try {
        return await createImageBitmap(await new ImageCaptureCtor(track).takePhoto());
      } catch {
        // takePhoto非対応・失敗時は動画フレームで代替する
      }
    }
    return createImageBitmap(video);
  }

  async function store(source: ImageBitmap, kind: PhotoRecord['source'], tilt: PhotoRecord['tilt']): Promise<void> {
    const options = readOptions();
    const processed = await processToAnalysisImage(source, options);
    const record: PhotoRecord = {
      id: crypto.randomUUID(),
      blob: processed.blob,
      source: kind,
      width: processed.width,
      height: processed.height,
      originalWidth: processed.originalWidth,
      originalHeight: processed.originalHeight,
      focalLength35mm: readFocal(),
      tilt,
      capturedAt: new Date().toISOString(),
      processing: { longSidePx: options.longSidePx, quality: options.quality, grayscale: true },
      byteSize: processed.blob.size,
    };
    const evicted = await savePhoto(record);
    if (evicted.length > 0) messageEl.textContent = `上限超過のため古い写真${evicted.length}枚を削除しました`;
  }

  captureButton.addEventListener('click', () => {
    const snapshot = sensor.snapshot(); // シャッターを押した瞬間の傾きを先に確保する
    const tilt = snapshot ? { ...snapshot, screenAngleDeg: screen.orientation?.angle ?? 0 } : null;
    captureButton.disabled = true;
    void (async () => {
      try {
        await store(await grabFrame(), 'in-app-camera', tilt);
        messageEl.textContent = tilt ? '' : '保存しました（傾きセンサー値は取得できませんでした）';
      } catch (error) {
        messageEl.textContent = `撮影に失敗しました: ${(error as Error).message}`;
      } finally {
        captureButton.disabled = stream === null;
        await refreshList();
      }
    })();
  });

  cameraToggle.addEventListener('click', () => {
    if (stream) stopCamera();
    else void startCamera();
  });

  importInput.addEventListener('change', () => {
    const files = Array.from(importInput.files ?? []);
    void (async () => {
      for (const file of files) {
        try {
          await store(await createImageBitmap(file), 'gallery', null);
        } catch (error) {
          messageEl.textContent = `取り込みに失敗しました(${file.name}): ${(error as Error).message}`;
        }
      }
      importInput.value = '';
      await refreshList();
    })();
  });

  async function refreshList(): Promise<void> {
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls = [];
    const photos = await listPhotos();
    const total = photos.reduce((s, p) => s + p.byteSize, 0);
    $('pl-summary').textContent =
      `保存済み ${photos.length}枚 / 合計 ${(total / 1024).toFixed(0)}KB（上限 ${PHOTO_TOTAL_CAP_BYTES / 1024 / 1024}MB）`;
    const list = $('pl-list');
    list.innerHTML = '';
    for (const p of [...photos].reverse()) {
      const url = URL.createObjectURL(p.blob);
      thumbUrls.push(url);
      const tiltText = p.tilt
        ? `仰角${p.tilt.elevationDeg.toFixed(1)}° ロール${p.tilt.rollDeg.toFixed(1)}° σ${p.tilt.elevationStdDevDeg.toFixed(2)}°`
        : '傾きなし';
      const item = document.createElement('div');
      item.className = 'photo-item';
      item.innerHTML = `
        <img src="${url}" alt="保存した写真" />
        <div class="note">${p.source === 'in-app-camera' ? 'アプリ内撮影' : '取り込み'} ${p.width}×${p.height}
          （元${p.originalWidth}×${p.originalHeight}） ${(p.byteSize / 1024).toFixed(0)}KB<br>${tiltText}</div>
        <button type="button">削除</button>`;
      item.querySelector('button')!.addEventListener('click', () => {
        void deletePhoto(p.id).then(refreshList);
      });
      list.appendChild(item);
    }
  }

  void requestPersistence().then((granted) => {
    if (!granted) messageEl.textContent = '永続ストレージは許可されませんでした（ブラウザの判断で写真が削除される場合があります）';
  });
  void refreshList();
}
