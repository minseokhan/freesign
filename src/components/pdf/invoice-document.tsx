import path from "node:path";

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import type { InvoicePdfDocument } from "@/lib/invoices/pdf";

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
    fontSize: 24,
    // lineHeight는 page에서 상속되지 않는다. 명시하지 않으면 24pt 글자의 줄 상자가
    // 글리프보다 작게 잡혀 바로 아래 문서번호와 겹친다.
    lineHeight: 1.3,
    fontWeight: 700,
    color: "#0f172a",
  },
  invoiceNumber: {
    marginTop: 4,
    fontSize: 9,
    color: "#64748b",
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
  totalBox: {
    padding: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderStyle: "solid",
    borderRadius: 8,
  },
  amountRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    borderBottomStyle: "solid",
  },
  amountLabel: {
    color: "#475569",
  },
  amountValue: {
    color: "#0f172a",
    fontWeight: 600,
  },
  netRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 10,
  },
  netLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: "#0f172a",
  },
  netValue: {
    fontSize: 16,
    fontWeight: 700,
    color: "#0f172a",
  },
  note: {
    marginTop: 8,
    fontSize: 9,
    color: "#64748b",
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

export function InvoiceDocument({ document }: { document: InvoicePdfDocument }) {
  return (
    <Document
      title={document.title}
      author="Maedeup"
      subject="Maedeup invoice PDF"
      language="ko-KR"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>MAEDEUP INVOICE</Text>
          <Text style={styles.title}>인보이스</Text>
          <Text style={styles.invoiceNumber}>
            인보이스 번호: {document.invoiceNumber}
          </Text>
          <Text style={styles.disclaimer}>{document.disclaimer}</Text>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>기본 정보</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="클라이언트" value={document.clientName} />
            <MetaItem label="계약" value={document.contractTitle} />
            <MetaItem label="발행일" value={document.issueDateLabel} />
            <MetaItem label="지급기한" value={document.dueDateLabel} />
            <MetaItem label="정산 상태" value={document.paymentStatusLabel} />
            <MetaItem label="입금일" value={document.paidAtLabel ?? "미입금"} />
          </View>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>품목</Text>
          <View style={styles.metaGrid}>
            <MetaItem label="품목명" value={document.contractTitle} />
            <MetaItem label="청구 금액" value={document.amountLabel} />
          </View>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>금액 및 원천징수</Text>
          <View style={styles.totalBox}>
            <AmountRow label="청구 금액" value={document.amountLabel} />
            {document.showWithholdingDetails ? (
              <>
                <AmountRow
                  label={`원천징수 (${document.withholdingTypeLabel})`}
                  value={`- ${document.withholdingAmountLabel}`}
                />
              </>
            ) : (
              <AmountRow label="원천징수" value={document.withholdingTypeLabel} />
            )}
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>실수령액</Text>
              <Text style={styles.netValue}>{document.netAmountLabel}</Text>
            </View>
          </View>
          <Text style={styles.note}>
            금액은 발행 시점에 저장된 스냅샷이며 PDF 생성 시 재계산하지
            않습니다.
          </Text>
        </View>

        <View style={styles.section} wrap={false}>
          <Text style={styles.sectionTitle}>입금 계좌</Text>
          {document.bankAccount ? (
            <View style={styles.metaGrid}>
              <MetaItem label="은행" value={document.bankAccount.bankName} />
              <MetaItem
                label="계좌번호"
                value={document.bankAccount.accountNumber}
              />
              <MetaItem
                label="예금주"
                value={document.bankAccount.accountHolder}
              />
            </View>
          ) : (
            <Text>등록된 입금 계좌가 없습니다.</Text>
          )}
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `매듭 인보이스 기록용 PDF · ${pageNumber} / ${totalPages}`
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

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.amountRow}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={styles.amountValue}>{value}</Text>
    </View>
  );
}
