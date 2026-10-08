// 서울 열린데이터광장 OpenAPI 공용 모듈 (Cloudflare Pages Functions 전용, 서버 측에서만 실행)
//
// - SEOUL_API_KEY 는 Cloudflare Secret(env)에서만 읽고, 응답·로그·오류 메시지 어디에도 넣지 않습니다.
// - 서울시 API는 1회 최대 1,000건이라 페이지를 나눠 받고, 한 번의 함수 호출에서 쓰는
//   서브요청 수(무료 플랜 50개)를 넘지 않도록 PART_PAGES 단위로 끊어 응답합니다.
// - 브라우저에는 화면에 필요한 필드만 배열 형태로 압축해 돌려줍니다.

export const SERVICES = {
  rent: "tbLnOpendataRentV", // 서울시 부동산 전월세가 정보
  trade: "tbLnOpendataRtmsV", // 서울시 부동산 실거래가 정보
};

const DEFAULT_BASE = "http://openapi.seoul.go.kr:8088";
export const PAGE_SIZE = 1000; // 서울시 API 1회 최대 조회 건수
export const PART_PAGES = 30; // 함수 1회 호출당 최대 30페이지(30,000건)
const MAX_SUBREQUESTS = 46; // 재시도 포함 상한 (무료 플랜 50 이내)
const CONCURRENCY = 6; // 서울시 API는 동시 호출이 많으면 오류 문구를 돌려줌
export const YEARS = [2024, 2025, 2026]; // OpenAPI는 최근 3개 접수연도만 제공
export const HOUSE_TYPES = ["아파트", "연립다세대", "오피스텔", "단독다가구"];

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extra },
  });
}

export class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// ── 입력 검증 (화이트리스트) ─────────────────────────────────────────────
export function parseQuery(url) {
  const p = url.searchParams;
  const gu = p.get("gu") || "";
  const dong = p.get("dong") || "";
  const type = p.get("type") || "";
  const year = Number(p.get("year") || 2026);
  const part = Number(p.get("part") || 0);
  const uf = p.get("uf"); // 서버측 주택유형 필터 사용 여부 (part 0 응답값을 이어받음)

  if (!/^11\d{3}$/.test(gu)) return { error: "자치구 코드가 올바르지 않습니다." };
  if (!/^(\d{5})?$/.test(dong)) return { error: "법정동 코드가 올바르지 않습니다." };
  if (type && !HOUSE_TYPES.includes(type)) return { error: "주택유형이 올바르지 않습니다." };
  if (!YEARS.includes(year)) return { error: `조회 가능한 연도는 ${YEARS.join(", ")}년입니다.` };
  if (!Number.isInteger(part) || part < 0 || part > 19) return { error: "part 값이 올바르지 않습니다." };
  return { gu, dong, type, year, part, uf: uf === "0" ? "0" : uf === "1" ? "1" : "" };
}

// 다른 사이트에서 이 프록시를 무단 호출하지 못하도록 같은 출처 요청만 허용
export function isSameOrigin(request) {
  const site = request.headers.get("Sec-Fetch-Site");
  return !site || site === "same-origin" || site === "none";
}

// ── 업스트림 호출 ─────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildUrl(env, service, start, end, q, useTypeFilter) {
  const base = (env.SEOUL_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  const key = encodeURIComponent(env.SEOUL_API_KEY);
  // 요청인자 순서: RCPT_YR / CGG_CD / CGG_NM / STDG_CD / LOTNO_SE / MNO / SNO / CTRT_DAY / BLDG_NM / BLDG_USG
  // 비워 둘 인자는 공백(%20)으로 채웁니다.
  const segs = [q.year, q.gu, "%20", q.dong || "%20"];
  if (useTypeFilter) segs.push("%20", "%20", "%20", "%20", "%20", encodeURIComponent(q.type));
  return `${base}/${key}/json/${service}/${start}/${end}/${segs.join("/")}`;
}

function makeBudget() {
  let used = 0;
  return () => {
    if (++used > MAX_SUBREQUESTS) throw new UpstreamError("한 번에 처리할 수 있는 요청 수를 넘었습니다. 조건을 좁혀 주세요.", 503);
  };
}

async function fetchPage(env, service, q, pageIdx, useTypeFilter, spend) {
  const start = pageIdx * PAGE_SIZE + 1;
  const end = start + PAGE_SIZE - 1;
  const url = buildUrl(env, service, start, end, q, useTypeFilter);
  let data;
  for (let attempt = 0; ; attempt++) {
    spend();
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = JSON.parse(await res.text()); // 과부하 시 JSON이 아닌 문구가 오므로 직접 파싱
      break;
    } catch (e) {
      if (attempt >= 2) throw new UpstreamError("서울시 API 응답이 불안정합니다. 잠시 후 다시 시도해 주세요.");
      await sleep(350 * (attempt + 1) + Math.random() * 250);
    }
  }

  const body = data[service];
  const result = body?.RESULT || data?.RESULT || {};
  const code = result.CODE || "";
  if (!body) {
    if (code === "INFO-200") return { total: 0, rows: [] }; // 해당 데이터 없음
    if (code === "INFO-100") throw new UpstreamError("서버에 등록된 SEOUL_API_KEY가 유효하지 않습니다.", 500);
    throw new UpstreamError(`서울시 API 오류 (${code || "알 수 없음"})`);
  }
  return { total: Number(body.list_total_count) || 0, rows: body.row || [] };
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await worker(items[k]);
      }
    }),
  );
  return out;
}

/**
 * 조건에 맞는 데이터 중 part 번째 묶음(최대 PART_PAGES 페이지)을 가져옵니다.
 * - 전월세(rent)에 주택유형이 지정되면 서울시 API의 BLDG_USG 인자로 먼저 걸러 받습니다.
 *   (0건이 나오면 인자 위치·표기 차이일 수 있으므로 필터 없이 다시 받아 서버에서 거릅니다.)
 */
export async function fetchPart(env, kind, q) {
  const service = SERVICES[kind];
  const spend = makeBudget();
  let useTypeFilter = kind === "rent" && !!q.type && q.uf !== "0";
  const firstIdx = q.part * PART_PAGES;

  let first = await fetchPage(env, service, q, firstIdx, useTypeFilter, spend);
  if (useTypeFilter && q.part === 0 && first.total === 0) {
    useTypeFilter = false;
    first = await fetchPage(env, service, q, firstIdx, false, spend);
  }

  const totalPages = Math.ceil(first.total / PAGE_SIZE);
  const lastIdx = Math.min(totalPages, firstIdx + PART_PAGES);
  const rest = [];
  for (let p = firstIdx + 1; p < lastIdx; p++) rest.push(p);
  const pages = await pool(rest, CONCURRENCY, (p) => fetchPage(env, service, q, p, useTypeFilter, spend));

  const raw = first.rows.slice();
  for (const pg of pages) raw.push(...pg.rows);

  return {
    total: first.total,
    parts: Math.max(1, Math.ceil(totalPages / PART_PAGES)),
    uf: useTypeFilter ? "1" : "0",
    raw,
    upstreamKeys: raw[0] ? Object.keys(raw[0]) : [],
  };
}

// ── 응답 압축 ─────────────────────────────────────────────────────────────
const num = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v) => (v == null ? "" : String(v).trim());
const pick = (r, ...keys) => {
  for (const k of keys) if (r[k] !== undefined && r[k] !== "") return r[k];
  return undefined;
};

export const RENT_FIELDS = ["day", "dongCd", "dong", "se", "area", "deposit", "rent", "bldg", "usage", "floor", "built", "renewal"];
export function compactRent(r) {
  return [
    str(r.CTRT_DAY),
    str(r.STDG_CD),
    str(r.STDG_NM),
    str(r.RENT_SE), // 전세 / 월세
    num(r.RENT_AREA), // 임대면적(㎡)
    num(r.GRFE), // 보증금(만원)
    num(r.RTFE), // 임대료(만원)
    str(r.BLDG_NM),
    str(r.BLDG_USG),
    num(r.FLR),
    str(r.ARCH_YR),
    str(r.NEW_UPDT_YN), // 신규/갱신
  ];
}

export const TRADE_FIELDS = ["day", "dongCd", "dong", "amount", "area", "landArea", "floor", "bldg", "usage", "built", "dealType"];
export function compactTrade(r) {
  return [
    str(r.CTRT_DAY),
    str(r.STDG_CD),
    str(r.STDG_NM),
    num(pick(r, "THING_AMT", "OBJ_AMT")), // 물건금액(만원)
    num(pick(r, "ARCH_AREA", "BLDG_AREA")), // 건물면적(㎡)
    num(pick(r, "LAND_AREA", "TOT_AREA")), // 토지면적(㎡)
    num(r.FLR),
    str(r.BLDG_NM),
    str(r.BLDG_USG),
    str(r.ARCH_YR),
    str(pick(r, "DCLR_SE", "REQ_GBN")), // 신고구분(중개거래/직거래)
  ];
}

// 해제(취소)된 거래는 실거래가 통계에서 제외
export const isCancelledTrade = (r) => str(pick(r, "RTRCN_DAY", "CNTL_YMD")) !== "";

// ── 요청 처리 (rent / trade 공용) ─────────────────────────────────────────
export async function handleDataRequest(kind, context) {
  const { request, env } = context;
  if (!isSameOrigin(request)) return json({ error: "Forbidden" }, 403);

  const url = new URL(request.url);
  const q = parseQuery(url);
  if (q.error) return json({ error: q.error }, 400);
  if (!env.SEOUL_API_KEY) {
    return json({ error: "서버에 SEOUL_API_KEY가 설정되지 않았습니다. Cloudflare Pages 설정 → 변수 및 비밀에서 추가해 주세요." }, 500);
  }

  // 캐시 키에는 API 키를 넣지 않습니다. 지난 연도 자료는 더 오래 보관합니다.
  const ttl = q.year < 2026 ? 60 * 60 * 24 : 60 * 60 * 3;
  const cacheUrl = `${url.origin}/__cache/${kind}?y=${q.year}&g=${q.gu}&d=${q.dong}&t=${encodeURIComponent(q.type)}&p=${q.part}&uf=${q.uf}&v=1`;

  try {
    return await withEdgeCache(context, cacheUrl, ttl, async () => {
      const r = await fetchPart(env, kind, q);
      let rows;
      if (kind === "rent") {
        rows = r.raw.filter((x) => !q.type || x.BLDG_USG === q.type).map(compactRent);
      } else {
        rows = r.raw.filter((x) => !isCancelledTrade(x) && (!q.type || x.BLDG_USG === q.type)).map(compactTrade);
      }
      return json({
        kind,
        query: { gu: q.gu, dong: q.dong, type: q.type, year: q.year, part: q.part },
        total: r.total, // 업스트림 기준 전체 건수 (필터 전)
        parts: r.parts,
        uf: r.uf,
        fields: kind === "rent" ? RENT_FIELDS : TRADE_FIELDS,
        rows,
        upstreamKeys: r.upstreamKeys, // 필드명 점검용 (값 없음)
        fetchedAt: new Date().toISOString(),
      });
    });
  } catch (e) {
    const status = e instanceof UpstreamError ? e.status : 502;
    console.error(`[${kind}] upstream failed:`, e instanceof UpstreamError ? e.message : "unexpected error");
    return json({ error: e instanceof UpstreamError ? e.message : "서울시 API 조회에 실패했습니다." }, status);
  }
}

// ── 엣지 캐시 ─────────────────────────────────────────────────────────────
export async function withEdgeCache(ctx, cacheUrl, ttl, produce) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(cacheUrl);
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set("X-Cache", "HIT");
      return res;
    }
  }
  const res = await produce();
  if (res.status === 200) {
    res.headers.set("Cache-Control", `public, max-age=${ttl}`);
    res.headers.set("X-Cache", "MISS");
    if (cache) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}
