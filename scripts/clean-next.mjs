import { rm } from "node:fs/promises";

const nextDir = new URL("../.next", import.meta.url);

await rm(nextDir, { recursive: true, force: true });
