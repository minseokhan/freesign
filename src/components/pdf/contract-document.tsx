import path from "node:path";

import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { ContractPdfModel } from "@/lib/contracts/pdf";

const fontPath = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Pretendard-Regular.ttf",
);

Font.register({
  family: "Pretendard",
  fonts: [
    { src: fontPath, fontWeight: 400 },
    { src: fontPath, fontWeight: 600 },
    { src: fontPath, fontWeight: 700 },
  ],
});

Font.registerHyphenationCallback((word) => [word]);

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Pretendard",
    fontSize: 10,
    lineHeight: 1.6,
    color: "#334155",
    backgroundColor: "#ffffff",
  },
  header: {
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  eyebrow: {
    fontSize: 8,
    color: "#64748b",
    letterSpacing: 0.8,
  },
  title: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: 700,
    color: "#0f172a",
  },
  disclaimer: {
    marginTop: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: "#fde68a",
    borderStyle: "solid",
    borderRadius: 6,
    backgroundColor: "#fffbeb",
    color: "#92400e",
    fontSize: 9,
  },
  section: {
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#0f172a",
    marginBottom: 8,
  },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 8,
  },
  metaItem: {
    width: "50%",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  metaLabel: {
    fontSize: 8,
    color: "#64748b",
    marginBottom: 3,
  },
  metaValue: {
    fontSize: 10,
    color: "#0f172a",
  },
  bodyText: {
    whiteSpace: "pre-wrap",
  },
  clause: {
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 8,
  },
  clauseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  clauseTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "#0f172a",
  },
  reviewBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#fffbeb",
    color: "#b45309",
    fontSize: 8,
  },
  clauseBody: {
    marginTop: 8,
    whiteSpace: "pre-wrap",
  },
  summary: {
    marginTop: 10,
    padding: 8,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
  },
  summaryLabel: {
    fontSize: 8,
    color: "#64748b",
    marginBottom: 3,
  },
  hash: {
    marginTop: 6,
    fontSize: 8,
    color: "#475569",
  },
  signatureBox: {
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 8,
  },
  signatureImage: {
    width: 260,
    height: 88,
    objectFit: "contain",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    backgroundColor: "#ffffff",
  },
  signatureMeta: {
    marginTop: 8,
    fontSize: 9,
    color: "#475569",
  },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 24,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
    borderTopStyle: "solid",
    fontSize: 8,
    color: "#94a3b8",
  },
});

export function ContractDocument({ document }: { document: ContractPdfModel }) {
  return (
    <Document
      title={document.title}
      author="FreeSign"
      subject="FreeSign v1 contract PDF"
      language="ko-KR"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>FREESIGN CONTRACT</Text>
          <Text style={styles.title}>{document.title}</Text>
          <Text style={styles.disclaimer}>{document.disclaimer}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="클라이언트" value={document.clientName} />
            <MetaItem label="상태" value={document.status} />
            <MetaItem label="계약 금액" value={document.amountLabel} />
            <MetaItem label="계약 기간" value={document.periodLabel} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>업무 범위</Text>
          <Text style={styles.bodyText}>{document.scope}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>조항과 평문요약</Text>
          {document.plainSummary ? (
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>평문요약</Text>
              <Text>{document.plainSummary}</Text>
            </View>
          ) : null}
          {document.clauses.length === 0 ? (
            <Text>표시할 조항이 없습니다.</Text>
          ) : (
            document.clauses.map((clause, index) => (
              <View
                key={`${clause.title}-${index}`}
                style={styles.clause}
                wrap={false}
              >
                <View style={styles.clauseHeader}>
                  <Text style={styles.clauseTitle}>{clause.title}</Text>
                  {clause.needsReview ? (
                    <Text style={styles.reviewBadge}>검토 필요</Text>
                  ) : null}
                </View>
                <Text style={styles.clauseBody}>{clause.body}</Text>
                {/* 계약 전체 요약이 있으면 조항별 요약은 생략(중복 방지). 불러오기 계약만 조항별 노출. */}
                {document.plainSummary ? null : (
                  <View style={styles.summary}>
                    <Text style={styles.summaryLabel}>평문요약</Text>
                    <Text>{clause.plainSummary}</Text>
                  </View>
                )}
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>무결성 해시</Text>
          <Text style={styles.hash}>{document.docHash}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>서명</Text>
          <View style={styles.signatureBox}>
            {document.signatureImageDataUri ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not support DOM alt props.
              <Image
                src={document.signatureImageDataUri}
                style={styles.signatureImage}
              />
            ) : (
              <Text>저장된 서명 이미지가 없습니다.</Text>
            )}
            {document.signature ? (
              <Text style={styles.signatureMeta}>
                서명자: {document.signature.signer}
                {"\n"}서명 시각: {document.signature.signedAtLabel}
                {"\n"}IP: {document.signature.ip}
                {"\n"}User-Agent: {document.signature.ua}
              </Text>
            ) : (
              <Text style={styles.signatureMeta}>서명 메타데이터 없음</Text>
            )}
          </View>
          {/* 맞서명(v2) 상대방 서명 — 없으면 기존 owner 단독 레이아웃 그대로. */}
          {document.counterpartySignature ? (
            <View style={styles.signatureBox}>
              {document.counterpartySignature.imageDataUri ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image does not support DOM alt props.
                <Image
                  src={document.counterpartySignature.imageDataUri}
                  style={styles.signatureImage}
                />
              ) : (
                <Text>저장된 상대방 서명 이미지가 없습니다.</Text>
              )}
              <Text style={styles.signatureMeta}>
                상대방 서명자: {document.counterpartySignature.name}
                {"\n"}서명 시각: {document.counterpartySignature.signedAtLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `FreeSign v1 기록용 계약 PDF · ${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaItem}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}
