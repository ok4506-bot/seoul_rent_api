// 로컬 개발용 "모의" 서울시 OpenAPI 서버 (실제 데이터 아님)
//
// API 키 없이 화면·함수 동작을 점검할 때만 사용합니다.
//   1) npm run mock                         → http://127.0.0.1:8099 에서 대기
//   2) .dev.vars 에 SEOUL_API_BASE=http://127.0.0.1:8099, SEOUL_API_KEY=MOCKKEY
//   3) npm run dev
// 배포 환경에서는 SEOUL_API_BASE를 설정하지 않으므로 항상 실제 openapi.seoul.go.kr 를 호출합니다.
import http from "node:http";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.MOCK_PORT || 8099);
const KEY = process.env.MOCK_KEY || "MOCKKEY";
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE ?? 0.02); // 과부하 응답 흉내
const districts = JSON.parse(readFileSync(new URL("../public/data/districts.json", import.meta.url)));

// 자치구별 아파트 전세 ㎡당 기준가(만원) — 모의 데이터용 대략값
const BASE = {
  강남구: 1350, 서초구: 1300, 송파구: 1060, 용산구: 1050, 성동구: 950, 마포구: 900, 광진구: 860, 강동구: 820,
  동작구: 830, 양천구: 800, 영등포구: 800, 중구: 800, 종로구: 780, 서대문구: 700, 동대문구: 680, 성북구: 650,
  은평구: 620, 강서구: 640, 구로구: 600, 관악구: 600, 금천구: 560, 노원구: 560, 도봉구: 520, 강북구: 540, 중랑구: 560,
};
const TYPES = [
  { name: "아파트", w: 0.42, mult: 1.0, area: [59, 22, 40, 160], jeonse: 0.55, sale: 0.55 },
  { name: "연립다세대", w: 0.26, mult: 0.6, area: [45, 14, 18, 95], jeonse: 0.45, sale: 0.78 },
  { name: "오피스텔", w: 0.2, mult: 0.78, area: [30, 10, 15, 80], jeonse: 0.35, sale: 0.85 },
  { name: "단독다가구", w: 0.12, mult: 0.5, area: [36, 14, 12, 120], jeonse: 0.3, sale: 0.7 },
];
const BRANDS = ["래미안", "자이", "힐스테이트", "푸르지오", "아이파크", "e편한세상", "롯데캐슬", "더샵"];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const hash = (str) => [...str].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
const pickW = (r, arr) => {
  let x = r() * arr.reduce((a, b) => a + b.w, 0);
  for (const a of arr) if ((x -= a.w) <= 0) return a;
  return arr[arr.length - 1];
};
const pad = (n, l = 2) => String(n).padStart(l, "0");

const store = new Map();
function dataset(service, year, gu) {
  const k = `${service}|${year}|${gu.code}`;
  if (store.has(k)) return store.get(k);
  const r = rng(hash(k));
  const isRent = service === "tbLnOpendataRentV";
  const size = gu.name === "강남구" ? 3.4 : 0.6 + r() * 0.9; // 강남구는 여러 part 분할을 시험하도록 크게
  const lastMonth = year === 2026 ? 9 : 12;
  const n = Math.round((isRent ? 14000 : 2600) * size * (lastMonth / 12));
  const yearIdx = { 2024: 0.9, 2025: 0.95, 2026: 1 }[year];
  const dongW = gu.dongs.map((d) => ({ ...d, w: 0.3 + r() * 1.7 }));
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = pickW(r, TYPES);
    const d = pickW(r, dongW);
    let m = 1 + Math.floor(r() * lastMonth);
    let y = year;
    if (r() < 0.04) { y = year - 1; m = 12; } // 전년 12월 계약 → 올해 신고
    const day = `${y}${pad(m)}${pad(1 + Math.floor(r() * 28))}`;
    const [mu, sd, lo, hi] = t.area;
    const area = Math.round(Math.min(hi, Math.max(lo, mu + gauss(r) * sd)) * 100) / 100;
    const dongBias = 0.85 + (hash(d.name) % 30) / 100;
    const trend = yearIdx * (1 + 0.004 * (m - 1)) * (y < year ? 0.99 : 1);
    const perM2 = BASE[gu.name] * t.mult * dongBias * trend * Math.pow(area / 60, -0.1) * (1 + gauss(r) * 0.1);
    const built = String(1985 + Math.floor(r() * 39));
    const bname =
      t.name === "아파트" ? `${d.name.replace(/\d*동$/, "")}${BRANDS[hash(d.name + i % 3) & 7]}` :
      t.name === "오피스텔" ? `${d.name.replace(/\d*동$/, "")}타워` :
      t.name === "연립다세대" ? `${d.name.replace(/\d*동$/, "")}빌라 ${1 + (i % 5)}차` : "";
    const base = {
      RCPT_YR: String(year), CGG_CD: gu.code, CGG_NM: gu.name, STDG_CD: d.code, STDG_NM: d.name,
      LOTNO_SE: "1", LOTNO_SE_NM: "대지", MNO: pad(1 + (i % 900), 4), SNO: "0000",
      FLR: t.name === "단독다가구" ? "" : String(1 + Math.floor(r() * 20)), CTRT_DAY: day,
      BLDG_NM: bname, ARCH_YR: built, BLDG_USG: t.name,
    };
    if (isRent) {
      const jeonse = r() < t.jeonse;
      const full = perM2 * area;
      const deposit = jeonse ? full : full * (0.04 + r() * 0.35);
      const rent = jeonse ? 0 : ((full - deposit) * 0.05) / 12;
      rows.push({
        ...base, RENT_SE: jeonse ? "전세" : "월세", RENT_AREA: String(area),
        GRFE: String(Math.round(deposit / 100) * 100 || 500), RTFE: String(Math.max(0, Math.round(rent))),
        CTRT_PRD: `${day.slice(2, 4)}.${day.slice(4, 6)}~${+day.slice(2, 4) + 2}.${day.slice(4, 6)}`,
        NEW_UPDT_YN: r() < 0.3 ? "갱신" : "신규", CTRT_UPDT_USE_YN: "", BFR_GRFE: "", BFR_RTFE: "",
      });
    } else {
      const salePerM2 = perM2 / t.sale;
      rows.push({
        ...base, THING_AMT: String(Math.round((salePerM2 * area) / 10) * 10), ARCH_AREA: String(area),
        LAND_AREA: String(Math.round(area * (t.name === "단독다가구" ? 1.4 : 0.3) * 100) / 100),
        RGHT_SE: "", RTRCN_DAY: r() < 0.06 ? `${y}${pad(Math.min(12, m + 1))}15` : "",
        DCLR_SE: r() < 0.85 ? "중개거래" : "직거래", OPBIZ_RESTAGNT_SGG_NM: `서울 ${gu.name}`,
      });
    }
  }
  rows.sort((a, b) => b.CTRT_DAY.localeCompare(a.CTRT_DAY));
  store.set(k, rows);
  return rows;
}

http
  .createServer((req, res) => {
    const segs = decodeURI(req.url.split("?")[0]).split("/").slice(1).map((s) => s.trim());
    const [key, type, service, startS, endS, year, cgg, , stdg, , , , , , usg] = segs;
    const send = (obj) => {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(obj));
    };
    if (Math.random() < FAIL_RATE) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end("<html>잠시 후 다시 시도</html>");
    }
    if (key !== KEY) return send({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } });
    if (type !== "json" || !["tbLnOpendataRentV", "tbLnOpendataRtmsV"].includes(service))
      return send({ RESULT: { CODE: "ERROR-500", MESSAGE: "서비스 없음" } });
    const start = Number(startS), end = Number(endS);
    if (end - start >= 1000) return send({ RESULT: { CODE: "ERROR-336", MESSAGE: "최대 1000건" } });
    const gu = districts.find((g) => g.code === cgg);
    if (!gu || !["2024", "2025", "2026"].includes(year)) return send({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });
    let rows = dataset(service, Number(year), gu);
    if (stdg) rows = rows.filter((x) => x.STDG_CD === stdg);
    if (usg) rows = rows.filter((x) => x.BLDG_USG === usg);
    if (!rows.length) return send({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });
    setTimeout(() => send({
      [service]: {
        list_total_count: rows.length,
        RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다" },
        row: rows.slice(start - 1, end),
      },
    }), 20 + Math.random() * 60);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock Seoul OpenAPI on http://127.0.0.1:${PORT} (key=${KEY})`));
