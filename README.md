# seoul_rent_api — 서울 전월세 3D 보드

서울 열린데이터광장 OpenAPI를 **실시간**으로 호출해, 사용자가 고른 자치구·법정동·주택유형의 2026년(선택 시 2024–2025 포함) 전월세 신고 자료로 **평균 전세가**를 계산하고, **면적당 전월세가를 3D·시계열**로 보여 주는 대시보드입니다. 같은 조건의 **매매 실거래가**는 별도 창에서 한눈에 볼 수 있습니다.

- 메인 보드 `/` — 평균 전세가·㎡당 전세가·월세 지표, 면적대(또는 법정동) × 계약월 3D 막대, 월별 재생 타임라인, 월별 추이, 면적대별 요약, 최근 계약
- 실거래가 창 `/trade.html` — 평균·중위 거래가, ㎡당 매매가, 전세가율, 면적×거래가 산점도, 월별 추이, 법정동/단지별 순위, 정렬·검색 가능한 거래 목록

## 구조 (옵션 2: 서버 측 프록시)

```
브라우저
   ↓  GET /api/rent?gu=11680&dong=10100&type=아파트&year=2026
Cloudflare Pages Function  (functions/api/rent.js, trade.js)
   ↓  서버에서만 env.SEOUL_API_KEY 사용 · 1,000건 단위 페이지 병렬 조회 · 재시도 · 엣지 캐시
서울 열린데이터광장 OpenAPI  (tbLnOpendataRentV / tbLnOpendataRtmsV)
   ↓  JSON
Pages Function
   ↓  화면에 필요한 12개 필드만 배열로 압축해 반환 (API 키·원본 URL 미포함)
브라우저  →  평균 전세가 계산, 3D·시계열 렌더링
```

**API 키는 코드·저장소·브라우저 어디에도 없습니다.** 키는 Cloudflare의 Secret(`SEOUL_API_KEY`)으로만 등록하고, Pages Function이 서버에서 읽어 서울시 API를 호출합니다. 프론트엔드는 빌드 단계 없이 정적 파일만 배포하므로 환경 변수가 번들에 섞여 들어갈 여지도 없습니다.

## 폴더

```
public/                 정적 프론트엔드 (빌드 없음)
  index.html            메인 3D 보드
  trade.html            실거래가 창
  assets/               style.css, common.js, board.js, trade.js
  data/districts.json   25개 자치구 · 467개 법정동 코드
  vendor/               ECharts 6.1 · ECharts GL 2.1 (CDN 없이 자체 호스팅)
  _headers              보안 헤더(CSP 등)
functions/api/
  rent.js               GET /api/rent   → 서울시 부동산 전월세가 정보
  trade.js              GET /api/trade  → 서울시 부동산 실거래가 정보 (해제 거래 제외)
  health.js             GET /api/health → 키 설정 여부만 확인 (값은 노출 안 함)
lib/seoul.js            입력 검증 · 페이지 분할 조회 · 재시도 · 응답 압축 · 엣지 캐시
scripts/
  mock-seoul-api.mjs    키 없이 로컬 점검용 모의 서버 (실제 데이터 아님)
  vendor.mjs            node_modules → public/vendor 복사
wrangler.toml           Pages 설정 (키는 넣지 않음)
```

## API

| 엔드포인트 | 파라미터 | 설명 |
|---|---|---|
| `GET /api/rent` | `gu`(필수, 5자리) · `dong`(5자리, 비우면 구 전체) · `type`(아파트/연립다세대/오피스텔/단독다가구) · `year`(2024–2026) · `part` | 전월세 신고 자료 |
| `GET /api/trade` | 위와 동일 | 매매 실거래 자료 (해제 거래 제외) |
| `GET /api/health` | – | `{ keyConfigured: true/false }` |

응답 예: `{ total, parts, fields: ["day","dongCd","dong","se","area","deposit","rent",...], rows: [[...], ...] }`

- 서울시 API는 1회 최대 1,000건이라 페이지를 나눠 받습니다. Cloudflare 무료 플랜의 함수당 서브요청 한도(50)를 넘지 않도록 **한 번에 최대 30페이지(30,000건)** 를 받고, 그보다 많으면 `parts`로 알려 주어 브라우저가 `part=1,2…`를 이어서 요청합니다.
- 주택유형은 서울시 API의 `BLDG_USG` 인자로 먼저 걸러 받고, 0건이면 필터 없이 다시 받아 서버에서 거릅니다.
- 같은 조건의 응답은 Cloudflare 엣지 캐시에 3시간(지난 연도는 24시간) 보관합니다.
- 입력값은 화이트리스트로 검증하고, 다른 사이트에서의 호출(`Sec-Fetch-Site: cross-site`)은 403으로 막습니다.

## 배포 (Cloudflare Pages + GitHub)

1. **GitHub 저장소** `seoul_rent_api` 를 만들고 이 폴더를 올립니다.
   ```bash
   git remote add origin https://github.com/<내 계정>/seoul_rent_api.git
   git push -u origin main
   ```
2. **Cloudflare 대시보드 → Workers & Pages → 만들기 → Pages → Git에 연결** 에서 `seoul_rent_api` 저장소를 고릅니다.
   - 프레임워크 프리셋: 없음 · 빌드 명령: 비움 · 빌드 출력 디렉터리: `public`
   - `functions/` 폴더는 자동으로 Pages Functions로 배포됩니다.
3. **설정 → 변수 및 비밀(Variables and Secrets) → 추가**: 이름 `SEOUL_API_KEY`, 유형 **Secret(암호화)**, 값은 서울 열린데이터광장 인증키. 프로덕션(필요하면 미리보기도)에 저장한 뒤 **다시 배포**합니다.
4. 확인: `https://<프로젝트>.pages.dev/api/health` 가 `"keyConfigured": true` 이면 준비 완료입니다.

CLI로 배포할 수도 있습니다.

```bash
npm install
npx wrangler login
npx wrangler pages project create seoul-rent-api --production-branch main
npx wrangler pages secret put SEOUL_API_KEY --project-name seoul-rent-api   # 프롬프트에 키 입력
npm run deploy
```

## 로컬 실행

```bash
npm install
cp .dev.vars.example .dev.vars     # SEOUL_API_KEY=발급받은키  (.dev.vars는 git에 올라가지 않음)
npm run dev                        # http://localhost:8788
```

키 없이 화면만 점검하려면 모의 서버를 쓸 수 있습니다 (`.dev.vars`에 `SEOUL_API_BASE=http://127.0.0.1:8099`, `SEOUL_API_KEY=MOCKKEY` 후 `npm run mock` 과 `npm run dev`). 배포 환경에는 `SEOUL_API_BASE`를 설정하지 않으므로 항상 실제 `openapi.seoul.go.kr`를 호출합니다.

## 계산 방법

- **평균 전세가** = 전세 계약 보증금(만원)의 산술평균. 중위값도 함께 표시합니다.
- **㎡당 가격** = 계약마다 (전세 보증금 또는 월세) ÷ 임대면적을 구한 뒤 평균. 3.3㎡(평)당 값은 × 3.305785.
- **상단 지표**는 선택한 연도 중 가장 최근 접수연도(RCPT_YR) 기준이며, 직전 연도를 함께 고르면 전년 대비 증감을 보여 줍니다.
- **월별 추이·3D 보드**는 계약일(CTRT_DAY) 기준 월평균입니다. 계약 3건 미만인 칸은 툴팁에 “표본 적음”으로 표시합니다.
- 계약 후 30일 안에 신고하므로 **이번 달·지난 달은 아직 집계 중**입니다. 추이선은 이 구간을 점선, 건수 막대는 옅게 그려 일시적 하락으로 오해하지 않게 했습니다.
- 접수연도와 계약연도는 다를 수 있습니다(예: 2026년 접수분에 2025년 11–12월 계약 포함). 월별 축은 선택한 연도 범위 안의 계약만 그립니다.
- **전세가율** = 메인 보드의 ㎡당 평균 전세가 ÷ 실거래가 창의 ㎡당 평균 매매가 (같은 자치구·동·유형·연도일 때만).

## 실제 API 검증 결과 (2026-10-08)

실제 인증키로 `wrangler pages dev`를 띄워 확인했습니다.

| 조회 | 결과 |
|---|---|
| 역삼동 · 아파트 · 2026 전월세 | 1,548건 (서울시 API의 BLDG_USG 필터로 받음), 평균 전세가 9억 3,773만원 |
| 역삼동 · 전체 · 2026 전월세 | 5,838건 (아파트 1,548 · 연립다세대 1,671 · 오피스텔 1,335 · 단독다가구 1,284) |
| 역삼동 · 전체 · 2026 매매 | 826건 중 해제 48건 제외 → 778건 |
| 강남구 전체 · 2026 전월세 | 27,448건, 약 3초 |
| 같은 조건 재조회 | 엣지 캐시 HIT, 16ms |

## 참고 · 한계

- 서울시 OpenAPI는 최근 3개 접수연도(2024–2026)만 제공합니다.
- 자치구 전체(동 미선택)는 응답이 큽니다. 실측: 강남구 2026년 전월세 27,448건이 약 3초·2.1MB, 같은 조건 두 번째 조회는 엣지 캐시로 수십 ms.
- ECharts GL(3D)이 내부에서 `new Function`을 사용하므로 CSP의 `script-src`에 `'unsafe-eval'`을 허용했습니다. 외부 스크립트·인라인 스크립트는 여전히 차단됩니다.
- 실거래가 응답 필드명이 바뀌면 `/api/trade` 응답의 `upstreamKeys`로 원본 필드명을 확인해 `lib/seoul.js`의 `compactTrade`만 고치면 됩니다.

데이터 출처: 서울 열린데이터광장 「서울시 부동산 전월세가 정보」, 「서울시 부동산 실거래가 정보」
