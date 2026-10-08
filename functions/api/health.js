// GET /api/health — 배포 점검용. 키 값은 절대 노출하지 않고 설정 여부만 알려 줍니다.
import { json } from "../../lib/seoul.js";

export const onRequestGet = ({ env }) =>
  json({ ok: true, keyConfigured: Boolean(env.SEOUL_API_KEY), time: new Date().toISOString() });
