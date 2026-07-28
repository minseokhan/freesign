import { rm } from "node:fs/promises";

// next.config.ts의 distDir과 같은 규칙 — 검증 빌드는 자기 디렉토리만 지운다.
const nextDir = new URL(`../${process.env.NEXT_DIST_DIR ?? ".next"}`, import.meta.url);

await rm(nextDir, { recursive: true, force: true });
