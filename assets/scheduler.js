// محرك توزيع الحصص
// القيود الأساسية (لا تُكسر): المعلم لا يكون في حصتين بالوقت نفسه، والشعبة كذلك.
// القيود المرنة: توزيع حصص المادة على أيام مختلفة للشعبة، وموازنة حصص المعلم على الأيام،
// وتقليل الفراغات بين حصص المعلم في اليوم.
//
// lessons: [{ t: teacherId, s: subjectId, c: sectionId, d: day|null, p: period|null, l: locked }]

export async function schedule({ D, P, lessons, timeBudget = 4000, maxTries = 120, onProgress } = {}) {
  const N = D * P;
  const idx = (m, k) => { if (!m.has(k)) m.set(k, m.size); return m.get(k); };
  const tM = new Map(), cM = new Map(), kM = new Map();
  const L = lessons.map(x => ({ ti: idx(tM, x.t), ci: idx(cM, x.c), ki: idx(kM, x.c + "|" + x.s) }));
  const nT = tM.size, nC = cM.size, nK = kM.size, nL = L.length;

  const kCount = new Int32Array(nK), tLoad = new Int32Array(nT), cLoad = new Int32Array(nC);
  L.forEach(l => { kCount[l.ki]++; tLoad[l.ti]++; cLoad[l.ci]++; });
  const cap = Array.from(kCount, n => Math.max(1, Math.ceil(n / D)));
  const tAvg = Array.from(tLoad, n => n / D);

  const fixedSlot = new Int32Array(nL).fill(-1);
  lessons.forEach((x, i) => {
    if (x.l && x.d != null && x.p != null && x.d < D && x.p < P) fixedSlot[i] = x.d * P + x.p;
  });

  let best = null, tries = 0;
  const t0 = now();
  while (tries < maxTries) {
    const r = attempt();
    tries++;
    if (!best || r.unplaced < best.unplaced || (r.unplaced === best.unplaced && r.pen < best.pen)) best = r;
    onProgress?.({ tries, maxTries, unplaced: best.unplaced, elapsed: now() - t0 });
    const el = now() - t0;
    if (el > timeBudget) break;
    if (best.unplaced === 0 && tries >= 8 && el > timeBudget * 0.4) break;
    await new Promise(r => setTimeout(r, 0));
  }

  const out = lessons.map((x, i) => {
    const s = best.pos[i];
    return { ...x, d: s >= 0 ? Math.floor(s / P) : null, p: s >= 0 ? s % P : null };
  });
  return { lessons: out, unplaced: best.unplaced, penalty: Math.round(best.pen), tries, ms: Math.round(now() - t0) };

  // ---------------------------------------------------------------
  function attempt() {
    const tB = new Int32Array(nT * N).fill(-1);
    const cB = new Int32Array(nC * N).fill(-1);
    const kD = new Int32Array(nK * D);
    const tD = new Int32Array(nT * D);
    const pos = new Int32Array(nL).fill(-1);
    const isFixed = new Uint8Array(nL);
    const kicked = new Int32Array(nL);

    const place = (i, s) => {
      const l = L[i], d = (s / P) | 0;
      tB[l.ti * N + s] = i; cB[l.ci * N + s] = i;
      kD[l.ki * D + d]++; tD[l.ti * D + d]++; pos[i] = s;
    };
    const unplace = i => {
      const s = pos[i]; if (s < 0) return;
      const l = L[i], d = (s / P) | 0;
      tB[l.ti * N + s] = -1; cB[l.ci * N + s] = -1;
      kD[l.ki * D + d]--; tD[l.ti * D + d]--; pos[i] = -1;
    };

    const cost = (i, s, strict) => {
      const l = L[i];
      if (tB[l.ti * N + s] >= 0 || cB[l.ci * N + s] >= 0) return Infinity;
      const d = (s / P) | 0, p = s % P;
      const kd = kD[l.ki * D + d];
      if (strict && kd >= cap[l.ki]) return Infinity;
      let c = kd * 4 + Math.max(0, kd + 1 - cap[l.ki]) * 25;
      c += Math.max(0, tD[l.ti * D + d] + 1 - Math.ceil(tAvg[l.ti])) * 3 + tD[l.ti * D + d] * 0.6;
      // المادة نفسها متتالية للشعبة
      if (p > 0) { const j = cB[l.ci * N + s - 1]; if (j >= 0 && L[j].ki === l.ki) c += 2.5; }
      if (p < P - 1) { const j = cB[l.ci * N + s + 1]; if (j >= 0 && L[j].ki === l.ki) c += 2.5; }
      // تقليل الفراغات: يفضل أن تكون بجانب حصة أخرى للمعلم في اليوم نفسه
      if (tD[l.ti * D + d] > 0) {
        const adj = (p > 0 && tB[l.ti * N + s - 1] >= 0) || (p < P - 1 && tB[l.ti * N + s + 1] >= 0);
        c += adj ? -0.8 : 0.4;
      }
      return c + Math.random() * 1.2;
    };
    const bestSlot = (i, strict, except = -1) => {
      let bs = -1, bc = Infinity;
      for (let s = 0; s < N; s++) {
        if (s === except) continue;
        const c = cost(i, s, strict);
        if (c < bc) { bc = c; bs = s; }
      }
      return bs;
    };
    // نقل حصة تعارض إلى مكان آخر لإفساح المجال
    const repair = i => {
      const l = L[i];
      const order = shuffle(Array.from({ length: N }, (_, k) => k));
      for (const s of order) {
        const a = tB[l.ti * N + s], b = cB[l.ci * N + s];
        if (a < 0 && b < 0) return s;
        if (a >= 0 && b >= 0 && a !== b) continue;
        const j = a >= 0 ? a : b;
        if (isFixed[j]) continue;
        unplace(j);
        const s2 = bestSlot(j, false, s);
        if (s2 >= 0) {
          place(j, s2);
          if (tB[l.ti * N + s] < 0 && cB[l.ci * N + s] < 0) return s;
        } else place(j, s);
      }
      return -1;
    };

    // 1) الحصص المثبتة
    const queue = [];
    for (let i = 0; i < nL; i++) {
      const s = fixedSlot[i];
      if (s >= 0 && tB[L[i].ti * N + s] < 0 && cB[L[i].ci * N + s] < 0) { place(i, s); isFixed[i] = 1; }
      else queue.push(i);
    }
    // 2) ترتيب الصعوبة: المعلمون والشعب الأكثر حصصًا أولًا
    const w = new Float64Array(nL);
    for (const i of queue) w[i] = tLoad[L[i].ti] / N * 2 + cLoad[L[i].ci] / N + 1 / Math.max(1, kCount[L[i].ki]) * 0.2 + Math.random() * 0.35;
    queue.sort((a, b) => w[b] - w[a]);

    // 3) التوزيع مع سلسلة إزاحة عند التعذر
    let kicks = 0;
    const maxKicks = nL * 4;
    while (queue.length) {
      const i = queue.shift();
      let s = bestSlot(i, true);
      if (s < 0) s = bestSlot(i, false);
      if (s < 0) s = repair(i);
      if (s >= 0) { place(i, s); continue; }
      if (kicks++ > maxKicks) { queue.push(i); break; }
      // إزاحة: اختيار خانة بأقل إزعاج
      const l = L[i];
      let bs = -1, bScore = Infinity;
      for (let s2 = 0; s2 < N; s2++) {
        const a = tB[l.ti * N + s2], b = cB[l.ci * N + s2];
        if ((a >= 0 && isFixed[a]) || (b >= 0 && isFixed[b])) continue;
        let sc = Math.random() * 2;
        if (a >= 0) sc += 3 + kicked[a] * 2;
        if (b >= 0 && b !== a) sc += 3 + kicked[b] * 2;
        if (sc < bScore) { bScore = sc; bs = s2; }
      }
      if (bs < 0) { queue.push(i); break; }
      const a = tB[l.ti * N + bs], b = cB[l.ci * N + bs];
      for (const j of new Set([a, b])) if (j >= 0) { unplace(j); kicked[j]++; queue.push(j); }
      place(i, bs);
    }
    const unplaced = queue.length;

    // 4) تحسين: محاولة تقليل العقوبة بنقل الحصص
    const lessonPen = i => {
      const s = pos[i]; if (s < 0) return 0;
      unplace(i); const c = cost(i, s, false); place(i, s); return c;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nL; i++) {
        if (isFixed[i] || pos[i] < 0) continue;
        const cur = lessonPen(i);
        const s0 = pos[i];
        unplace(i);
        const s = bestSlot(i, false);
        if (s >= 0 && cost(i, s, false) < cur - 0.5) place(i, s); else place(i, s0);
      }
    }

    // العقوبة الكلية
    let pen = unplaced * 1000;
    for (let k = 0; k < nK; k++) for (let d = 0; d < D; d++) {
      const v = kD[k * D + d];
      if (v > cap[k]) pen += (v - cap[k]) * 20;
      if (v > 1) pen += (v - 1) * 3;
    }
    for (let t = 0; t < nT; t++) for (let d = 0; d < D; d++) {
      const v = tD[t * D + d]; pen += Math.max(0, v - Math.ceil(tAvg[t])) * 3;
    }
    return { pos: Array.from(pos), unplaced, pen };
  }
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

// يحوّل إسناد المعلمين إلى قائمة حصص ويطابقها مع الجدول المحفوظ
export function reconcile(teachers, saved, D, P, validSections) {
  const need = new Map();
  for (const t of teachers) for (const a of t.assignments || []) {
    if (!validSections.has(a.sectionId) || !(a.periods > 0)) continue;
    const k = `${t.id}|${a.subjectId}|${a.sectionId}`;
    need.set(k, (need.get(k) || 0) + Number(a.periods));
  }
  const groups = new Map();
  for (const x of saved || []) {
    const k = `${x.t}|${x.s}|${x.c}`;
    if (!need.has(k)) continue;
    if (!groups.has(k)) groups.set(k, []);
    const ok = x.d != null && x.p != null && x.d < D && x.p < P;
    groups.get(k).push({ ...x, d: ok ? x.d : null, p: ok ? x.p : null, l: ok ? !!x.l : false });
  }
  const out = [];
  for (const [k, n] of need) {
    const [t, s, c] = k.split("|");
    const g = (groups.get(k) || []).sort((a, b) => (b.d != null) - (a.d != null) || (b.l ? 1 : 0) - (a.l ? 1 : 0));
    for (let i = 0; i < n; i++) out.push(g[i] ? { t, s, c, d: g[i].d, p: g[i].p, l: g[i].l } : { t, s, c, d: null, p: null, l: false });
  }
  // إزالة التعارضات من بيانات قديمة: الخانة المحجوزة مرتين تبقى للأولى فقط
  const tb = new Set(), cb = new Set();
  for (const x of out) if (x.d != null) {
    const a = `${x.t}@${x.d}.${x.p}`, b = `${x.c}@${x.d}.${x.p}`;
    if (tb.has(a) || cb.has(b)) { x.d = x.p = null; x.l = false; continue; }
    tb.add(a); cb.add(b);
  }
  return out;
}
