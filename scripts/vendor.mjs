// node_modules 의 차트 라이브러리를 public/vendor 로 복사 (CDN 의존 없이 배포)
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync(new URL("../public/vendor/", import.meta.url), { recursive: true });
for (const [from, to] of [
  ["echarts/dist/echarts.min.js", "echarts.min.js"],
  ["echarts-gl/dist/echarts-gl.min.js", "echarts-gl.min.js"],
]) {
  copyFileSync(new URL(`../node_modules/${from}`, import.meta.url), new URL(`../public/vendor/${to}`, import.meta.url));
  console.log("copied", to);
}
