import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { SITE_NAME } from "@/lib/seo";

export const alt = "FreeSign — 프리랜서 계약·정산 올인원";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const pretendard = await readFile(
    path.join(process.cwd(), "public", "fonts", "Pretendard-Regular.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          backgroundColor: "#f8fafc",
          fontFamily: "Pretendard",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              backgroundColor: "#2563eb",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "34px",
            }}
          >
            F
          </div>
          <div style={{ fontSize: "40px", color: "#0f172a" }}>{SITE_NAME}</div>
        </div>
        <div
          style={{
            marginTop: "48px",
            fontSize: "72px",
            lineHeight: 1.25,
            color: "#0f172a",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span>계약부터 입금·세금까지,</span>
          <span>하나의 흐름으로</span>
        </div>
        <div style={{ marginTop: "32px", fontSize: "32px", color: "#334155" }}>
          프리랜서를 위한 전자계약·정산 올인원
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Pretendard",
          data: pretendard,
          weight: 400,
          style: "normal",
        },
      ],
    },
  );
}
