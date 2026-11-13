// الترجمة: عربي / English
// النصوص مكتوبة بالعربي في الصفحات، وعند اختيار الإنجليزية تُستبدل تلقائيًا من القاموس EN
import { EN } from "./i18n-en.js";

const KEY = "lang";
let saved = "ar";
try { saved = localStorage.getItem(KEY) || "ar"; } catch (e) {}
export const lang = saved === "en" ? "en" : "ar";
export const isEn = lang === "en";

const AR_RE = /[؀-ۿ]/;
// يفصل الرموز والأرقام في البداية والنهاية عن النص العربي
const SPLIT_RE = /^([^؀-ۿ]*)([\s\S]*?)([^؀-ۿ]*)$/;

// ترجمة نص كامل (أو مع رموز/أرقام في طرفيه)
export function tr(text) {
  if (!isEn || text == null) return text;
  const s = String(text);
  if (!AR_RE.test(s)) return s;
  const k = s.trim();
  if (EN[k] !== undefined) return s.replace(k, EN[k]);
  const m = k.match(SPLIT_RE);
  if (m && EN[m[2]] !== undefined) return s.replace(k, m[1] + EN[m[2]] + m[3]);
  if (window.__I18N_DEBUG) (window.__missing ||= new Set()).add(k);
  return s;
}

// قالب مع متغيرات: t("حذف «{0}»؟", name)
export function t(str, ...args) {
  const base = isEn && EN[str] !== undefined ? EN[str] : str;
  return base.replace(/\{(\d+)\}/g, (_, i) => args[i] ?? "");
}

const ATTRS = ["placeholder", "title", "aria-label"];
export function translateDOM(root) {
  if (!isEn || !root) return;
  if (root.nodeType === 3) { const v = tr(root.nodeValue); if (v !== root.nodeValue) root.nodeValue = v; return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.parentElement && n.parentElement.closest("script,style,[data-no-i18n]")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) { const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
  if (root.querySelectorAll) {
    const els = [root.nodeType === 1 ? root : null, ...root.querySelectorAll("[placeholder],[title],[aria-label]")].filter(Boolean);
    for (const el of els) for (const a of ATTRS) if (el.hasAttribute?.(a)) {
      const v = tr(el.getAttribute(a)); if (v !== el.getAttribute(a)) el.setAttribute(a, v);
    }
  }
}

export function setLang(l) {
  try { localStorage.setItem(KEY, l); } catch (e) {}
  location.reload();
}

let started = false;
export function initI18n() {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = isEn ? "ltr" : "rtl";
  document.querySelectorAll("[data-lang-toggle]").forEach(b => {
    b.textContent = isEn ? "العربية" : "English";
    b.setAttribute("data-no-i18n", "");
    b.onclick = () => setLang(isEn ? "ar" : "en");
  });
  if (isEn && !started) {
    started = true;
    translateDOM(document.body);
    document.title = tr(document.title);
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) translateDOM(n);
    }).observe(document.body, { childList: true, subtree: true });
  }
  html.classList.remove("i18n-pending");
}
