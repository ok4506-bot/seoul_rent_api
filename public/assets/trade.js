// 실거래가 창: /api/trade (서버 프록시) → 매매 실거래가 요약·분포·순위·목록
import {
  PYEONG, RECENT_NOTE, axisStyle, isRecentMonth, splitProvisional, change, channel, cssVar, eok, esc, fetchAll, fillDongSelect, fillGuSelect, fmtDay,
  initTheme, loadDistricts, mean, median, nf, nf1, ok, readParams, setStatus, sortableTable, tooltipStyle,
  won, writeParams, ym, ymKo,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const el = { form: $("filters"), gu: $("gu"), dong: $("dong"), year: $("year"), go: $("go"), status: $("status"), q: $("q") };
const state = { districts: [], gu: "11680", dong: "10100", type: "아파트", year: 2026, jpm: null, jpmKey: "", rows: [], seq: 0 };
const charts = { scatter: echarts.init($("scatter")), trend: echarts.init($("trend")), counts: echarts.init($("counts")), rank: echarts.init($("rank")) };
new ResizeObserver(() => Object.values(charts).forEach((c) => c.resize())).observe(document.body);

// 주택유형 색: 앞의 세 칸은 범주 팔레트, 단독다가구는 회색 + 다른 모양(색만으로 구분하지 않음)
const TYPE_STYLE = {
  아파트: { color: "--series-1", symbol: "circle" },
  연립다세대: { color: "--series-2", symbol: "triangle" },
  오피스텔: { color: "--series-3", symbol: "rect" },
  단독다가구: { color: "--series-other", symbol: "diamond" },
};
const selKey = (s) => `${s.gu}|${s.dong}|${s.type}|${s.year}`;

init();
async function init() {
  initTheme($("themeBtn"), () => render());
  state.districts = await loadDistricts();
  const p = readParams();
  if (p.gu && state.districts.some((g) => g.code === p.gu)) {
    state.gu = p.gu; state.dong = p.dong || ""; state.type = p.type || "";
  }
  if (["2024", "2025", "2026"].includes(p.year)) state.year = Number(p.year);
  if (p.jpm && ok(Number(p.jpm))) { state.jpm = Number(p.jpm); state.jpmKey = selKey(state); }
  applyToForm();

  el.gu.addEventListener("change", () => fillDongSelect(el.dong, guObj(el.gu.value), ""));
  el.form.addEventListener("submit", (e) => { e.preventDefault(); load(); });
  document.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener("change", () => load()));
  el.year.addEventListener("change", () => load());
  el.q.addEventListener("input", () => renderList(filtered()));
  sortableTable($("list"), () => filtered(), (rows) => renderList(rows, true));

  channel?.addEventListener("message", (e) => {
    const d = e.data;
    if (d?.kind !== "selection" || !$("sync").checked) return;
    Object.assign(state, { gu: d.gu, dong: d.dong, type: d.type, year: d.year || state.year });
    state.jpm = ok(d.jpm) ? d.jpm : null;
    state.jpmKey = selKey(state);
    applyToForm();
    load();
  });
  load();
}

const guObj = (code = state.gu) => state.districts.find((g) => g.code === code);
function applyToForm() {
  fillGuSelect(el.gu, state.districts, state.gu);
  fillDongSelect(el.dong, guObj(), state.dong);
  document.querySelectorAll('input[name="type"]').forEach((r) => (r.checked = r.value === state.type));
  el.year.value = String(state.year);
}
function scopeLabel() {
  const g = guObj();
  const d = state.dong ? g?.dongs.find((x) => x.code === state.dong)?.name : "전체";
  return `${g?.name || ""} ${d} · ${state.type || "전체 유형"} · ${state.year}년`;
}

async function load() {
  state.gu = el.gu.value; state.dong = el.dong.value;
  state.type = document.querySelector('input[name="type"]:checked').value;
  state.year = Number(el.year.value);
  writeParams({ gu: state.gu, dong: state.dong, type: state.type, year: state.year, jpm: state.jpmKey === selKey(state) && ok(state.jpm) ? state.jpm.toFixed(1) : "" });
  $("backLink").href = `./?${new URLSearchParams({ gu: state.gu, dong: state.dong, type: state.type, years: String(state.year) })}`;

  const seq = ++state.seq;
  el.go.disabled = true;
  setStatus(el.status, "loading", `${esc(scopeLabel())} 실거래 자료를 서울시 API에서 받는 중…`);
  try {
    const r = await fetchAll("trade", state, (p, n) => n > 1 && setStatus(el.status, "loading", `${esc(scopeLabel())} 받는 중… (${p}/${n} 묶음)`));
    if (seq !== state.seq) return;
    state.rows = r.rows
      .filter((x) => ok(x.amount) && x.amount > 0 && ok(x.area) && x.area > 0 && x.day?.length === 8)
      .map((x) => ({ ...x, perM2: x.amount / x.area }));
    render();
    const t = new Date(r.fetchedAt || Date.now()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    setStatus(el.status, state.rows.length ? "ok" : "error", state.rows.length
      ? `${esc(scopeLabel())} · 매매 <b>${nf.format(state.rows.length)}</b>건 · 서울시 API 기준 ${t}${r.cache === "HIT" ? " (엣지 캐시)" : ""}`
      : `${esc(scopeLabel())}: 신고된 매매 거래가 없습니다.`);
  } catch (e) {
    if (seq === state.seq) setStatus(el.status, "error", esc(e.message));
  } finally {
    if (seq === state.seq) el.go.disabled = false;
  }
}

function filtered() {
  const q = el.q.value.trim();
  return q ? state.rows.filter((r) => (r.bldg || "").includes(q) || (r.dong || "").includes(q)) : state.rows;
}

function render() {
  renderKpis();
  renderScatter();
  renderTrend();
  renderRank();
  renderList(filtered());
}

function renderKpis() {
  const rows = state.rows;
  const has = rows.length > 0;
  const avg = mean(rows.map((r) => r.amount)), med = median(rows.map((r) => r.amount));
  const m2 = mean(rows.map((r) => r.perM2));
  $("kAvgLabel").textContent = `${state.year}년 평균 거래가`;
  $("kAvg").textContent = has ? won(avg) : "–";
  $("kAvgSub").textContent = has ? `중위 ${won(med)} · 평균 ${nf1.format(mean(rows.map((r) => r.area)))}㎡` : "거래 없음";
  $("kM2").innerHTML = has ? `${nf.format(Math.round(m2))}<span class="unit">만원/㎡</span>` : "–";
  $("kM2Sub").textContent = has ? `3.3㎡(평)당 ${won(m2 * PYEONG)}` : " ";
  $("kN").innerHTML = has ? `${nf.format(rows.length)}<span class="unit">건</span>` : "–";
  const direct = rows.filter((r) => r.dealType === "직거래").length;
  $("kNSub").textContent = has ? `직거래 ${nf1.format((direct / rows.length) * 100)}% · ${state.dong ? "동" : "자치구"} 기준` : " ";

  const valid = state.jpmKey === selKey(state) && ok(state.jpm) && ok(m2);
  $("kRatio").innerHTML = valid ? `${nf1.format((state.jpm / m2) * 100)}<span class="unit">%</span>` : "–";
  $("kRatioSub").textContent = valid
    ? `㎡당 전세 ${nf.format(Math.round(state.jpm))} ÷ 매매 ${nf.format(Math.round(m2))}만원`
    : "메인 보드에서 같은 조건으로 열면 계산";
  $("jpmHint").textContent = valid ? "전세가율은 메인 보드의 ㎡당 전세가와 함께 계산했습니다." : " ";

  const top = rows.reduce((a, b) => (!a || b.amount > a.amount ? b : a), null);
  $("kTop").textContent = top ? won(top.amount) : "–";
  $("kTopSub").textContent = top ? `${top.bldg || top.dong} · ${nf1.format(top.area)}㎡ · ${fmtDay(top.day)}` : " ";
}

function renderScatter() {
  const ax = axisStyle(), muted = cssVar("--muted"), surface = cssVar("--surface");
  const types = [...new Set(state.rows.map((r) => r.usage))].filter(Boolean)
    .sort((a, b) => Object.keys(TYPE_STYLE).indexOf(a) - Object.keys(TYPE_STYLE).indexOf(b));
  const big = state.rows.length > 4000;
  charts.scatter.setOption({
    animation: !big,
    grid: { left: 56, right: 20, top: 36, bottom: 40 },
    legend: { top: 0, right: 0, textStyle: { color: cssVar("--ink-2"), fontSize: 12 }, itemWidth: 12, itemHeight: 12 },
    tooltip: { ...tooltipStyle(), trigger: "item",
      formatter: (p) => { const r = p.data.r; return `<b>${esc(r.bldg || r.dong)}</b> · ${esc(r.dong)}<br>${fmtDay(r.day)} · ${nf1.format(r.area)}㎡ · ${r.floor ?? "–"}층<br>거래가 <b>${won(r.amount)}</b><br><span style="color:${muted}">㎡당 ${nf.format(Math.round(r.perM2))}만원</span>`; } },
    dataZoom: [{ type: "inside", xAxisIndex: 0 }, { type: "inside", yAxisIndex: 0 }],
    xAxis: { type: "value", name: "면적(㎡)", nameLocation: "middle", nameGap: 26, scale: true, ...ax },
    yAxis: { type: "value", name: "거래가(억원)", scale: true, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v) => nf1.format(v) } },
    series: types.map((t) => {
      const st = TYPE_STYLE[t] || TYPE_STYLE.단독다가구;
      const color = cssVar(st.color);
      return {
        name: t, type: "scatter", symbol: st.symbol, symbolSize: big ? 5 : 8, large: big,
        itemStyle: { color, opacity: 0.78, borderColor: surface, borderWidth: big ? 0 : 1 },
        emphasis: { itemStyle: { opacity: 1, borderWidth: 2 } },
        data: state.rows.filter((r) => r.usage === t).map((r) => ({ value: [r.area, +(r.amount / 10000).toFixed(3)], r })),
      };
    }),
  }, true);
}

function monthly() {
  const map = new Map();
  for (const r of state.rows) {
    if (Number(r.day.slice(0, 4)) !== state.year) continue;
    const k = r.day.slice(0, 6);
    const a = map.get(k) || { s: 0, n: 0 };
    a.s += r.perM2; a.n++;
    map.set(k, a);
  }
  const keys = [...map.keys()].sort();
  return keys.map((k) => ({ k, v: map.get(k).s / map.get(k).n, n: map.get(k).n }));
}

function renderTrend() {
  const ax = axisStyle(), color = cssVar("--series-1"), muted = cssVar("--muted");
  const mon = monthly();
  const xs = mon.map((d) => ym(d.k));
  const line = splitProvisional(mon.map((d) => d.k), mon.map((d) => Math.round(d.v)));
  charts.trend.setOption({
    grid: { left: 56, right: 16, top: 12, bottom: 26 },
    tooltip: { ...tooltipStyle(), trigger: "axis", formatter: (ps) => { const i = (ps.find((x) => x.value != null) || ps[0]).dataIndex; const d = mon[i]; const prev = mon[i - 1];
      const ch = prev ? change(d.v, prev.v) : null;
      return `${ymKo(d.k)}<br>㎡당 <b>${nf.format(Math.round(d.v))}</b>만원${ch == null ? "" : ` (전월 ${ch > 0 ? "+" : ""}${ch.toFixed(1)}%)`}<br><span style="color:${muted}">${nf.format(d.n)}건${isRecentMonth(d.k) ? `<br>${RECENT_NOTE}` : ""}</span>`; } },
    xAxis: { type: "category", data: xs, boundaryGap: false, ...ax, splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v) => nf.format(v) } },
    series: [{ type: "line", data: line.solid, smooth: 0.25, connectNulls: true, symbol: "circle", symbolSize: 8,
      lineStyle: { width: 2, color }, itemStyle: { color, borderColor: cssVar("--surface"), borderWidth: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + "33" }, { offset: 1, color: color + "00" }]) } },
    { type: "line", data: line.dashed, smooth: 0.25, connectNulls: true, symbol: "emptyCircle", symbolSize: 7,
      lineStyle: { width: 2, color, type: [4, 4] }, itemStyle: { color, borderColor: color } }],
  }, true);
  charts.counts.setOption({
    grid: { left: 56, right: 16, top: 8, bottom: 26 },
    tooltip: { ...tooltipStyle(), trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => `${ymKo(mon[ps[0].dataIndex].k)}<br>거래 <b>${nf.format(ps[0].value)}</b>건${isRecentMonth(mon[ps[0].dataIndex].k) ? `<br><span style="color:${muted}">${RECENT_NOTE}</span>` : ""}` },
    xAxis: { type: "category", data: xs, ...ax, splitLine: { show: false } },
    yAxis: { type: "value", ...ax, splitNumber: 3 },
    series: [{ type: "bar", barMaxWidth: 18, data: mon.map((d) => {
      const recent = isRecentMonth(d.k);
      return { value: d.n, itemStyle: { color, opacity: recent ? 0.38 : 0.85, borderRadius: [4, 4, 0, 0], borderType: "dashed", borderColor: recent ? color : "transparent", borderWidth: recent ? 1 : 0 } };
    }) }],
  }, true);
}

function renderRank() {
  const byDong = !state.dong;
  const keyOf = (r) => (byDong ? r.dong : r.bldg || "(건물명 없음)");
  const g = new Map();
  for (const r of state.rows) {
    const k = keyOf(r);
    const a = g.get(k) || { k, s: 0, n: 0, amt: [] };
    a.s += r.perM2; a.n++; a.amt.push(r.amount);
    g.set(k, a);
  }
  const top = [...g.values()].sort((a, b) => b.n - a.n).slice(0, byDong ? 15 : 12)
    .map((a) => ({ ...a, v: a.s / a.n, med: median(a.amt) }))
    .sort((a, b) => a.v - b.v); // 가로 막대: 위가 가장 높게
  $("rankTitle").textContent = byDong ? "법정동별 ㎡당 평균 매매가" : "단지·건물별 ㎡당 평균 매매가";
  $("rankSub").textContent = byDong ? "거래가 많은 순 상위 15곳 · 막대 끝 숫자는 거래 건수" : "거래가 많은 순 상위 12곳 · 막대 끝 숫자는 거래 건수";
  const ax = axisStyle(), color = cssVar("--series-1");
  $("rank").style.height = `${Math.max(160, top.length * 28 + 50)}px`; // 항목 수에 맞춰 높이 조절
  charts.rank.resize();
  charts.rank.setOption({
    grid: { left: 8, right: 70, top: 6, bottom: 24, containLabel: true },
    tooltip: { ...tooltipStyle(), trigger: "axis", axisPointer: { type: "shadow" },
      formatter: (ps) => { const d = top[ps[0].dataIndex]; return `<b>${esc(d.k)}</b><br>㎡당 평균 <b>${nf.format(Math.round(d.v))}</b>만원<br>중위 거래가 ${won(d.med)} · ${nf.format(d.n)}건`; } },
    xAxis: { type: "value", ...ax, axisLabel: { ...ax.axisLabel, formatter: (v) => nf.format(v) } },
    yAxis: { type: "category", data: top.map((d) => d.k), ...ax, axisLabel: { ...ax.axisLabel, color: cssVar("--ink-2"), fontSize: 12, width: 140, overflow: "truncate" } },
    series: [{
      type: "bar", barMaxWidth: 16, data: top.map((d) => Math.round(d.v)),
      itemStyle: { color, borderRadius: [0, 4, 4, 0] },
      label: { show: true, position: "right", color: cssVar("--ink-2"), fontSize: 11, formatter: (p) => `${nf.format(p.value)} · ${top[p.dataIndex].n}건` },
    }],
  }, true);
}

function renderList(rows, sorted = false) {
  const list = (sorted ? rows : rows.slice().sort((a, b) => b.day.localeCompare(a.day))).slice(0, 300);
  if (!sorted) $("list").querySelectorAll("th").forEach((th) => th.removeAttribute("aria-sort"));
  $("listSub").textContent = `머리글을 눌러 정렬 · ${nf.format(rows.length)}건 중 ${nf.format(list.length)}건 표시`;
  $("list").tBodies[0].innerHTML = list.map((r) => `<tr><td>${fmtDay(r.day)}</td><td>${esc(r.dong)}</td><td>${esc(r.bldg) || "–"}</td><td>${esc(r.usage)}</td>
    <td class="num">${nf1.format(r.area)}</td><td class="num">${r.floor ?? "–"}</td><td class="num"><b>${won(r.amount)}</b></td>
    <td class="num">${nf.format(Math.round(r.perM2))}</td><td class="num">${esc(r.built) || "–"}</td><td>${esc(r.dealType) || "–"}</td></tr>`).join("")
    || `<tr><td colspan="10" class="empty">거래 없음</td></tr>`;
}
