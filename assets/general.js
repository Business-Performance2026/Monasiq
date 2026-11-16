// الجدول العام للمعلمين — مشترك بين لوحة المدرسة وحساب المعلم
// صف لكل معلم، أعمدة = الأيام × الحصص، الخانة = رمز الشعبة، وآخر عمود = مجموع الحصص

import { esc, tr, t as tf } from "./app.js?v=202611151929";

const SUBJ_ORDER = [/إسلامي|اسلامي|قرآن|قران/, /عربي/, /إنجليز|انجليز|انقليز/, /رياضيات/, /فيزياء/, /كيمياء/, /أحياء|احياء/, /علوم/,
  /اجتماعي|تاريخ|جغرافيا|وطن/, /تقني|حاسوب|حاسب|معلومات/, /رياضة|بدني/, /فنون|فني|تشكيلي/, /موسيق/, /مهارات/];
const rank = n => { const i = SUBJ_ORDER.findIndex(r => r.test(n || "")); return i < 0 ? 99 : i; };
const abbr = n => String(n || "").replace(/^(ال|مادة\s+)/, "").replace(/^ال/, "").slice(0, 3);

// يجهّز الصفوف مجمّعة حسب المادة الأساسية لكل معلم
export function generalModel({ lessons, teachers, subjects, days, P }) {
  const placed = (lessons || []).filter(x => x.d != null && x.p != null && x.d < days.length && x.p < P);
  const subj = new Map(subjects.map((s, i) => [s.id, { ...s, i }]));
  const byT = new Map();
  for (const x of placed) { if (!byT.has(x.t)) byT.set(x.t, []); byT.get(x.t).push(x); }
  const rows = [];
  for (const t of teachers) {
    const list = byT.get(t.id); if (!list?.length) continue;
    const cnt = {}; list.forEach(x => (cnt[x.s] = (cnt[x.s] || 0) + 1));
    const ids = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a]);
    const main = subj.get(ids[0]);
    const cells = new Map();
    for (const x of list) { const k = x.d * P + x.p; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(x); }
    rows.push({ id: t.id, name: t.name || "", main, multi: ids.length > 1, cells, total: list.length });
  }
  rows.sort((a, b) => rank(a.main?.name) - rank(b.main?.name) || (a.main?.i ?? 999) - (b.main?.i ?? 999)
    || (a.main?.name || "").localeCompare(b.main?.name || "", "ar") || a.name.localeCompare(b.name, "ar"));
  const groups = [];
  for (const r of rows) {
    const g = r.main?.name || tr("أخرى");
    if (!groups.length || groups.at(-1).name !== g) groups.push({ name: g, color: r.main?.color, rows: [] });
    groups.at(-1).rows.push(r);
  }
  return { groups, count: rows.length, lessons: placed.length };
}

const cellHTML = (r, k, secLabel, subjName) => {
  const list = r.cells.get(k);
  if (!list) return "";
  return list.map(x => `${esc(secLabel(x.c))}${r.multi ? `<i>${esc(abbr(subjName(x.s)))}</i>` : ""}`).join("<br>");
};

// جدول HTML (للشاشة أو للطباعة)
export function generalTable(m, { days, P, secLabel, subjName, highlight = null, groups = m.groups, showHead = true }) {
  const dayHead = days.map(d => `<th colspan="${P}" class="g-day">${esc(d)}</th>`).join("");
  const perHead = days.map((_, d) => Array.from({ length: P }, (_, p) => `<th class="g-p ${p === 0 ? "dstart" : ""}" data-col="${d * P + p}">${p + 1}</th>`).join("")).join("");
  const body = groups.map(g => `<tr class="g-grp"><td colspan="${days.length * P + 2}"><span style="--c:${esc(g.color || "#64748b")}"></span>${esc(g.name)} <small>(${g.rows.length})</small></td></tr>
    ${g.rows.map(r => `<tr class="g-row ${r.id === highlight ? "me" : ""}" data-tid="${esc(r.id)}"><th class="g-name" data-no-i18n>${esc(r.name)}</th>${
      days.map((_, d) => Array.from({ length: P }, (_, p) => { const k = d * P + p, c = cellHTML(r, k, secLabel, subjName);
        return `<td class="${p === 0 ? "dstart" : ""}${c ? " on" : ""}" data-col="${k}">${c}</td>`; }).join("")).join("")
    }<td class="g-tot">${r.total}</td></tr>`).join("")}`).join("");
  return `<table class="gtt">${showHead ? `<thead><tr><th rowspan="2" class="g-name">${tr("المعلم")}</th>${dayHead}<th rowspan="2" class="g-tot">${tr("المجموع")}</th></tr><tr>${perHead}</tr></thead>` : ""}<tbody>${body}</tbody></table>`;
}

// ---------- PDF بحجم A3 بالطول ----------
const loadScript = src => new Promise((res, rej) => {
  if ([...document.scripts].some(s => s.src === src)) return res();
  const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s);
});

function pageHTML(m, opt, groups, pageNo, pages) {
  const rows = groups.reduce((a, g) => a + g.rows.length + 1, 0);
  // صفحة A3 بالطول: العرض 1700px ⇒ الارتفاع ≈ 2400px؛ نوزّع الارتفاع على الصفوف
  const rh = Math.max(18, Math.min(40, Math.floor((2400 - 230) / (rows + 2))));
  const fs = Math.max(10, Math.min(17, Math.round(rh * 0.52)));
  return `<div class="gp-page" style="--fs:${fs}px;--rh:${rh}px">
    <div class="gp-head"><div><h1>${tr("الجدول العام للمعلمين")}</h1><b>${esc(opt.school || "")}</b></div>
      <img src="${new URL("img/icon-96.png", import.meta.url).href}" alt=""></div>
    ${generalTable(m, { ...opt, groups, highlight: null })}
    <div class="gp-foot"><span>${esc(tf("آخر تحديث: {0}", opt.stamp || ""))}</span><span>${pages > 1 ? esc(tf("صفحة {0} من {1}", pageNo, pages)) : ""}</span><span>${tr("مُنسِّق")}</span></div>
  </div>`;
}

// تقسيم الصفوف على صفحات (حتى ~95 سطرًا في الصفحة) دون قطع المجموعة إن أمكن
function paginate(groups, max = 95) {
  const pages = [[]]; let used = 0;
  for (const g of groups) {
    let rest = g.rows;
    while (rest.length) {
      const room = max - used - 1;
      if (room < 4 && used) { pages.push([]); used = 0; continue; }
      const take = rest.slice(0, room);
      pages.at(-1).push({ ...g, rows: take }); used += take.length + 1; rest = rest.slice(take.length);
      if (rest.length) { pages.push([]); used = 0; }
    }
  }
  return pages.filter(p => p.length);
}

export async function downloadGeneralPDF(m, opt, filename) {
  await Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js")
  ]);
  if (document.fonts?.ready) await document.fonts.ready;
  const pages = paginate(m.groups);
  const host = document.createElement("div");
  host.className = "gp-render";
  host.innerHTML = pages.map((g, i) => pageHTML(m, opt, g, i + 1, pages.length)).join("");
  document.body.appendChild(host);
  try {
    const pdf = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a3", compress: true });
    const W = 297, H = 420, mg = 7;
    const els = [...host.querySelectorAll(".gp-page")];
    for (let i = 0; i < els.length; i++) {
      const canvas = await window.html2canvas(els[i], { scale: 2, backgroundColor: "#ffffff", logging: false, useCORS: true });
      const r = Math.min((W - 2 * mg) / canvas.width, (H - 2 * mg) / canvas.height);
      const w = canvas.width * r, h = canvas.height * r;
      if (i) pdf.addPage("a3", "portrait");
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (W - w) / 2, mg, w, h);
    }
    pdf.save(String(filename || "general").replace(/[\\/:*?"<>|]+/g, " ").trim() + ".pdf");
  } finally { host.remove(); }
}

// تفاعل الشاشة: البحث، تمييز المعلم، وإظهار الفارغين في حصة معيّنة
export function bindGeneral(root, { onRow } = {}) {
  const table = root.querySelector(".gtt"); if (!table) return;
  const q = root.querySelector("[data-gsearch]");
  const norm = s => String(s || "").replace(/[ىي]/g, "ي").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/[ً-ْ]/g, "").toLowerCase();
  if (q) q.oninput = () => {
    const v = norm(q.value.trim());
    table.querySelectorAll("tr.g-row").forEach(tr => tr.classList.toggle("hide", !!v && !norm(tr.textContent).includes(v)));
    table.querySelectorAll("tr.g-grp").forEach(g => {
      let n = g.nextElementSibling, any = false;
      while (n && n.classList.contains("g-row")) { if (!n.classList.contains("hide")) any = true; n = n.nextElementSibling; }
      g.classList.toggle("hide", !any);
    });
  };
  let col = null;
  table.addEventListener("click", e => {
    const h = e.target.closest("th.g-p");
    if (h) {
      const c = h.dataset.col === col ? null : h.dataset.col; col = c;
      table.querySelectorAll(".free,.colsel").forEach(x => x.classList.remove("free", "colsel"));
      if (c != null) {
        h.classList.add("colsel");
        table.querySelectorAll(`td[data-col="${c}"]`).forEach(td => { if (!td.classList.contains("on")) td.classList.add("free"); });
      }
      root.querySelector("[data-gfree]")?.classList.toggle("hidden", c == null);
      if (c != null && root.querySelector("[data-gfree]")) root.querySelector("[data-gfree]").textContent = tf("الخانات الخضراء = معلمون فارغون في هذه الحصة ({0})", table.querySelectorAll("td.free").length);
      return;
    }
    const row = e.target.closest("tr.g-row");
    if (row) { table.querySelectorAll("tr.g-row.sel").forEach(r => r !== row && r.classList.remove("sel")); row.classList.toggle("sel"); onRow?.(row.dataset.tid); }
  });
}
