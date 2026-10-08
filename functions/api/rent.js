// GET /api/rent?gu=11680&dong=10100&type=아파트&year=2026&part=0
// 서울시 부동산 전월세가 정보(tbLnOpendataRentV) 프록시 — SEOUL_API_KEY는 서버에서만 사용
import { handleDataRequest, json } from "../../lib/seoul.js";

export const onRequestGet = (context) => handleDataRequest("rent", context);
export const onRequest = () => json({ error: "Method Not Allowed" }, 405, { Allow: "GET" });
