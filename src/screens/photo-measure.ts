import {
  estimateFocal35mm,
  estimateFocalFromVerticals,
  focalPxFrom35mm,
  groundDistanceUnits,
  planeDistanceViaTarget,
  tiltFromUp,
  upVectorFromVerticals,
  upVectorInCamera,
  verticalGuide,
  type CameraModel,
  type Vec2,
  type Vec3,
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
  /** 鉛直な線（柱・戸の縁など）2本。センサーを使わずに傾きを求める。 */
  verticals: { p1: Vec2; p2: Vec2 }[];
  rotationDeg: number;
  focal35mm: number;
}

const works = new Map<string, PhotoWork>();
const A4 = { long: 297, short: 210 };

/**
 * 技術検証D 第2段階: 保存した写真の上で辺を指定し、
 *  方式A（傾きセンサー＋焦点距離＋基準の既知長で縮尺）と
 *  方式A 縦線（写真に写った縦線2本から傾きを求める。センサー不要）と
 *  方式B（A4の4隅によるホモグラフィ）の寸法を出して、実測値との誤差を並べて見る。
 * 合否は付けず、誤差(cm・%)をそのまま出す。
 */
export function renderPhotoMeasure(container: HTMLElement): void {
  container.innerHTML = `
    <section class="photo-measure">
      <h2>技術検証D: 写真上で測る</h2>
      <p class="note">写真をタップすると十字の照準が置かれます。画面をドラッグすると、指の動きの一部だけ照準が動くので、拡大鏡を見ながら微調整し、「確定」で決定します。置いた点は、近くをもう一度タップすると動かし直せます。同じ平面上の辺だけが対象です。</p>
      <div class="photo-actions"><select id="pm-photo"></select></div>
      <div class="photo-settings">
        <label>画像の回転 <select id="pm-rot"><option value="0">0</option><option value="90">90</option><option value="180">180</option><option value="270">270</option></select></label>
        <label>焦点距離(35mm換算) <input id="pm-focal" type="text" inputmode="decimal" /></label>
        <button type="button" id="pm-fit">基準2本以上から焦点距離を推定</button>
        <button type="button" id="pm-fit-vert">縦線とセンサーから焦点距離を推定</button>
        <label><input id="pm-guide" type="checkbox" checked /> 鉛直ガイド線</label>
      </div>
      <div class="photo-actions">
        <button type="button" id="pm-add-ref">基準の線分を追加（2点）</button>
        <button type="button" id="pm-add-measure">測定の線分を追加（2点）</button>
        <button type="button" id="pm-add-a4">A4の4隅を指定</button>
        <button type="button" id="pm-add-vert">縦線2本を指定（柱など）</button>
        <label>A4の最初の辺 <select id="pm-a4edge"><option value="auto">自動（画像上で長い辺=長辺）</option><option value="long">長辺(297)</option><option value="short">短辺(210)</option></select></label>
        <button type="button" id="pm-undo">直前を取り消す</button>
        <button type="button" id="pm-clear">この写真の指定を全消去</button>
      </div>
      <div class="photo-settings">
        <label>微調整の速さ <select id="pm-gain"><option value="0.2">かなり細かい</option><option value="0.4" selected>細かい</option><option value="0.8">標準</option></select></label>
        <label>拡大鏡 <select id="pm-zoom"><option value="3">3倍</option><option value="4" selected>4倍</option><option value="6">6倍</option></select></label>
      </div>
      <p id="pm-status" class="note"></p>
      <div class="pm-wrap">
        <canvas id="pm-canvas" class="pm-canvas"></canvas>
        <canvas id="pm-loupe" class="pm-loupe" width="300" height="300" hidden></canvas>
      </div>
      <div id="pm-bar" class="pm-bar" hidden>
        <button type="button" id="pm-cancel">取消</button>
        <button type="button" id="pm-confirm">確定</button>
      </div>
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
  let mode: 'idle' | 'segment' | 'a4' | 'vertical' = 'idle';
  /** 仮置き中の照準位置(画像座標)。確定または取消までは点として扱わない。 */
  let aim: Vec2 | null = null;
  let editHandle: { get(): Vec2; set(p: Vec2): void } | null = null;
  let history: ('segment' | 'a4' | 'vertical')[] = [];
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
        verticals: [],
        rotationDeg: defaultRotation(current),
        focal35mm: current.focalLength35mm ?? 26,
      });
    }
    const w = work()!;
    $<HTMLSelectElement>('pm-rot').value = String(w.rotationDeg);
    $<HTMLInputElement>('pm-focal').value = String(w.focal35mm);
    mode = 'idle';
    pending = [];
    history = [];
    aim = null;
    statusEl.textContent = current.tilt
      ? ''
      : 'この写真は傾きセンサー値が無いため、方式A（センサー）は使えません（縦線2本の方式と、方式BのA4は使えます）';
    redraw();
  }

  function camera(): { cam: CameraModel; up: Vec3 | null; verticalUp: Vec3 | null } | null {
    const w = work();
    if (!current || !w) return null;
    const cam: CameraModel = {
      widthPx: current.width,
      heightPx: current.height,
      focalPx: focalPxFrom35mm(w.focal35mm, current.width, current.height),
    };
    const up = current.tilt ? upVectorInCamera(current.tilt.elevationDeg, current.tilt.rollDeg, w.rotationDeg) : null;
    const verticalUp = w.verticals.length === 2 ? upVectorFromVerticals(w.verticals, cam) : null;
    return { cam, up, verticalUp };
  }

  function redraw(): void {
    const w = work();
    if (!current || !bitmap || !w) return;
    canvas.width = current.width;
    canvas.height = current.height;
    canvas.style.touchAction = aim ? 'none' : 'auto'; // 仮置き中だけ、ドラッグでページがスクロールしないようにする
    ctx.drawImage(bitmap, 0, 0, current.width, current.height);
    const c = camera()!;

    // 鉛直ガイド線: 黄=センサー、水色=縦線2本から求めた傾き
    const guides: [Vec3 | null, string][] = [
      [c.up, 'rgba(255, 200, 0, 0.7)'],
      [c.verticalUp, 'rgba(0, 229, 255, 0.7)'],
    ];
    for (const [guideUp, color] of guides) {
      if (!$<HTMLInputElement>('pm-guide').checked || !guideUp) continue;
      const g = verticalGuide(c.cam, guideUp);
      ctx.strokeStyle = color;
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
    ctx.font = `${Math.round(current.width / 30)}px sans-serif`;
    w.verticals.forEach((v, i) => {
      ctx.strokeStyle = '#ff9100';
      ctx.fillStyle = '#ff9100';
      ctx.beginPath();
      ctx.moveTo(v.p1.x, v.p1.y);
      ctx.lineTo(v.p2.x, v.p2.y);
      ctx.stroke();
      ctx.fillText(`縦${i + 1}`, v.p1.x + 6, v.p1.y - 6);
    });
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
    if (aim) {
      const r = current.width / 45;
      ctx.strokeStyle = '#ffeb3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(aim.x - r, aim.y);
      ctx.lineTo(aim.x + r, aim.y);
      ctx.moveTo(aim.x, aim.y - r);
      ctx.lineTo(aim.x, aim.y + r);
      ctx.stroke();
    }
    if (!aim) renderTable(); // ドラッグ中は表を作り直さない（重いため。離した時に更新）
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

    // 方式A: 各線分の平面距離(カメラ高さ=1の単位)と、基準線分から求めた縮尺。上向きの出どころ別に計算する
    const methodA = (up: Vec3 | null) => {
      const units = w.segments.map((s) => (up ? groundDistanceUnits(s.p1, s.p2, c.cam, up) : null));
      const samples = w.segments
        .map((s, i) => (s.role === 'reference' && s.knownM && units[i] ? s.knownM / units[i]! : null))
        .filter((k): k is number => k !== null);
      const k = samples.length ? Math.exp(samples.reduce((a, x) => a + Math.log(x), 0) / samples.length) : null;
      return { values: units.map((u) => (u !== null && k !== null ? u * k : null)), refCount: samples.length };
    };
    const bySensor = methodA(c.up);
    const byVerticals = methodA(c.verticalUp);

    const rows = w.segments
      .map((s, i) => {
        const a = bySensor.values[i];
        const av = byVerticals.values[i];
        const edges = w.target ? a4Edges(w.target.corners) : null;
        const b =
          w.target && edges ? planeDistanceViaTarget(w.target.corners, edges.first, edges.second, s.p1, s.p2) : null;
        const bm = b === null ? null : b / 1000;
        return `<tr>
          <td>${i + 1}</td>
          <td><select data-i="${i}" class="pm-role"><option value="measure"${s.role === 'measure' ? ' selected' : ''}>測定</option><option value="reference"${s.role === 'reference' ? ' selected' : ''}>基準</option></select></td>
          <td><input data-i="${i}" class="pm-known" type="text" inputmode="decimal" value="${s.knownM ?? ''}" placeholder="実測m" /></td>
          <td>${fmt(a)}${errText(a, s.knownM)}</td>
          <td>${fmt(av)}${errText(av, s.knownM)}</td>
          <td>${fmt(bm)}${errText(bm, s.knownM)}</td>
          <td><button data-i="${i}" class="pm-del" type="button">削除</button></td>
        </tr>`;
      })
      .join('');
    $('pm-table').innerHTML = `
      <table class="trial-table">
        <thead><tr><th>#</th><th>種別</th><th>実測(m)</th><th>方式A センサー</th><th>方式A 縦線</th><th>方式B A4</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    const tiltText = (up: Vec3 | null) => {
      if (!up) return 'なし';
      const t = tiltFromUp(up);
      return `仰角${t.elevationDeg.toFixed(1)}° 画像の傾き${t.imageRollDeg.toFixed(1)}°`;
    };
    const verticalText =
      w.verticals.length !== 2 ? '未指定' : c.verticalUp ? tiltText(c.verticalUp) : '2本が同じ向きで求められません';
    const refCount = Math.max(bySensor.refCount, byVerticals.refCount);
    $('pm-info').textContent =
      `写真 ${current!.width}×${current!.height} / f=${w.focal35mm}mm(35mm換算)` +
      ` / 傾き(センサー): ${tiltText(c.up)}` +
      (current!.tilt ? `（ロール${current!.tilt.rollDeg.toFixed(1)}° 回転${w.rotationDeg}°）` : '') +
      ` / 傾き(縦線): ${verticalText}` +
      ` / 方式Aの縮尺: ${refCount === 0 ? '基準（実測入力済みの線分）が必要' : `基準${refCount}本から算出`}` +
      ` / A4: ${w.target ? `指定済み(最初の辺=${a4Edges(w.target.corners).first}mm)` : '未指定'}`;

    container.querySelectorAll<HTMLInputElement>('.pm-known').forEach((input) => {
      input.addEventListener('change', () => {
        const v = Number.parseFloat(input.value);
        w.segments[Number(input.dataset.i)].knownM = Number.isNaN(v) ? null : v;
        redraw();
      });
    });
    container.querySelectorAll<HTMLSelectElement>('.pm-role').forEach((sel) => {
      sel.addEventListener('change', () => {
        w.segments[Number(sel.dataset.i)].role = sel.value === 'reference' ? 'reference' : 'measure';
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

  const loupe = $<HTMLCanvasElement>('pm-loupe');
  const loupeCtx = loupe.getContext('2d')!;
  const bar = $('pm-bar');
  const cssScale = () => canvas.width / canvas.getBoundingClientRect().width; // 画像px / CSSpx
  type Handle = { get(): Vec2; set(p: Vec2): void };
  let tentative: { confirm(): void; cancel(): void } | null = null;
  let loupeOnRight = true;
  let lastPointer: { x: number; y: number } | null = null;

  function drawLoupe(): void {
    if (!aim || !bitmap || !current) return;
    const zoom = Number.parseFloat($<HTMLSelectElement>('pm-zoom').value);
    const loupeCss = loupe.getBoundingClientRect().width || 150;
    const k = cssScale();
    const src = (loupeCss * k) / zoom; // 拡大鏡が映す元画像の幅(画像px)
    loupeCtx.clearRect(0, 0, loupe.width, loupe.height);
    loupeCtx.drawImage(bitmap, aim.x - src / 2, aim.y - src / 2, src, src, 0, 0, loupe.width, loupe.height);
    loupeCtx.strokeStyle = '#ffeb3b';
    loupeCtx.lineWidth = 2;
    const c = loupe.width / 2;
    const gap = 6;
    loupeCtx.beginPath();
    loupeCtx.moveTo(0, c);
    loupeCtx.lineTo(c - gap, c);
    loupeCtx.moveTo(c + gap, c);
    loupeCtx.lineTo(loupe.width, c);
    loupeCtx.moveTo(c, 0);
    loupeCtx.lineTo(c, c - gap);
    loupeCtx.moveTo(c, c + gap);
    loupeCtx.lineTo(c, loupe.height);
    loupeCtx.stroke();
    // 拡大鏡は上隅に固定し、照準が近づいたときだけ反対側へ移す（動き回らないようにする）
    const rect = canvas.getBoundingClientRect();
    const ax = aim.x / k;
    const ay = aim.y / k;
    const x0 = loupeOnRight ? rect.width - loupeCss : 0;
    if (ay < loupeCss + 30 && ax > x0 - 30 && ax < x0 + loupeCss + 30) loupeOnRight = !loupeOnRight;
    loupe.style.left = loupeOnRight ? 'auto' : '0';
    loupe.style.right = loupeOnRight ? '0' : 'auto';
    loupe.hidden = false;
  }

  function findHandle(at: Vec2): Handle | null {
    const w = work();
    if (!w) return null;
    const list: Handle[] = [];
    for (const seg of w.segments) {
      list.push({ get: () => seg.p1, set: (p) => (seg.p1 = p) }, { get: () => seg.p2, set: (p) => (seg.p2 = p) });
    }
    for (const v of w.verticals) {
      list.push({ get: () => v.p1, set: (p) => (v.p1 = p) }, { get: () => v.p2, set: (p) => (v.p2 = p) });
    }
    if (w.target) {
      const t = w.target;
      t.corners.forEach((_, i) => list.push({ get: () => t.corners[i], set: (p) => (t.corners[i] = p) }));
    }
    let best: Handle | null = null;
    let bestDist = 40 * cssScale(); // タップ位置から40CSSpx以内の点だけ選べる
    for (const h of list) {
      const d = Math.hypot(h.get().x - at.x, h.get().y - at.y);
      if (d < bestDist) {
        best = h;
        bestDist = d;
      }
    }
    return best;
  }

  function beginTentative(at: Vec2, confirm: () => void, cancel: () => void): void {
    aim = at;
    tentative = { confirm, cancel };
    bar.hidden = false;
    redraw();
    drawLoupe();
  }

  function endTentative(): void {
    aim = null;
    tentative = null;
    editHandle = null;
    lastPointer = null;
    bar.hidden = true;
    loupe.hidden = true;
    redraw();
  }

  function commitPending(p: Vec2): void {
    const w = work();
    if (!w) return;
    pending.push(p);
    if (mode === 'segment' && pending.length === 2) {
      w.segments.push({ p1: pending[0], p2: pending[1], role: pendingRole, knownM: null });
      history.push('segment');
      pending = [];
      mode = 'idle';
      statusEl.textContent = '';
    } else if (mode === 'a4' && pending.length === 4) {
      w.target = { corners: pending };
      history.push('a4');
      pending = [];
      mode = 'idle';
      statusEl.textContent = '';
    } else if (mode === 'vertical' && pending.length === 4) {
      w.verticals = [
        { p1: pending[0], p2: pending[1] },
        { p1: pending[2], p2: pending[3] },
      ];
      history.push('vertical');
      pending = [];
      mode = 'idle';
      statusEl.textContent = '';
    } else if (mode === 'vertical') {
      statusEl.textContent = `縦線${pending.length < 2 ? 1 : 2}の${pending.length % 2 === 0 ? '上端' : '下端'}をタップ（${pending.length}/4）`;
    } else {
      statusEl.textContent =
        mode === 'a4' ? `A4の角を順にたどって指定（${pending.length}/4）。次の角をタップ` : '2点目の位置をタップしてください';
    }
  }

  // タップ: 指定中なら照準を置く。指定中でなければ、近くの既存の点を選んで動かし直す。
  canvas.addEventListener('click', (event) => {
    if (!work() || tentative) return;
    const rect = canvas.getBoundingClientRect();
    const k = cssScale();
    const at = { x: (event.clientX - rect.left) * k, y: (event.clientY - rect.top) * k };
    if (mode === 'segment' || mode === 'a4' || mode === 'vertical') {
      beginTentative(at, () => commitPending(aim!), () => undefined);
      statusEl.textContent = 'ドラッグで微調整し、「確定」を押してください';
    } else {
      const handle = findHandle(at);
      if (!handle) return;
      const original = { ...handle.get() };
      editHandle = handle;
      beginTentative(original, () => undefined, () => handle.set(original));
      statusEl.textContent = '点を動かし直しています。ドラッグで微調整し、「確定」または「取消」を押してください';
    }
  });

  // ドラッグ: 指の動きの一部だけ照準を動かす（絶対位置へは飛ばない）
  canvas.addEventListener('pointerdown', (event) => {
    if (!tentative) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    lastPointer = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!tentative || !lastPointer || !aim) return;
    event.preventDefault();
    const gain = Number.parseFloat($<HTMLSelectElement>('pm-gain').value);
    const k = cssScale();
    aim = {
      x: Math.min(canvas.width, Math.max(0, aim.x + (event.clientX - lastPointer.x) * k * gain)),
      y: Math.min(canvas.height, Math.max(0, aim.y + (event.clientY - lastPointer.y) * k * gain)),
    };
    lastPointer = { x: event.clientX, y: event.clientY };
    editHandle?.set(aim);
    redraw();
    drawLoupe();
  });
  const stopDrag = () => {
    lastPointer = null;
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  $('pm-confirm').addEventListener('click', () => {
    const t = tentative;
    if (!t) return;
    t.confirm();
    endTentative();
  });
  $('pm-cancel').addEventListener('click', () => {
    const t = tentative;
    if (!t) return;
    t.cancel();
    statusEl.textContent = mode === 'idle' ? '' : statusEl.textContent;
    endTentative();
  });
  $('pm-undo').addEventListener('click', () => {
    const w = work();
    if (!w) return;
    if (tentative) {
      $('pm-cancel').click();
      return;
    }
    if (pending.length > 0) {
      pending.pop();
      statusEl.textContent = '直前の点を取り消しました';
    } else {
      const last = history.pop();
      if (last === 'segment') w.segments.pop();
      else if (last === 'a4') w.target = null;
      else if (last === 'vertical') w.verticals = [];
    }
    redraw();
  });

  const startSegment = (role: Segment['role']) => {
    mode = 'segment';
    pendingRole = role;
    pending = [];
    statusEl.textContent = '1点目の位置をタップしてください（その後ドラッグで微調整→「確定」）';
    redraw();
  };
  $('pm-add-ref').addEventListener('click', () => startSegment('reference'));
  $('pm-add-measure').addEventListener('click', () => startSegment('measure'));
  $('pm-add-a4').addEventListener('click', () => {
    mode = 'a4';
    pending = [];
    statusEl.textContent = 'A4の1つ目の角をタップしてください（その後ドラッグで微調整→「確定」）。角は辺に沿って順に';
    redraw();
  });
  $('pm-add-vert').addEventListener('click', () => {
    mode = 'vertical';
    pending = [];
    statusEl.textContent =
      '縦線1の上端をタップしてください。柱・戸の縁など、まっすぐ縦に立つ線を、左右に離れた2本、なるべく長く指定します';
    redraw();
  });
  $('pm-fit-vert').addEventListener('click', () => {
    const w = work();
    const c = camera();
    if (!w || !c || !current) return;
    if (!c.up || w.verticals.length !== 2) {
      statusEl.textContent = '傾きセンサー値のある写真で、縦線2本を指定してください';
      return;
    }
    const result = estimateFocalFromVerticals(w.verticals, { widthPx: current.width, heightPx: current.height }, c.up);
    if (!result) {
      statusEl.textContent = '縦線2本が同じ向きのため推定できません。左右に離れた線を指定してください';
      return;
    }
    w.focal35mm = Math.round(result.focal35mm * 10) / 10;
    $<HTMLInputElement>('pm-focal').value = String(w.focal35mm);
    statusEl.textContent = `焦点距離を ${w.focal35mm}mm と推定（縦線とセンサーの向きの差 ${result.angleDeg.toFixed(2)}°）`;
    redraw();
  });
  $('pm-clear').addEventListener('click', () => {
    const w = work();
    if (!w) return;
    w.segments = [];
    w.target = null;
    w.verticals = [];
    pending = [];
    history = [];
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
