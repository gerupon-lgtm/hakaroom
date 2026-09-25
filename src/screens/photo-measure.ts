import {
  estimateFocal35mm,
  focalPxFrom35mm,
  groundDistanceUnits,
  planeDistanceViaTarget,
  upVectorInCamera,
  verticalGuide,
  type CameraModel,
  type Vec2,
} from '../photo/rectify';
import { listPhotos } from '../storage/photo-store';
import type { PhotoRecord } from '../types';

interface Segment {
  p1: Vec2;
  p2: Vec2;
  role: 'reference' | 'measure';
  /** 実測値(m)。基準では縮尺の元、測定では誤差比較用（任意）。 */
  knownM: number | null;
}

interface PhotoWork {
  segments: Segment[];
  target: { corners: Vec2[] } | null;
  rotationDeg: number;
  focal35mm: number;
}

const works = new Map<string, PhotoWork>();
const A4 = { long: 297, short: 210 };

/**
 * 技術検証D 第2段階: 保存した写真の上で辺を指定し、
 *  方式A（傾きセンサー＋焦点距離＋基準の既知長で縮尺）と
 *  方式B（A4の4隅によるホモグラフィ）の寸法を出して、実測値との誤差を並べて見る。
 * 合否は付けず、誤差(cm・%)をそのまま出す。
 */
export function renderPhotoMeasure(container: HTMLElement): void {
  container.innerHTML = `
    <section class="photo-measure">
      <h2>技術検証D: 写真上で測る</h2>
      <p class="note">写真をタップして、線分（2点）またはA4の4隅を指定します。同じ高さの平面上の辺だけが対象です。</p>
      <div class="photo-actions"><select id="pm-photo"></select></div>
      <div class="photo-settings">
        <label>画像の回転 <select id="pm-rot"><option value="0">0</option><option value="90">90</option><option value="180">180</option><option value="270">270</option></select></label>
        <label>焦点距離(35mm換算) <input id="pm-focal" type="text" inputmode="decimal" /></label>
        <button type="button" id="pm-fit">基準2本以上から焦点距離を推定</button>
        <label><input id="pm-guide" type="checkbox" checked /> 鉛直ガイド線</label>
      </div>
      <div class="photo-actions">
        <button type="button" id="pm-add-ref">基準の線分を追加（2点）</button>
        <button type="button" id="pm-add-measure">測定の線分を追加（2点）</button>
        <button type="button" id="pm-add-a4">A4の4隅を指定</button>
        <label>A4の最初の辺 <select id="pm-a4edge"><option value="auto">自動（画像上で長い辺=長辺）</option><option value="long">長辺(297)</option><option value="short">短辺(210)</option></select></label>
        <button type="button" id="pm-clear">この写真の指定を全消去</button>
      </div>
      <p id="pm-status" class="note"></p>
      <canvas id="pm-canvas" class="pm-canvas"></canvas>
      <div id="pm-info" class="note"></div>
      <div id="pm-table"></div>
    </section>
  `;

  const $ = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
  const canvas = $<HTMLCanvasElement>('pm-canvas');
  const ctx = canvas.getContext('2d')!;
  const select = $<HTMLSelectElement>('pm-photo');
  const statusEl = $<HTMLElement>('pm-status');

  let photos: PhotoRecord[] = [];
  let current: PhotoRecord | null = null;
  let bitmap: ImageBitmap | null = null;
  let mode: 'idle' | 'segment' | 'a4' = 'idle';
  let pendingRole: Segment['role'] = 'measure';
  let pending: Vec2[] = [];

  const work = (): PhotoWork | null => (current ? (works.get(current.id) ?? null) : null);

  function defaultRotation(p: PhotoRecord): number {
    return p.tilt?.screenAngleDeg === 90 || p.tilt?.screenAngleDeg === 270 ? p.tilt.screenAngleDeg : 0;
  }

  async function selectPhoto(id: string): Promise<void> {
    current = photos.find((p) => p.id === id) ?? null;
    if (!current) return;
    bitmap = await createImageBitmap(current.blob);
    if (!works.has(current.id)) {
      works.set(current.id, {
        segments: [],
        target: null,
        rotationDeg: defaultRotation(current),
        focal35mm: current.focalLength35mm ?? 26,
      });
    }
    const w = work()!;
    $<HTMLSelectElement>('pm-rot').value = String(w.rotationDeg);
    $<HTMLInputElement>('pm-focal').value = String(w.focal35mm);
    mode = 'idle';
    pending = [];
    statusEl.textContent = current.tilt ? '' : 'この写真は傾きセンサー値が無いため、方式A（傾き補正）は使えません（方式BのA4のみ）';
    redraw();
  }

  function camera(): { cam: CameraModel; up: ReturnType<typeof upVectorInCamera> | null } | null {
    const w = work();
    if (!current || !w) return null;
    const cam: CameraModel = {
      widthPx: current.width,
      heightPx: current.height,
      focalPx: focalPxFrom35mm(w.focal35mm, current.width, current.height),
    };
    const up = current.tilt ? upVectorInCamera(current.tilt.elevationDeg, current.tilt.rollDeg, w.rotationDeg) : null;
    return { cam, up };
  }

  function redraw(): void {
    const w = work();
    if (!current || !bitmap || !w) return;
    canvas.width = current.width;
    canvas.height = current.height;
    ctx.drawImage(bitmap, 0, 0, current.width, current.height);
    const c = camera()!;

    if ($<HTMLInputElement>('pm-guide').checked && c.up) {
      const g = verticalGuide(c.cam, c.up);
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.7)';
      ctx.lineWidth = 2;
      for (const fx of [0.15, 0.35, 0.5, 0.65, 0.85]) {
        for (const fy of [0.3, 0.7]) {
          const s = { x: current.width * fx, y: current.height * fy };
          let d = g.direction;
          if (g.vanishing) {
            const vx = g.vanishing.x - s.x;
            const vy = g.vanishing.y - s.y;
            const len = Math.hypot(vx, vy) || 1;
            d = { x: vx / len, y: vy / len };
          }
          const L = current.height * 0.2;
          ctx.beginPath();
          ctx.moveTo(s.x - d.x * L, s.y - d.y * L);
          ctx.lineTo(s.x + d.x * L, s.y + d.y * L);
          ctx.stroke();
        }
      }
    }

    ctx.lineWidth = 3;
    if (w.target) {
      ctx.strokeStyle = '#00e5ff';
      ctx.beginPath();
      w.target.corners.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
    }
    w.segments.forEach((s, i) => {
      ctx.strokeStyle = s.role === 'reference' ? '#ff4081' : '#76ff03';
      ctx.beginPath();
      ctx.moveTo(s.p1.x, s.p1.y);
      ctx.lineTo(s.p2.x, s.p2.y);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `${Math.round(current!.width / 30)}px sans-serif`;
      ctx.fillText(String(i + 1), s.p1.x + 6, s.p1.y - 6);
    });
    ctx.fillStyle = '#ffffff';
    pending.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, current!.width / 150, 0, Math.PI * 2);
      ctx.fill();
    });
    renderTable();
  }

  /** 4隅の最初の辺(角1→角2)に割り当てるA4の辺の長さ(mm)。自動は画像上で長い方を長辺とみなす。 */
  function a4Edges(corners: Vec2[]): { first: number; second: number } {
    const mode = $<HTMLSelectElement>('pm-a4edge').value;
    const e1 = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
    const e2 = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
    const firstIsLong = mode === 'long' || (mode === 'auto' && e1 >= e2);
    return firstIsLong ? { first: A4.long, second: A4.short } : { first: A4.short, second: A4.long };
  }

  const fmt = (m: number | null) => (m === null ? '—' : `${m.toFixed(3)}m`);
  const errText = (value: number | null, known: number | null) =>
    value === null || known === null
      ? ''
      : `<br>誤差 ${((value - known) * 100).toFixed(1)}cm (${(((value - known) / known) * 100).toFixed(1)}%)`;

  function renderTable(): void {
    const w = work();
    const c = camera();
    if (!w || !c) return;

    // 方式A: 各線分の平面距離(カメラ高さ=1の単位)と、基準線分から求めた縮尺
    const units = w.segments.map((s) => (c.up ? groundDistanceUnits(s.p1, s.p2, c.cam, c.up) : null));
    const scaleSamples = w.segments
      .map((s, i) => (s.role === 'reference' && s.knownM && units[i] ? s.knownM / units[i]! : null))
      .filter((k): k is number => k !== null);
    const scaleK = scaleSamples.length ? Math.exp(scaleSamples.reduce((a, k) => a + Math.log(k), 0) / scaleSamples.length) : null;

    const rows = w.segments
      .map((s, i) => {
        const a = units[i] !== null && scaleK !== null ? units[i]! * scaleK : null;
        const edges = w.target ? a4Edges(w.target.corners) : null;
        const b =
          w.target && edges ? planeDistanceViaTarget(w.target.corners, edges.first, edges.second, s.p1, s.p2) : null;
        const bm = b === null ? null : b / 1000;
        return `<tr>
          <td>${i + 1}</td>
          <td>${s.role === 'reference' ? '基準' : '測定'}</td>
          <td><input data-i="${i}" class="pm-known" type="text" inputmode="decimal" value="${s.knownM ?? ''}" placeholder="実測m" /></td>
          <td>${fmt(a)}${errText(a, s.knownM)}</td>
          <td>${fmt(bm)}${errText(bm, s.knownM)}</td>
          <td><button data-i="${i}" class="pm-del" type="button">削除</button></td>
        </tr>`;
      })
      .join('');
    $('pm-table').innerHTML = `
      <table class="trial-table">
        <thead><tr><th>#</th><th>種別</th><th>実測(m)</th><th>方式A 傾き補正</th><th>方式B A4</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    $('pm-info').textContent =
      `写真 ${current!.width}×${current!.height} / f=${w.focal35mm}mm(35mm換算) / 傾き ` +
      (current!.tilt
        ? `仰角${current!.tilt.elevationDeg.toFixed(1)}° ロール${current!.tilt.rollDeg.toFixed(1)}° 回転${w.rotationDeg}°`
        : 'なし') +
      ` / 方式Aの縮尺: ${scaleK === null ? '基準（実測入力済みの線分）が必要' : `基準${scaleSamples.length}本から算出`}` +
      ` / A4: ${w.target ? `指定済み(最初の辺=${a4Edges(w.target.corners).first}mm)` : '未指定'}`;

    container.querySelectorAll<HTMLInputElement>('.pm-known').forEach((input) => {
      input.addEventListener('change', () => {
        const v = Number.parseFloat(input.value);
        w.segments[Number(input.dataset.i)].knownM = Number.isNaN(v) ? null : v;
        redraw();
      });
    });
    container.querySelectorAll<HTMLButtonElement>('.pm-del').forEach((button) => {
      button.addEventListener('click', () => {
        w.segments.splice(Number(button.dataset.i), 1);
        redraw();
      });
    });
  }

  canvas.addEventListener('click', (event) => {
    const w = work();
    if (!w || mode === 'idle') return;
    const rect = canvas.getBoundingClientRect();
    pending.push({
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    });
    if (mode === 'segment' && pending.length === 2) {
      w.segments.push({ p1: pending[0], p2: pending[1], role: pendingRole, knownM: null });
      pending = [];
      mode = 'idle';
      statusEl.textContent = '';
    } else if (mode === 'a4' && pending.length === 4) {
      w.target = { corners: pending };
      pending = [];
      mode = 'idle';
      statusEl.textContent = '';
    } else {
      statusEl.textContent = mode === 'a4' ? `A4の角を順にたどってタップ（${pending.length}/4）` : '2点目をタップしてください';
    }
    redraw();
  });

  const startSegment = (role: Segment['role']) => {
    mode = 'segment';
    pendingRole = role;
    pending = [];
    statusEl.textContent = '1点目をタップしてください';
    redraw();
  };
  $('pm-add-ref').addEventListener('click', () => startSegment('reference'));
  $('pm-add-measure').addEventListener('click', () => startSegment('measure'));
  $('pm-add-a4').addEventListener('click', () => {
    mode = 'a4';
    pending = [];
    statusEl.textContent = 'A4の角を順にたどってタップ（0/4）';
    redraw();
  });
  $('pm-clear').addEventListener('click', () => {
    const w = work();
    if (!w) return;
    w.segments = [];
    w.target = null;
    pending = [];
    mode = 'idle';
    redraw();
  });
  $('pm-guide').addEventListener('change', redraw);
  $('pm-a4edge').addEventListener('change', redraw);
  $<HTMLSelectElement>('pm-rot').addEventListener('change', (e) => {
    const w = work();
    if (w) w.rotationDeg = Number.parseInt((e.target as HTMLSelectElement).value, 10);
    redraw();
  });
  $<HTMLInputElement>('pm-focal').addEventListener('change', (e) => {
    const w = work();
    const v = Number.parseFloat((e.target as HTMLInputElement).value);
    if (w && !Number.isNaN(v) && v > 0) w.focal35mm = v;
    redraw();
  });
  $('pm-fit').addEventListener('click', () => {
    const w = work();
    const c = camera();
    if (!w || !c || !c.up || !current) return;
    const refs = w.segments
      .filter((s) => s.role === 'reference' && s.knownM)
      .map((s) => ({ p1: s.p1, p2: s.p2, knownLength: s.knownM! }));
    const result = estimateFocal35mm(refs, { widthPx: current.width, heightPx: current.height }, c.up);
    if (!result) {
      statusEl.textContent = '実測値を入れた基準の線分が2本以上必要です（方向の違う線分だと推定が安定します）';
      return;
    }
    w.focal35mm = Math.round(result.focal35mm * 10) / 10;
    $<HTMLInputElement>('pm-focal').value = String(w.focal35mm);
    statusEl.textContent = `焦点距離を ${w.focal35mm}mm と推定（縮尺のばらつき σ(log)=${result.costLogScaleStdDev.toFixed(4)}）`;
    redraw();
  });
  select.addEventListener('change', () => void selectPhoto(select.value));

  void listPhotos().then((list) => {
    photos = list;
    if (photos.length === 0) {
      statusEl.textContent = '保存された写真がありません。先に「技術検証D: 写真方式（撮影・傾きセンサー）」で撮影してください。';
      return;
    }
    select.innerHTML = photos
      .map((p, i) => `<option value="${p.id}">${i + 1}. ${p.source === 'in-app-camera' ? '撮影' : '取込'} ${p.width}×${p.height}${p.tilt ? ' 傾きあり' : ''}</option>`)
      .join('');
    void selectPhoto(photos[0].id);
  });
}
