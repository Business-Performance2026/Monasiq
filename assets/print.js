// تصميم ورقة الجدول (طباعة + تحميل PDF) — يُستخدم في لوحة المدرسة ولوحة المعلم
import { APP_NAME, esc, tr, isEn } from "./app.js?v=202611140043";

const DAY_EN = { "الأحد": "Sunday", "الاثنين": "Monday", "الثلاثاء": "Tuesday", "الأربعاء": "Wednesday", "الخميس": "Thursday", "الجمعة": "Friday", "السبت": "Saturday" };
const dayLabel = d => isEn ? (DAY_EN[d] || d) : d;
const L = s => tr(s);

// مزج اللون مع الأبيض (بدون color-mix ليعمل مع التحميل كصورة)
export function tint(hex, a) {
  const h = String(hex || "#64748b").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const m = v => Math.round(v * a + 255 * (1 - a));
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

/**
 * sheet = { kind: "teacher"|"section", title, school, days:[names], periods:[{start,end}],
 *           cells: Map("d.p" -> {main, sub, color}), stats:[{label,value}], legend:[{name,color,count}] }
 */
export function sheetHTML(sh, compact = false) {
  const P = sh.periods.length;
  const head = Array.from({ length: P }, (_, p) => {
    const t = sh.periods[p] || {};
    return `<th class="sh-ph"><span class="sh-pn">${p + 1}</span><small>${esc(t.start || "")}${t.end ? " - " + esc(t.end) : ""}</small></th>`;
  }).join("");
  const rows = sh.days.map((dn, d) => `<tr><th class="sh-dh"><span>${esc(dayLabel(dn))}</span></th>${Array.from({ length: P }, (_, p) => {
    const c = sh.cells.get(`${d}.${p}`);
    if (!c) return `<td class="sh-c sh-empty"></td>`;
    if (c.blocked) return `<td class="sh-c"><div class="sh-l sh-blk"><small>🔒 ${esc(c.main)}</small></div></td>`;
    return `<td class="sh-c"><div class="sh-l" style="background:${tint(c.color, .16)};border-color:${c.color}"><b style="color:${tint(c.color, .95)}">${esc(c.main)}</b><small>${esc(c.sub || "")}</small></div></td>`;
  }).join("")}</tr>`).join("");
  const kindLabel = sh.kind === "teacher" ? L("جدول المعلم") : L("جدول الشعبة");
  return `<div class="sheet ${compact ? "compact" : ""}" dir="${isEn ? "ltr" : "rtl"}" data-no-i18n>
    <div class="sh-head">
      <div class="sh-brand"><span class="sh-logo"><i></i><i></i><i></i><i></i></span><div><small>${esc(kindLabel)}</small><h2>${esc(sh.title)}</h2></div></div>
      <div class="sh-stats">${(sh.stats || []).map(s => `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join("")}</div>
    </div>
    <table class="sh-grid"><thead><tr><th class="sh-corner"></th>${head}</tr></thead><tbody>${rows}</tbody></table>
    <div class="sh-foot">
      <div class="sh-legend">${(sh.legend || []).map(x => `<span><i style="background:${x.color}"></i>${esc(x.name)} <em>${x.count}</em></span>`).join("")}</div>
      <div class="sh-meta">${esc(sh.school || "")} · ${esc(APP_NAME)} · ${new Date().toLocaleDateString(isEn ? "en-GB" : "ar-OM")}</div>
    </div>
  </div>`;
}

// طباعة (أو حفظ PDF من نافذة الطباعة): ورقة واحدة أو ورقتان في الصفحة
export function printSheets(sheets, perPage = 1) {
  let pa = document.getElementById("printArea");
  if (!pa) { pa = document.createElement("div"); pa.id = "printArea"; document.body.appendChild(pa); }
  let html = "";
  for (let i = 0; i < sheets.length; i += perPage)
    html += `<div class="ppage ${perPage === 2 ? "two" : ""}">${sheets.slice(i, i + perPage).map(s => sheetHTML(s, perPage === 2)).join("")}</div>`;
  pa.innerHTML = html;
  setTimeout(() => window.print(), 350);
}

// تحميل ملف PDF مباشرة (صفحة A4 أفقية لكل جدول)
const libs = {};
function loadScript(src) {
  return libs[src] ||= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load " + src));
    document.head.appendChild(s);
  });
}
async function buildPdf(sheets) {
  await Promise.all([
    loadScript("https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"),
    loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js")
  ]);
  if (document.fonts?.ready) await document.fonts.ready;
  const host = document.createElement("div");
  host.className = "sheet-render";
  document.body.appendChild(host);
  const pdf = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  try {
    for (let i = 0; i < sheets.length; i++) {
      host.innerHTML = sheetHTML(sheets[i]);
      const el = host.firstElementChild;
      const canvas = await window.html2canvas(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const img = canvas.toDataURL("image/jpeg", 0.9);
      const W = 297, H = 210, m = 8;
      const r = Math.min((W - 2 * m) / canvas.width, (H - 2 * m) / canvas.height);
      const w = canvas.width * r, h = canvas.height * r;
      if (i) pdf.addPage();
      pdf.addImage(img, "JPEG", (W - w) / 2, (H - h) / 2, w, h);
    }
    return pdf;
  } finally { host.remove(); }
}
const safeName = n => String(n).replace(/[\\/:*?"<>|]+/g, "-").trim();
export async function downloadSheetsPDF(sheets, filename) {
  (await buildPdf(sheets)).save(safeName(filename) + ".pdf");
}
export async function sheetsPdfFile(sheets, filename) {
  const blob = (await buildPdf(sheets)).output("blob");
  return new File([blob], safeName(filename) + ".pdf", { type: "application/pdf" });
}

// بناء ورقة من بيانات الجدول
export function buildSheet({ kind, ownerId, title, school, settings, lessons, subjectOf, sectionLabel, teacherName, blocked, P }) {
  const cells = new Map(), legend = new Map(), secs = new Set();
  if (blocked) blocked.forEach((label, sl) => cells.set(`${Math.floor(sl / P)}.${sl % P}`, { main: label, sub: "", color: "#94a3b8", blocked: true }));
  const mine = lessons.filter(x => x.d != null && (kind === "teacher" ? x.t : x.c) === ownerId);
  for (const x of mine) {
    const sb = subjectOf(x.s);
    cells.set(`${x.d}.${x.p}`, {
      main: kind === "teacher" ? sectionLabel(x.c) : (sb?.name || "؟"),
      sub: kind === "teacher" ? (sb?.name || "") : teacherName(x.t),
      color: sb?.color || "#64748b"
    });
    const k = sb?.name || "؟";
    if (!legend.has(k)) legend.set(k, { name: k, color: sb?.color || "#64748b", count: 0 });
    legend.get(k).count++;
    secs.add(kind === "teacher" ? x.c : x.t);
  }
  const perDay = settings.days.map((_, d) => mine.filter(x => x.d === d).length);
  const stats = [{ label: L("حصة أسبوعيًا"), value: mine.length }];
  if (kind === "teacher") stats.push({ label: L("شعبة"), value: secs.size });
  else stats.push({ label: L("معلم"), value: secs.size });
  stats.push({ label: L("أكثر يوم"), value: Math.max(0, ...perDay) });
  return { kind, title, school, days: settings.days, periods: settings.periods, cells, stats, legend: [...legend.values()].sort((a, b) => b.count - a.count) };
}
