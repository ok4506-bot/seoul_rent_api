// 메인 보드: 자치구·동·주택유형 선택 → /api/rent (서버 프록시) → 평균 전세가 계산 + 3D·시계열 시각화
import {
  AREA_BANDS, PYEONG, RECENT_NOTE, YEARS, arrow, isRecentMonth, splitProvisional, axisStyle, bandIndex, change, channel, cssVar, esc, fetchAll,
  fillDongSelect, fillGuSelect, fmtDay, initTheme, loadDistricts, mean, median, nf, nf1, nf2, ok, pct,
  readParams, seqRamp, setStatus, tooltipStyle, won, writeParams, ym, ymKo,
} from "./common.js";

const $ = (id) => document.getElementById(id);
const el = {
  form: $("filters"), gu: $("gu"), dong: $("dong"), go: $("go"), status: $("status"), scopeHint: $("scopeHint"),
  chart3d: $("chart3d"), trend: $("trend"), counts: $("counts"), month: $("month"), monthLabel: $("monthLabel"),
  play: $("play"), all: $("allMonths"), snapshot: $("snapshot"), rotate: $("rotate"), axisSeg: $("axisSeg"),
};

const state = {
  districts: [], gu: "11680", dong: "10100", type: "아파트", years: [2026],
  metric: "jeonse", axis: "band", focus: null, playing: null, model: null, loadSeq: 0,
};

const METRIC = {
  jeonse: { name: "㎡당 전세 보증금", unit: "만원/㎡", ramp: "--seq", color: "--series-1", fmt: (v) => nf.format(Math.round(v)) },
  wolse: { name: "㎡당 월세", unit: "만원/㎡", ramp: "--seq2", color: "--series-2", fmt: (v) => nf2.format(v) },
};

const isJeonse = (r) => r.se === "전세";
const metricOf = (r, m) =>
  m === "jeonse" ? (isJeonse(r) && r.deposit > 0 ? r.deposit / r.area : null) : !isJeonse(r) && r.rent > 0 ? r.rent / r.area : null;

// ── 차트 인스턴스 ──
const charts = {
  c3d: echarts.init(el.chart3d, null, { renderer: "canvas" }),
  trend: echarts.init(el.trend),
  counts: echarts.init(el.counts),
};
new ResizeObserver(() => Object.values(charts).forEach((c) => c.resize())).observe(document.body);

// ── 초기화 ──
init();
async function init() {
  initTheme($("themeBtn"), () => render());
  state.districts = await loadDistricts();

  const p = readParams();
  if (p.gu && state.districts.some((g) => g.code === p.gu)) {
    state.gu = p.gu;
    state.dong = p.dong || "";
    state.type = p.type || "";
  }
  if (p.years) {
    const ys = p.years.split(",").map(Number).filter((y) => YEARS.includes(y));
    if (ys.length) state.years = ys;
  }
  if (p.metric in METRIC) state.metric = p.metric;
  if (p.axis === "dong") state.axis = "dong";

  fillGuSelect(el.gu, state.districts, state.gu);
  fillDongSelect(el.dong, guObj(), state.dong);
  setRadio("type", state.type);
  document.querySelectorAll('input[name="year"]').forEach((c) => (c.checked = state.years.includes(Number(c.value))));
  setRadio("metric", state.metric);
  setRadio("axis", state.axis);
  syncScopeHint();

  el.gu.addEventListener("change", () => { fillDongSelect(el.dong, guObj(el.gu.value), ""); syncScopeHint(); });
  el.dong.addEventListener("change", syncScopeHint);
  el.form.addEventListener("submit", (e) => { e.preventDefault(); load(); });
  document.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener("change", () => load()));
  document.querySelectorAll('input[name="metric"]').forEach((r) =>
    r.addEventListener("change", () => { state.metric = r.value; saveUrl(); render(); }));
  document.querySelectorAll('input[name="axis"]').forEach((r) =>
    r.addEventListener("change", () => { state.axis = r.value; saveUrl(); render(); }));
  el.rotate.addEventListener("change", () => charts.c3d.setOption({ grid3D: { viewControl: { autoRotate: el.rotate.checked } } }));
  el.month.addEventListener("input", () => { stopPlay(); state.focus = Number(el.month.value); renderTime(); });
  el.play.addEventListener("click", togglePlay);
  el.all.addEventListener("click", () => { stopPlay(); state.focus = null; renderTime(); });
  $("openTrade").addEventListener("click", openTrade);

  load();
}

const guObj = (code = state.gu) => state.districts.find((g) => g.code === code);
const dongName = (gu, code) => guObj(gu)?.dongs.find((d) => d.code === code)?.name || "";
function setRadio(name, value) {
  document.querySelectorAll(`input[name="${name}"]`).forEach((r) => (r.checked = r.value === value));
}
function syncScopeHint() {
  el.scopeHint.textContent = el.dong.value
    ? "법정동을 골라 필요한 자료만 빠르게 받아옵니다."
    : "자치구 전체는 자료가 많아 몇 초 더 걸립니다.";
}
function saveUrl() {
  writeParams({ gu: state.gu, dong: state.dong, type: state.type, years: state.years.join(","), metric: state.metric, axis: state.axis });
}

// ── 데이터 불러오기 ──
async function load() {
  const years = [...document.querySelectorAll('input[name="year"]:checked')].map((c) => Number(c.value)).sort();
  if (!years.length) return setStatus(el.status, "error", "접수연도를 하나 이상 고르세요.");
  state.gu = el.gu.value;
  state.dong = el.dong.value;
  state.type = document.querySelector('input[name="type"]:checked').value;
  state.years = years;
  if (state.dong && state.axis === "dong") { state.axis = "band"; setRadio("axis", "band"); }
  el.axisSeg.querySelector('input[value="dong"]').disabled = !!state.dong;
  saveUrl();

  const seq = ++state.loadSeq;
  const label = scopeLabel();
  el.go.disabled = true;
  stopPlay();
  try {
    const results = [];
    for (const year of years) {
      setStatus(el.status, "loading", `${esc(label)} · ${year}년 자료를 서울시 API에서 받는 중…`);
      const r = await fetchAll("rent", { gu: state.gu, dong: state.dong, type: state.type, year }, (p, n) => {
        if (seq === state.loadSeq && n > 1) setStatus(el.status, "loading", `${esc(label)} · ${year}년 자료 받는 중… (${p}/${n} 묶음)`);
      });
      results.push({ year, ...r });
    }
    if (seq !== state.loadSeq) return;
    state.model = buildModel(results);
    state.focus = null;
    render();
    const n = state.model.rows.length;
    const t = new Date(results.at(-1).fetchedAt || Date.now()).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    setStatus(el.status, n ? "ok" : "error",
      n ? `${esc(label)} · ${years.join("·")}년 접수 <b>${nf.format(n)}</b>건 분석 · 서울시 API 기준 ${t}${results.some((r) => r.cache === "HIT") ? " (엣지 캐시)" : ""}`
        : `${esc(label)}: 조건에 맞는 전월세 신고가 없습니다.`);
    broadcast();
  } catch (e) {
    if (seq === state.loadSeq) setStatus(el.status, "error", esc(e.message));
  } finally {
    if (seq === state.loadSeq) el.go.disabled = false;
  }
}

function scopeLabel() {
  const g = guObj()?.name || "";
  const d = state.dong ? ` ${dongName(state.gu, state.dong)}` : " 전체";
  return `${g}${d} · ${state.type || "전체 유형"}`;
}

// ── 집계 모델 ──
function buildModel(results) {
  const years = results.map((r) => r.year);
  const minY = Math.min(...years), maxY = Math.max(...years);
  const rows = [];
  for (const res of results)
    for (const r of res.rows) if (ok(r.area) && r.area > 0 && r.day && r.day.length === 8) rows.push(r);

  // 계약월 축: 선택한 연도 범위 안의 계약만, 빈 달 없이 연속
  const inRange = rows.filter((r) => { const y = Number(r.day.slice(0, 4)); return y >= minY && y <= maxY; });
  const keys = [...new Set(inRange.map((r) => r.day.slice(0, 6)))].sort();
  const months = [];
  if (keys.length) {
    let y = Number(keys[0].slice(0, 4)), m = Number(keys[0].slice(4, 6));
    const last = keys.at(-1);
    for (;;) {
      const k = `${y}${String(m).padStart(2, "0")}`;
      months.push(k);
      if (k >= last) break;
      if (++m > 12) { m = 1; y++; }
    }
  }
  const monthIdx = new Map(months.map((k, i) => [k, i]));

  const latest = rows.filter((r) => r.rcptYear === maxY);
  const prev = years.includes(maxY - 1) ? rows.filter((r) => r.rcptYear === maxY - 1) : null;

  return { years, maxY, rows, inRange, months, monthIdx, kpi: stats(latest), kpiPrev: prev ? stats(prev) : null, latest };
}

function stats(rows) {
  const j = rows.filter((r) => isJeonse(r) && r.deposit > 0);
  const w = rows.filter((r) => !isJeonse(r) && r.rent > 0);
  return {
    jN: j.length,
    jAvg: mean(j.map((r) => r.deposit)),
    jMed: median(j.map((r) => r.deposit)),
    jM2: mean(j.map((r) => r.deposit / r.area)),
    jArea: mean(j.map((r) => r.area)),
    wN: w.length,
    wDep: mean(w.map((r) => r.deposit)),
    wRent: mean(w.map((r) => r.rent)),
    wM2: mean(w.map((r) => r.rent / r.area)),
    share: j.length + w.length ? (j.length / (j.length + w.length)) * 100 : null,
  };
}

// 월 × (면적대 | 법정동) 행렬
function matrix(model, metric, axis) {
  let xs, xOf;
  if (axis === "dong") {
    const cnt = new Map();
    for (const r of model.inRange) if (metricOf(r, metric) != null) cnt.set(r.dongCd, (cnt.get(r.dongCd) || 0) + 1);
    const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([c]) => c);
    const idx = new Map(top.map((c, i) => [c, i]));
    xs = top.map((c) => model.inRange.find((r) => r.dongCd === c)?.dong || c);
    xOf = (r) => idx.get(r.dongCd);
  } else {
    xs = AREA_BANDS.map((b) => b.short);
    xOf = (r) => bandIndex(r.area);
  }
  const acc = new Map();
  const monthAcc = model.months.map(() => ({ s: 0, n: 0 }));
  for (const r of model.inRange) {
    const v = metricOf(r, metric);
    if (v == null) continue;
    const y = model.monthIdx.get(r.day.slice(0, 6));
    if (y == null) continue;
    monthAcc[y].s += v; monthAcc[y].n++;
    const x = xOf(r);
    if (x == null || x < 0) continue;
    const k = x * 1000 + y;
    const a = acc.get(k) || { x, y, s: 0, n: 0 };
    a.s += v; a.n++;
    acc.set(k, a);
  }
  const cells = [...acc.values()].map((a) => ({ x: a.x, y: a.y, v: a.s / a.n, n: a.n }));
  const monthly = monthAcc.map((a) => ({ v: a.n ? a.s / a.n : null, n: a.n }));
  return { xs, cells, monthly };
}

// ── 렌더링 ──
function render() {
  const m = state.model;
  renderKpis(m);
  if (!m) return;
  state.mx = matrix(m, state.metric, state.axis);
  el.month.max = String(Math.max(0, m.months.length - 1));
  renderTables(m);
  render3d(true);
  renderTime();
}

function renderKpis(m) {
  const k = m?.kpi, p = m?.kpiPrev;
  const yoy = (a, b) => (p && ok(change(a, b)) ? ` · <span class="delta">전년 대비 ${arrow(change(a, b))} ${pct(change(a, b))}</span>` : "");
  $("kJeonseLabel").textContent = m ? `${m.maxY}년 평균 전세가` : "평균 전세가";
  $("kJeonse").textContent = k?.jN ? won(k.jAvg) : "–";
  $("kJeonseSub").innerHTML = k?.jN ? `중위 ${won(k.jMed)} · 전세 ${nf.format(k.jN)}건 · 평균 ${nf1.format(k.jArea)}㎡${yoy(k.jAvg, p?.jAvg)}` : "전세 계약이 없습니다";
  $("kJeonseM2").innerHTML = k?.jN ? `${nf.format(Math.round(k.jM2))}<span class="unit">만원/㎡</span>` : "–";
  $("kJeonseM2Sub").innerHTML = k?.jN ? `3.3㎡(평)당 ${won(k.jM2 * PYEONG)}${yoy(k.jM2, p?.jM2)}` : "&nbsp;";
  $("kWolse").innerHTML = k?.wN ? `${nf.format(Math.round(k.wRent))}<span class="unit">만원/월</span>` : "–";
  $("kWolseSub").innerHTML = k?.wN ? `평균 보증금 ${won(k.wDep)} · 월세 ${nf.format(k.wN)}건` : "&nbsp;";
  $("kWolseM2").innerHTML = k?.wN ? `${nf2.format(k.wM2)}<span class="unit">만원/㎡</span>` : "–";
  $("kWolseM2Sub").innerHTML = k?.wN ? `3.3㎡당 월 ${nf1.format(k.wM2 * PYEONG)}만원${yoy(k.wM2, p?.wM2)}` : "&nbsp;";
  $("kShare").innerHTML = ok(k?.share) ? `${nf1.format(k.share)}<span class="unit">%</span>` : "–";
  $("kShareSub").innerHTML = k ? `전세 ${nf.format(k.jN)} : 월세 ${nf.format(k.wN)}` : "&nbsp;";
}

function render3d(full) {
  const m = state.model, mx = state.mx, meta = METRIC[state.metric];
  const c = charts.c3d;
  $("boardTitle").textContent = `${state.axis === "dong" ? "법정동" : "면적대"} × 계약월 · ${meta.name}`;
  $("trendTitle").textContent = `월별 ${meta.name}`;
  if (!mx.cells.length) {
    c.clear();
    c.setOption({ title: { text: "표시할 계약이 없습니다", left: "center", top: "middle", textStyle: { color: cssVar("--muted"), fontSize: 13, fontWeight: 500 } } });
    return;
  }
  const vals = mx.cells.map((d) => d.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const ink = cssVar("--ink"), ink2 = cssVar("--ink-2"), muted = cssVar("--muted"), grid = cssVar("--grid"), axis = cssVar("--axis");
  const axis3 = (name, data, every = 1) => ({
    type: data ? "category" : "value", data, name,
    nameTextStyle: { color: ink2, fontSize: 12 },
    nameGap: 22,
    axisLabel: { color: ink2, fontSize: 12, textStyle: { color: ink2, fontSize: 12 }, margin: 10, interval: every - 1, formatter: data ? undefined : (v) => meta.fmt(v) },
    axisLine: { lineStyle: { color: axis } },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: grid, opacity: 1 } },
    axisPointer: { lineStyle: { color: ink2 } },
  });
  const nCat = mx.xs.length, nMon = m.months.length;
  const narrow = el.chart3d.clientWidth < 600;
  // 가로(x) = 계약월, 깊이(y) = 면적대 또는 법정동, 높이(z) = ㎡당 가격
  const option = {
    tooltip: {
      ...tooltipStyle(),
      formatter: (p) => {
        const [mi, ci, v] = p.value;
        const cell = mx.cells.find((d) => d.x === ci && d.y === mi);
        return `<b>${esc(mx.xs[ci])}</b> · ${ymKo(m.months[mi])}<br>${meta.name} <b>${meta.fmt(v)}</b> ${meta.unit}<br><span style="color:${muted}">계약 ${nf.format(cell?.n || 0)}건${cell?.n < 3 ? " · 표본 적음" : ""}</span>`;
      },
    },
    visualMap: {
      show: true, dimension: 2, min: Math.floor(lo), max: Math.ceil(hi), calculable: true, realtime: true,
      inRange: { color: seqRamp(meta.ramp) }, right: 4, top: narrow ? 0 : 6, itemHeight: narrow ? 70 : 110, itemWidth: narrow ? 10 : 12,
      text: ["높음", "낮음"], textStyle: { color: ink2, fontSize: 11 },
      formatter: (v) => meta.fmt(v),
    },
    xAxis3D: axis3("계약월", m.months.map((k) => ym(k).slice(2)), Math.max(1, Math.ceil(nMon / 12))),
    yAxis3D: axis3(state.axis === "dong" ? "법정동" : "면적(㎡)", mx.xs),
    zAxis3D: { ...axis3(meta.unit), min: 0 },
    grid3D: {
      boxWidth: Math.max(110, Math.min(210, nMon * 7)),
      boxDepth: nCat > 8 ? 150 : 80,
      boxHeight: 75,
      top: -10,
      environment: "none",
      viewControl: { projection: "perspective", alpha: 30, beta: 32, distance: narrow ? 290 : 210, minDistance: 120, maxDistance: 400, autoRotate: el.rotate.checked, autoRotateSpeed: 6, damping: 0.85 },
      light: { main: { intensity: 1.15, shadow: true, shadowQuality: "high", alpha: 45, beta: 25 }, ambient: { intensity: 0.4 } },
      postEffect: { enable: false }, // 후처리(SSAO)는 밝은 테마에서 축 글자를 흐리게 만들어 끔
      temporalSuperSampling: { enable: false },
      axisPointer: { lineStyle: { color: ink2 } },
    },
    series: [{
      type: "bar3D", shading: "lambert", bevelSize: 0.2, bevelSmoothness: 2,
      data: barData(),
      emphasis: { label: { show: true, formatter: (p) => meta.fmt(p.value[2]), textStyle: { color: ink, fontSize: 12, fontWeight: 700, backgroundColor: cssVar("--surface"), padding: [2, 4], borderRadius: 4 } } },
      animationDurationUpdate: 500,
    }],
  };
  c.setOption(option, full);
}

// 시간 축 강조: 고른 달까지 누적 표시, 고른 달은 진하게
function barData() {
  const f = state.focus;
  return state.mx.cells
    .filter((d) => f == null || d.y <= f)
    .map((d) => ({ value: [d.y, d.x, d.v], itemStyle: { opacity: f == null || d.y === f ? 1 : 0.4 } }));
}

function renderTime() {
  const m = state.model;
  if (!m || !state.mx) return;
  const f = state.focus;
  el.month.value = String(f ?? m.months.length - 1);
  el.monthLabel.textContent = f == null ? "전체 기간" : ym(m.months[f]);
  el.all.disabled = f == null;
  if (state.mx.cells.length) charts.c3d.setOption({ series: [{ data: barData() }] });
  renderTrend();
  renderSnapshot();
}

function renderTrend() {
  const m = state.model, mx = state.mx, meta = METRIC[state.metric];
  const color = cssVar(meta.color), muted = cssVar("--muted");
  const xs = m.months.map(ym);
  const f = state.focus;
  const ax = axisStyle();
  const line = splitProvisional(m.months, mx.monthly.map((d) => (d.v == null ? null : +d.v.toFixed(3))));
  $("countTitle").textContent = state.metric === "jeonse" ? "월별 전세 계약 건수" : "월별 월세 계약 건수";
  const mark = f == null ? undefined : {
    symbol: "none", silent: true, animation: false,
    lineStyle: { color: cssVar("--ink-2"), type: "dashed", width: 1 },
    label: { formatter: xs[f], color: cssVar("--ink-2"), fontSize: 11 },
    data: [{ xAxis: xs[f] }],
  };
  charts.trend.setOption({
    animationDuration: 400,
    grid: { left: 52, right: 16, top: 16, bottom: 28 },
    tooltip: { ...tooltipStyle(), trigger: "axis", axisPointer: { type: "line", lineStyle: { color: muted } },
      formatter: (ps) => { const p = ps.find((x) => x.value != null) || ps[0]; const n = mx.monthly[p.dataIndex].n;
        return `${ymKo(m.months[p.dataIndex])}<br>${meta.name} <b>${ok(p.value) ? meta.fmt(p.value) : "–"}</b> ${meta.unit}<br><span style="color:${muted}">${nf.format(n)}건${isRecentMonth(m.months[p.dataIndex]) ? `<br>${RECENT_NOTE}` : ""}</span>`; } },
    xAxis: { type: "category", data: xs, boundaryGap: false, ...ax, splitLine: { show: false } },
    yAxis: { type: "value", scale: true, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v) => meta.fmt(v) } },
    series: [{
      type: "line", data: line.solid, smooth: 0.25, connectNulls: true,
      symbol: "circle", symbolSize: 8, showSymbol: m.months.length <= 14, lineStyle: { width: 2, color },
      itemStyle: { color, borderColor: cssVar("--surface"), borderWidth: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + "33" }, { offset: 1, color: color + "00" }]) },
      markLine: mark,
    }, {
      // 최근 1–2개월: 신고 기한이 남아 값이 바뀔 수 있으므로 점선
      type: "line", data: line.dashed, smooth: 0.25, connectNulls: true, symbol: "emptyCircle", symbolSize: 7,
      showSymbol: true, lineStyle: { width: 2, color, type: [4, 4] }, itemStyle: { color, borderColor: color },
    }],
  }, true);

  charts.counts.setOption({
    animationDuration: 400,
    grid: { left: 52, right: 16, top: 8, bottom: 28 },
    tooltip: { ...tooltipStyle(), trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps) => `${ymKo(m.months[ps[0].dataIndex])}<br>계약 <b>${nf.format(ps[0].value)}</b>건${isRecentMonth(m.months[ps[0].dataIndex]) ? `<br><span style="color:${muted}">${RECENT_NOTE}</span>` : ""}` },
    xAxis: { type: "category", data: xs, ...ax, splitLine: { show: false } },
    yAxis: { type: "value", ...ax, splitNumber: 3, axisLabel: { ...ax.axisLabel, formatter: (v) => nf.format(v) } },
    series: [{
      type: "bar", barMaxWidth: 18,
      data: mx.monthly.map((d, i) => {
        const recent = isRecentMonth(m.months[i]);
        const base = f == null || i === f ? 0.9 : 0.35;
        return { value: d.n, itemStyle: { color, opacity: recent ? base * 0.45 : base, borderRadius: [4, 4, 0, 0], borderType: "dashed", borderColor: recent ? color : "transparent", borderWidth: recent ? 1 : 0 } };
      }),
    }],
  }, true);
}

function renderSnapshot() {
  const m = state.model, mx = state.mx, meta = METRIC[state.metric], f = state.focus;
  const mon = mx.monthly;
  if (!mon.length) { el.snapshot.innerHTML = ""; return; }
  if (f == null) {
    const first = mon.findIndex((d) => d.v != null);
    let last = -1; mon.forEach((d, i) => d.v != null && (last = i));
    if (first < 0) { el.snapshot.innerHTML = ""; return; }
    const ch = change(mon[last].v, mon[first].v);
    el.snapshot.innerHTML = `<span>${ym(m.months[first])} → ${ym(m.months[last])}</span>
      <span>${meta.name} <b>${meta.fmt(mon[first].v)}</b> → <b>${meta.fmt(mon[last].v)}</b> ${meta.unit}</span>
      <span>변화 <b>${arrow(ch)} ${pct(ch)}</b></span>
      <span>▶ 를 누르면 달마다 막대가 쌓입니다</span>`;
    return;
  }
  const cur = mon[f];
  let prevI = f - 1; while (prevI >= 0 && mon[prevI].v == null) prevI--;
  const ch = prevI >= 0 ? change(cur.v, mon[prevI].v) : null;
  const best = mx.cells.filter((d) => d.y === f).sort((a, b) => b.v - a.v)[0];
  el.snapshot.innerHTML = `<span><b>${ymKo(m.months[f])}</b></span>
    <span>${meta.name} <b>${cur.v == null ? "–" : meta.fmt(cur.v)}</b> ${meta.unit}</span>
    <span>전월 대비 <b>${ch == null ? "–" : `${arrow(ch)} ${pct(ch)}`}</b></span>
    <span>계약 <b>${nf.format(cur.n)}</b>건</span>
    ${best ? `<span>최고 ${state.axis === "dong" ? "법정동" : "면적대"} <b>${esc(mx.xs[best.x])}</b> (${meta.fmt(best.v)})</span>` : ""}`;
}

function renderTables(m) {
  // 월별 표
  const mxJ = matrix(m, "jeonse", "band"), mxW = matrix(m, "wolse", "band");
  $("monthTable").tHead.innerHTML = `<tr><th>계약월</th><th class="num">전세 건수</th><th class="num">㎡당 전세(만원)</th><th class="num">월세 건수</th><th class="num">㎡당 월세(만원)</th></tr>`;
  $("monthTable").tBodies[0].innerHTML = m.months.map((k, i) => `<tr><td>${ym(k)}</td>
    <td class="num">${nf.format(mxJ.monthly[i].n)}</td><td class="num">${mxJ.monthly[i].v == null ? "–" : nf.format(Math.round(mxJ.monthly[i].v))}</td>
    <td class="num">${nf.format(mxW.monthly[i].n)}</td><td class="num">${mxW.monthly[i].v == null ? "–" : nf2.format(mxW.monthly[i].v)}</td></tr>`).join("");

  // 면적대별 (최근 접수연도)
  $("bandSub").textContent = `${m.maxY}년 접수 기준 · 임대면적 구간`;
  $("bandTable").tHead.innerHTML = `<tr><th>면적대</th><th class="num">전세</th><th class="num">평균 전세가</th><th class="num">㎡당</th><th class="num">월세</th><th class="num">평균 보증금 / 월세</th></tr>`;
  $("bandTable").tBodies[0].innerHTML = AREA_BANDS.map((b, i) => {
    const s = stats(m.latest.filter((r) => bandIndex(r.area) === i));
    if (!s.jN && !s.wN) return "";
    return `<tr><td>${b.label}</td><td class="num">${nf.format(s.jN)}</td><td class="num">${s.jN ? won(s.jAvg) : "–"}</td>
      <td class="num">${s.jN ? nf.format(Math.round(s.jM2)) : "–"}</td><td class="num">${nf.format(s.wN)}</td>
      <td class="num">${s.wN ? `${won(s.wDep)} / ${nf.format(Math.round(s.wRent))}만` : "–"}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">자료 없음</td></tr>`;

  // 최근 계약
  const recent = m.latest.slice().sort((a, b) => b.day.localeCompare(a.day)).slice(0, 40);
  $("recentTable").tHead.innerHTML = `<tr><th>계약일</th><th>법정동</th><th>건물명</th><th>유형</th><th>구분</th><th class="num">면적(㎡)</th><th class="num">보증금</th><th class="num">월세(만)</th><th class="num">층</th><th>신규/갱신</th></tr>`;
  $("recentTable").tBodies[0].innerHTML = recent.map((r) => `<tr><td>${fmtDay(r.day)}</td><td>${esc(r.dong)}</td><td>${esc(r.bldg) || "–"}</td>
    <td>${esc(r.usage)}</td><td><span class="tag ${isJeonse(r) ? "j" : "w"}">${esc(r.se)}</span></td><td class="num">${nf1.format(r.area)}</td>
    <td class="num">${won(r.deposit)}</td><td class="num">${r.rent ? nf.format(r.rent) : "–"}</td><td class="num">${r.floor ?? "–"}</td><td>${esc(r.renewal) || "–"}</td></tr>`).join("")
    || `<tr><td colspan="10" class="empty">자료 없음</td></tr>`;
}

// ── 재생 ──
function togglePlay() {
  if (state.playing) return stopPlay();
  const m = state.model;
  if (!m || !m.months.length) return;
  state.focus = state.focus == null || state.focus >= m.months.length - 1 ? 0 : state.focus;
  renderTime();
  el.play.textContent = "❚❚";
  el.play.setAttribute("aria-label", "재생 멈춤");
  state.playing = setInterval(() => {
    if (state.focus >= m.months.length - 1) return stopPlay();
    state.focus++;
    renderTime();
  }, 900);
}
function stopPlay() {
  if (state.playing) clearInterval(state.playing);
  state.playing = null;
  el.play.textContent = "▶";
  el.play.setAttribute("aria-label", "월별 재생");
}

// ── 실거래가 창 ──
function tradeUrl() {
  const p = new URLSearchParams({ gu: state.gu, dong: state.dong, type: state.type, year: String(state.model?.maxY || Math.max(...state.years)) });
  const j = state.model?.kpi?.jM2;
  if (ok(j)) p.set("jpm", j.toFixed(1));
  return `trade.html?${p}`;
}
function openTrade() {
  const w = window.open(tradeUrl(), "seoul-trade", "popup=yes,width=1320,height=920");
  if (!w) location.href = tradeUrl(); // 팝업 차단 시 같은 창에서 이동
}
function broadcast() {
  channel?.postMessage({
    kind: "selection", gu: state.gu, dong: state.dong, type: state.type,
    year: state.model?.maxY, jpm: state.model?.kpi?.jM2 ?? null,
  });
}
