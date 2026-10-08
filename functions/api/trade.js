// GET /api/trade?gu=11680&dong=10100&type=아파트&year=2026&part=0
// 서울시 부동산 실거래가 정보(tbLnOpendataRtmsV) 프록시 — 해제(취소) 거래는 제외
import { handleDataRequest, json } from "../../lib/seoul.js";

export const onRequestGet = (context) => handleDataRequest("trade", context);
export const onRequest = () => json({ error: "Method Not Allowed" }, 405, { Allow: "GET" });
