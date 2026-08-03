import path from "node:path";

import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type {
  CertificateDocumentProps,
  CertificateSignerBlock,
  CertificateTsaEntry,
} from "@/lib/contracts/certificate";

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
    fontSize: 20,
    fontWeight: 700,
    color: "#0f172a",
  },
  headerMeta: {
    marginTop: 8,
    fontSize: 9,
    color: "#475569",
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
  hashBox: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },
  hashText: {
    fontSize: 9,
    color: "#0f172a",
  },
  block: {
    marginTop: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 8,
  },
  blockTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#0f172a",
  },
  blockLine: {
    marginTop: 4,
    fontSize: 9,
    color: "#475569",
  },
  identityLine: {
    marginTop: 6,
    fontSize: 9,
    color: "#92400e",
  },
  timelineRow: {
    flexDirection: "row",
    marginTop: 6,
  },
  timelineTime: {
    width: 150,
    fontSize: 9,
    color: "#64748b",
  },
  timelineBody: {
    flex: 1,
    fontSize: 9,
    color: "#334155",
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

export function CertificateDocument({
  certificate,
}: {
  certificate: CertificateDocumentProps;
}) {
  return (
    <Document
      title={`완결증명서 - ${certificate.contractTitle}`}
      author="Maedeup"
      subject="Maedeup signature audit trail certificate"
      language="ko-KR"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>MAEDEUP CERTIFICATE OF COMPLETION</Text>
          <Text style={styles.title}>완결증명서</Text>
          <Text style={styles.headerMeta}>
            계약 제목: {certificate.contractTitle}
            {"\n"}계약 ID: {certificate.contractId}
            {"\n"}증명서 생성 시각: {certificate.generatedAtLabel}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>문서 해시 (SHA-256)</Text>
          <View style={styles.hashBox}>
            <Text style={styles.hashText}>{certificate.docHash}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>서명자</Text>
          {certificate.signers.map((signer, index) => (
            <SignerBlock key={`${signer.party}-${index}`} signer={signer} />
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>감사추적 타임라인</Text>
          {certificate.timeline.length === 0 ? (
            <Text style={styles.blockLine}>기록된 이벤트가 없습니다.</Text>
          ) : (
            certificate.timeline.map((item, index) => (
              <View key={`${item.label}-${index}`} style={styles.timelineRow}>
                <Text style={styles.timelineTime}>{item.atLabel}</Text>
                <Text style={styles.timelineBody}>
                  {item.label} · {item.actor}
                </Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>제3자 타임스탬프 (RFC 3161)</Text>
          <View style={styles.block}>
            <Text style={styles.blockLine}>
              TSA URL: {certificate.tsa.tsaUrl ?? "미설정"}
            </Text>
            <TsaLine label="발송 시점 토큰" entry={certificate.tsa.sent} />
            <TsaLine label="완결 시점 토큰" entry={certificate.tsa.completion} />
            <Text style={styles.blockLine}>
              {certificate.tsa.verifyInstruction}
            </Text>
          </View>
        </View>

        <Text style={styles.disclaimer}>{certificate.disclaimer}</Text>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `매듭 완결증명서 · ${pageNumber} / ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

function SignerBlock({ signer }: { signer: CertificateSignerBlock }) {
  return (
    <View style={styles.block} wrap={false}>
      <Text style={styles.blockTitle}>{signer.partyLabel}</Text>
      <Text style={styles.blockLine}>
        이름: {signer.name}
        {"\n"}이메일: {signer.email}
        {"\n"}서명 시각: {signer.signedAtLabel}
        {"\n"}IP: {signer.ip}
        {"\n"}User-Agent: {signer.ua}
        {"\n"}동의 항목:{" "}
        {signer.consentLabels.length > 0
          ? signer.consentLabels.join(", ")
          : "기록 없음"}
      </Text>
      <Text style={styles.identityLine}>
        신원확인 수준: {signer.identityLevel}
      </Text>
    </View>
  );
}

function TsaLine({
  label,
  entry,
}: {
  label: string;
  entry: CertificateTsaEntry;
}) {
  return (
    <Text style={styles.blockLine}>
      {label}:{" "}
      {entry.present ? `확보 (지문 sha256 ${entry.fingerprint})` : "타임스탬프 미확보"}
    </Text>
  );
}
