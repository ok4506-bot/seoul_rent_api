// 공용 유틸 — 자치구/법정동 목록, API 호출(서버 프록시), 포맷, 통계, 테마
export const TYPES = ["아파트", "연립다세대", "오피스텔", "단독다가구"];
export const YEARS = [2024, 2025, 2026];
export const PYEONG = 3.305785; // 1평(3.3㎡)

// 임대면적(㎡) 구간 — 3D 보드의 x축
export const AREA_BANDS = [
  { label: "20㎡ 미만", short: "~20", min: 0, max: 20 },
  { label: "20–40㎡", short: "20–40", min: 20, max: 40 },
  { label: "40–60㎡", short: "40–60", min: 40, max: 60 },
  { label: "60–85㎡", short: "60–85", min: 60, max: 85 },
  { label: "85–102㎡", short: "85–102", min: 85, max: 102 },
  { label: "102–135㎡", short: "102–135", min: 102, max: 135 },
  { label: "135㎡ 이상", short: "135~", min: 135, max: Infinity },
];
export const bandIndex = (a) => AREA_BANDS.findIndex((b) => a >= b.min && a < b.max);

// ── 자치구·법정동 ──
let districtsP;
export const loadDistricts = () => (districtsP ||= fetch("data/districts.json").then((r) => r.json()));

export function fillGuSelect(sel, districts, value) {
  sel.innerHTML = districts.map((g) => `<option value="${g.code}">${g.name}</option>`).join("");
  if (value) sel.value = value;
}
export function fillDongSelect(sel, gu, value) {
  const opts = [`<option value="">전체 (구 전체)</option>`].concat(
    (gu?.dongs || []).map((d) => `<option value="${d.code}">${d.name}</option>`),
  );
  sel.innerHTML = opts.join("");
  sel.value = gu?.dongs.some((d) => d.code === value) ? value : "";
}

// ── 서버 프록시 호출 (브라우저는 API 키를 모름) ──
export async function fetchAll(kind, q, onProgress) {
  const base = new URLSearchParams({ gu: q.gu, dong: q.dong || "", type: q.type || "", year: String(q.year) });
  const get = async (part, uf) => {
    const p = new URLSearchParams(base);
    p.set("part", String(part));
    if (uf) p.set("uf", uf);
    const res = await fetch(`api/${kind}?${p}`, { headers: { Accept: "application/json" } });
    let body;
    try {
      body = await res.json();
    } catch {
      throw new Error(`서버 응답을 읽지 못했습니다 (HTTP ${res.status})`);
    }
    if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
    return { body, cache: res.headers.get("X-Cache") };
  };
  const first = await get(0);
  const parts = first.body.parts;
  onProgress?.(1, parts);
  const all = [first.body];
  for (let part = 1; part < parts; part++) {
    all.push((await get(part, first.body.uf)).body);
    onProgress?.(part + 1, parts);
  }
  const f = first.body.fields;
  const rows = [];
  for (const b of all) {
    for (const a of b.rows) {
      const o = { rcptYear: q.year };
      for (let i = 0; i < f.length; i++) o[f[i]] = a[i];
      rows.push(o);
    }
  }
  return { rows, total: first.body.total, parts, fetchedAt: first.body.fetchedAt, cache: first.cache };
}

// ── 포맷 ──
export const nf = new Intl.NumberFormat("ko-KR");
export const nf1 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const nf2 = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
export const ok = (v) => v != null && Number.isFinite(v);

/** 만원 단위 금액 → "5억 2,340만원" */
export function won(man, suffix = "원") {
  if (!ok(man)) return "–";
  const v = Math.round(man);
  const eok = Math.floor(Math.abs(v) / 10000) * Math.sign(v);
  const rest = Math.abs(v) % 10000;
  if (eok && rest) return `${eok}억 ${nf.format(rest)}만${suffix}`;
  if (eok) return `${eok}억${suffix}`;
  return `${nf.format(rest)}만${suffix}`;
}
/** 짧은 억 단위 "5.2억" */
export const eok = (man) => (ok(man) ? `${nf1.format(man / 10000)}억` : "–");
export const pct = (v, digits = 1) => (ok(v) ? `${v > 0 ? "+" : ""}${v.toFixed(digits)}%` : "–");
export const arrow = (v) => (!ok(v) ? "" : v > 0.05 ? "▲" : v < -0.05 ? "▼" : "■");
export const ym = (key) => `${key.slice(0, 4)}.${key.slice(4, 6)}`;
export const ymKo = (key) => `${key.slice(0, 4)}년 ${Number(key.slice(4, 6))}월`;
export const fmtDay = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d || "–");
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ── 통계 ──
export function mean(arr) {
  let s = 0, n = 0;
  for (const v of arr) if (ok(v)) { s += v; n++; }
  return n ? s / n : null;
}
export function median(arr) {
  const a = arr.filter(ok).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export const change = (now, before) => (ok(now) && ok(before) && before !== 0 ? ((now - before) / before) * 100 : null);

// ── 테마 ──
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
export function seqRamp(name = "--seq") {
  return cssVar(name).split(",").map((s) => s.trim()).filter(Boolean);
}
export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}
export function initTheme(button, onChange) {
  try {
    const saved = localStorage.getItem("seoul-rent-theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch {}
  const paint = () => {
    button.textContent = isDark() ? "☀" : "☾";
    button.setAttribute("aria-label", isDark() ? "밝은 화면으로" : "어두운 화면으로");
  };
  paint();
  button.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("seoul-rent-theme", next); } catch {}
    paint();
    onChange();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { paint(); onChange(); });
}

/** ECharts 2D 공통 테마 조각 */
export function axisStyle() {
  const muted = cssVar("--muted"), grid = cssVar("--grid"), axis = cssVar("--axis");
  return {
    axisLine: { lineStyle: { color: axis } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontSize: 11 },
    splitLine: { lineStyle: { color: grid } },
    nameTextStyle: { color: muted, fontSize: 11 },
  };
}
export function tooltipStyle() {
  return {
    backgroundColor: cssVar("--surface"),
    borderColor: cssVar("--border"),
    textStyle: { color: cssVar("--ink"), fontSize: 12 },
    extraCssText: "box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:10px;",
  };
}

export function setStatus(el, state, html) {
  el.dataset.state = state;
  el.innerHTML = `<span class="dot" aria-hidden="true"></span><span>${html}</span>`;
}

// 메인 보드 ↔ 실거래가 창 연동
export const channel = "BroadcastChannel" in window ? new BroadcastChannel("seoul-rent-board") : null;

export function readParams() {
  const p = new URLSearchParams(location.search);
  return Object.fromEntries(p.entries());
}
export function writeParams(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== "" && v != null) p.set(k, v);
  history.replaceState(null, "", `${location.pathname}?${p}`);
}

/** 정렬 가능한 표 */
export function sortableTable(table, getRows, renderBody) {
  let key = null, dir = -1;
  table.querySelectorAll("th[data-key]").forEach((th) => {
    th.classList.add("sortable");
    th.tabIndex = 0;
    const go = () => {
      const k = th.dataset.key;
      dir = key === k ? -dir : -1;
      key = k;
      table.querySelectorAll("th[data-key]").forEach((o) => o.removeAttribute("aria-sort"));
      th.setAttribute("aria-sort", dir > 0 ? "ascending" : "descending");
      const rows = getRows().slice().sort((a, b) => {
        const x = a[k], y = b[k];
        if (x == null || x === "") return 1;
        if (y == null || y === "") return -1;
        return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "ko")) * dir;
      });
      renderBody(rows);
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go()));
  });
}
