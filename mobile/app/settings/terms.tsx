import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, getThemeColors, getThemeShadows } from "../../src/constants/theme";
import { useThemeMode } from "../../src/stores/theme";
import { useLocale } from "../../src/hooks/useLocale";

const isWeb = Platform.OS === "web";

type TabKey = "terms" | "privacy";

// ── Legal Section Component ──────────────────────────────────────────────────
function LegalSection({
  title,
  children,
  icon,
  tc,
  ts,
  isDesktop,
}: {
  title: string;
  children: React.ReactNode;
  icon: keyof typeof Ionicons.glyphMap;
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  isDesktop: boolean;
}) {
  return (
    <View style={{ marginBottom: 24 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            backgroundColor: colors.primary[500] + "15",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={16} color={colors.primary[400]} />
        </View>
        <Text
          style={{
            color: tc.textPrimary,
            fontSize: isDesktop ? 18 : 16,
            fontFamily: "DMSans_700Bold",
            letterSpacing: -0.2,
          }}
        >
          {title}
        </Text>
      </View>
      <View
        style={{
          backgroundColor: tc.dark.card,
          borderRadius: 16,
          padding: isDesktop ? 24 : 18,
          borderWidth: 1,
          borderColor: tc.glass.border,
          ...ts.sm,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Paragraph({
  children,
  tc,
  bold,
}: {
  children: string;
  tc: ReturnType<typeof getThemeColors>;
  bold?: boolean;
}) {
  return (
    <Text
      style={{
        color: bold ? tc.textPrimary : tc.textSecondary,
        fontSize: 14,
        lineHeight: 22,
        fontFamily: bold ? "DMSans_600SemiBold" : "DMSans_400Regular",
        marginBottom: 10,
      }}
    >
      {children}
    </Text>
  );
}

function BulletPoint({
  children,
  tc,
}: {
  children: string;
  tc: ReturnType<typeof getThemeColors>;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 8, marginBottom: 6, paddingLeft: 4 }}>
      <Text style={{ color: colors.primary[400], fontSize: 14, lineHeight: 22 }}>
        {"\u2022"}
      </Text>
      <Text
        style={{
          color: tc.textSecondary,
          fontSize: 14,
          lineHeight: 22,
          fontFamily: "DMSans_400Regular",
          flex: 1,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

// ── Terms of Service Content ─────────────────────────────────────────────────
function TermsContent({
  tc,
  ts,
  isDesktop,
}: {
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  isDesktop: boolean;
}) {
  return (
    <>
      {/* Effective date */}
      <View
        style={{
          backgroundColor: colors.primary[500] + "10",
          borderRadius: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.primary[500] + "20",
          marginBottom: 24,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.primary[400]} />
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          Effective Date: March 13, 2026 | Last Updated: March 13, 2026
        </Text>
      </View>

      <LegalSection title="1. About CryptoPay" icon="business-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          CryptoPay is a digital payment platform operated by CryptoPay Technologies Ltd, a company registered in the Republic of Kenya. We enable users to hold cryptocurrency wallets and make payments to Kenyan businesses via M-Pesa integration.
        </Paragraph>
        <Paragraph tc={tc}>
          By creating an account, accessing our mobile application, or using any CryptoPay services, you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, do not use the Service.
        </Paragraph>
      </LegalSection>

      <LegalSection title="2. Eligibility" icon="person-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>To use CryptoPay, you must:</Paragraph>
        <BulletPoint tc={tc}>Be at least 18 years of age</BulletPoint>
        <BulletPoint tc={tc}>Be a resident of Kenya or an eligible jurisdiction</BulletPoint>
        <BulletPoint tc={tc}>Have a valid Kenyan mobile number registered with an M-Pesa account</BulletPoint>
        <BulletPoint tc={tc}>Provide accurate, current, and complete identity information as required for KYC verification</BulletPoint>
        <BulletPoint tc={tc}>Not be listed on any international sanctions list or be a Politically Exposed Person (PEP) without proper disclosure</BulletPoint>
      </LegalSection>

      <LegalSection title="3. Account Registration & KYC" icon="shield-checkmark-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          You must register an account with a valid email, phone number, and full legal name. We are required to perform Know Your Customer (KYC) verification in compliance with the Proceeds of Crime and Anti-Money Laundering Act (Cap. 59B, Laws of Kenya) and the Central Bank of Kenya directives.
        </Paragraph>
        <Paragraph tc={tc}>
          You agree to provide valid government-issued identification (National ID, Passport, or Alien Card) and may be asked for additional verification documents. Failure to complete KYC may result in restricted access or account suspension.
        </Paragraph>
        <Paragraph tc={tc}>
          You are responsible for maintaining the confidentiality of your account credentials, including your PIN, TOTP authenticator codes, and recovery phrases. CryptoPay will never ask for your PIN or recovery codes.
        </Paragraph>
      </LegalSection>

      <LegalSection title="4. Supported Services" icon="card-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc} bold>CryptoPay enables the following services:</Paragraph>
        <BulletPoint tc={tc}>Cryptocurrency deposits (USDT, USDC, BTC, ETH, SOL) to your CryptoPay wallet via on-chain transfers</BulletPoint>
        <BulletPoint tc={tc}>Bill payments to Kenyan Paybill numbers using your crypto balance, converted to KES at market rates</BulletPoint>
        <BulletPoint tc={tc}>Till payments to Lipa Na M-Pesa merchant numbers</BulletPoint>
        <BulletPoint tc={tc}>Person-to-person M-Pesa transfers funded by your crypto balance</BulletPoint>
        <BulletPoint tc={tc}>Buying cryptocurrency using M-Pesa (Lipa Na M-Pesa STK Push)</BulletPoint>
        <Paragraph tc={tc}>
          All KES payouts are processed through Safaricom M-Pesa. CryptoPay acts as an intermediary facilitating the conversion of cryptocurrency to Kenya Shillings at prevailing market rates.
        </Paragraph>
      </LegalSection>

      <LegalSection title="5. Exchange Rates & Fees" icon="trending-up-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          Exchange rates are sourced from multiple market data providers and are quoted in real-time. When you initiate a transaction, you receive a locked rate quote that is valid for a limited time (typically 60 seconds).
        </Paragraph>
        <Paragraph tc={tc}>
          CryptoPay charges a transparent service fee on each transaction, which is displayed before you confirm. The fee varies by transaction type and amount. Additional M-Pesa transaction charges from Safaricom may apply and are passed through at cost.
        </Paragraph>
        <Paragraph tc={tc}>
          Once a transaction is confirmed and submitted, it is irreversible. The locked exchange rate and fee are final.
        </Paragraph>
      </LegalSection>

      <LegalSection title="6. Transaction Limits" icon="resize-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>Transactions are subject to the following limits, which may be adjusted:</Paragraph>
        <BulletPoint tc={tc}>Minimum transaction: KES 10</BulletPoint>
        <BulletPoint tc={tc}>Maximum single transaction: KES 150,000 (M-Pesa limit)</BulletPoint>
        <BulletPoint tc={tc}>Daily transaction limit: Subject to your KYC verification level</BulletPoint>
        <BulletPoint tc={tc}>Monthly aggregate limit: Subject to your KYC verification level and AML monitoring</BulletPoint>
        <Paragraph tc={tc}>
          Higher limits may be available upon completing enhanced due diligence (EDD). CryptoPay reserves the right to lower limits or pause services based on risk assessments or regulatory requirements.
        </Paragraph>
      </LegalSection>

      <LegalSection title="7. Prohibited Activities" icon="ban-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>You may not use CryptoPay for:</Paragraph>
        <BulletPoint tc={tc}>Money laundering, terrorism financing, or any activity prohibited by Kenyan or international law</BulletPoint>
        <BulletPoint tc={tc}>Transactions involving sanctioned individuals, entities, or jurisdictions</BulletPoint>
        <BulletPoint tc={tc}>Fraud, market manipulation, or deceptive practices</BulletPoint>
        <BulletPoint tc={tc}>Circumventing transaction limits through structuring (smurfing)</BulletPoint>
        <BulletPoint tc={tc}>Automated or bot-driven trading or payment activity without authorization</BulletPoint>
        <BulletPoint tc={tc}>Purchasing illegal goods, services, or contraband</BulletPoint>
        <Paragraph tc={tc}>
          CryptoPay employs transaction monitoring systems and will report suspicious activity to the Financial Reporting Centre (FRC) of Kenya as required by law.
        </Paragraph>
      </LegalSection>

      <LegalSection title="8. Wallet Custody & Security" icon="wallet-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          CryptoPay operates a custodial wallet service. Your cryptocurrency is held in segregated wallets derived from a secure hierarchical deterministic (HD) wallet system. Private keys are managed by CryptoPay and are never exposed to users.
        </Paragraph>
        <Paragraph tc={tc}>
          We implement industry-standard security measures including encrypted storage, multi-signature authorization for large movements, hot/cold wallet segregation, and regular security audits. However, no system is completely secure, and you acknowledge the inherent risks of holding digital assets.
        </Paragraph>
        <Paragraph tc={tc}>
          CryptoPay is not a bank and your balances are not insured by the Kenya Deposit Insurance Corporation (KDIC) or any government deposit protection scheme.
        </Paragraph>
      </LegalSection>

      <LegalSection title="9. Intellectual Property" icon="sparkles-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          All content, branding, software, and technology comprising CryptoPay are the intellectual property of CryptoPay Technologies Ltd. You are granted a limited, non-exclusive, non-transferable license to use the application for its intended purpose.
        </Paragraph>
        <Paragraph tc={tc}>
          You may not copy, modify, reverse-engineer, distribute, or create derivative works based on the CryptoPay application or its underlying technology.
        </Paragraph>
      </LegalSection>

      <LegalSection title="10. Limitation of Liability" icon="alert-circle-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          To the maximum extent permitted by Kenyan law, CryptoPay shall not be liable for: indirect, incidental, or consequential damages; loss of profits or cryptocurrency due to market volatility; service interruptions caused by network congestion, blockchain issues, or M-Pesa system downtime; unauthorized access due to user negligence in protecting credentials.
        </Paragraph>
        <Paragraph tc={tc}>
          Our total liability for any claim shall not exceed the total fees paid by you in the six (6) months preceding the claim. This limitation does not apply to liability for fraud, gross negligence, or death/personal injury caused by our negligence.
        </Paragraph>
      </LegalSection>

      <LegalSection title="11. Dispute Resolution" icon="chatbubbles-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          Any disputes arising from these Terms shall first be addressed through our internal complaints procedure. You may contact our support team at support@cpay.co.ke.
        </Paragraph>
        <Paragraph tc={tc}>
          If unresolved within 30 days, disputes shall be referred to mediation under the Nairobi Centre for International Arbitration (NCIA) rules. If mediation fails, disputes shall be resolved by binding arbitration in Nairobi, Kenya, under Kenyan law.
        </Paragraph>
        <Paragraph tc={tc}>
          Nothing in this clause limits your right to lodge a complaint with the Capital Markets Authority (CMA) of Kenya or the Communications Authority of Kenya (CA).
        </Paragraph>
      </LegalSection>

      <LegalSection title="12. Account Termination" icon="close-circle-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          You may close your account at any time by contacting support, provided you have no pending transactions and a zero crypto balance. CryptoPay may suspend or terminate your account for: violation of these Terms; failure to complete required KYC/AML checks; suspicious or fraudulent activity; regulatory requirements or court orders.
        </Paragraph>
        <Paragraph tc={tc}>
          Upon termination, any remaining cryptocurrency balance will be available for withdrawal for 90 days, after which unclaimed assets will be handled in accordance with applicable Kenyan unclaimed property laws.
        </Paragraph>
      </LegalSection>

      <LegalSection title="13. Amendments" icon="create-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          CryptoPay reserves the right to amend these Terms at any time. Material changes will be communicated via email and/or in-app notification at least 14 days before taking effect. Continued use of the Service after the effective date constitutes acceptance of the updated Terms.
        </Paragraph>
      </LegalSection>

      <LegalSection title="14. Governing Law" icon="globe-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          These Terms are governed by and construed in accordance with the laws of the Republic of Kenya, including the Kenya Information and Communications Act, the Data Protection Act 2019, and the Proceeds of Crime and Anti-Money Laundering Act. The courts of Kenya shall have exclusive jurisdiction over any legal proceedings.
        </Paragraph>
      </LegalSection>

      <LegalSection title="15. Contact" icon="mail-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc} bold>CryptoPay Technologies Ltd</Paragraph>
        <Paragraph tc={tc}>Email: legal@cpay.co.ke</Paragraph>
        <Paragraph tc={tc}>Support: support@cpay.co.ke</Paragraph>
        <Paragraph tc={tc}>Nairobi, Kenya</Paragraph>
      </LegalSection>
    </>
  );
}

// ── Privacy Policy Content ───────────────────────────────────────────────────
function PrivacyContent({
  tc,
  ts,
  isDesktop,
}: {
  tc: ReturnType<typeof getThemeColors>;
  ts: ReturnType<typeof getThemeShadows>;
  isDesktop: boolean;
}) {
  return (
    <>
      {/* Effective date */}
      <View
        style={{
          backgroundColor: colors.primary[500] + "10",
          borderRadius: 12,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.primary[500] + "20",
          marginBottom: 24,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.primary[400]} />
        <Text
          style={{
            color: tc.textSecondary,
            fontSize: 13,
            fontFamily: "DMSans_500Medium",
          }}
        >
          Effective Date: March 13, 2026 | Compliant with Kenya Data Protection Act 2019
        </Text>
      </View>

      <LegalSection title="1. Introduction" icon="information-circle-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          CryptoPay Technologies Ltd ("CryptoPay", "we", "us") is committed to protecting your personal data in accordance with the Kenya Data Protection Act, 2019 (DPA), the Constitution of Kenya (Article 31, right to privacy), and applicable international data protection standards including the EU General Data Protection Regulation (GDPR) where applicable.
        </Paragraph>
        <Paragraph tc={tc}>
          This Privacy Policy explains how we collect, use, store, share, and protect your personal data when you use the CryptoPay application and services. The Office of the Data Protection Commissioner (ODPC) of Kenya is the supervisory authority for data protection matters.
        </Paragraph>
      </LegalSection>

      <LegalSection title="2. Data Controller" icon="business-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc} bold>CryptoPay Technologies Ltd</Paragraph>
        <Paragraph tc={tc}>Data Protection Officer: dpo@cpay.co.ke</Paragraph>
        <Paragraph tc={tc}>Registered Address: Nairobi, Kenya</Paragraph>
        <Paragraph tc={tc}>
          We have appointed a Data Protection Officer (DPO) as required by Section 24 of the DPA. For any privacy-related inquiries, contact our DPO at the email above.
        </Paragraph>
      </LegalSection>

      <LegalSection title="3. Personal Data We Collect" icon="folder-open-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc} bold>Identity & Account Data:</Paragraph>
        <BulletPoint tc={tc}>Full legal name, email address, phone number</BulletPoint>
        <BulletPoint tc={tc}>Government-issued ID number and document type (for KYC)</BulletPoint>
        <BulletPoint tc={tc}>Date of birth, nationality, and residential address</BulletPoint>
        <BulletPoint tc={tc}>Profile photograph/avatar</BulletPoint>

        <Paragraph tc={tc} bold>Financial & Transaction Data:</Paragraph>
        <BulletPoint tc={tc}>M-Pesa phone number and transaction receipts</BulletPoint>
        <BulletPoint tc={tc}>Cryptocurrency wallet addresses (platform-generated)</BulletPoint>
        <BulletPoint tc={tc}>Transaction history (amounts, recipients, timestamps, status)</BulletPoint>
        <BulletPoint tc={tc}>Exchange rates and fees applied</BulletPoint>

        <Paragraph tc={tc} bold>Technical & Device Data:</Paragraph>
        <BulletPoint tc={tc}>Device identifier, model, and operating system</BulletPoint>
        <BulletPoint tc={tc}>IP address and approximate geolocation</BulletPoint>
        <BulletPoint tc={tc}>App version, session data, and login timestamps</BulletPoint>
        <BulletPoint tc={tc}>Push notification tokens</BulletPoint>

        <Paragraph tc={tc} bold>Security Data:</Paragraph>
        <BulletPoint tc={tc}>Hashed PIN (never stored in plaintext)</BulletPoint>
        <BulletPoint tc={tc}>TOTP authenticator enrollment status</BulletPoint>
        <BulletPoint tc={tc}>Failed login attempts and security event logs</BulletPoint>
        <BulletPoint tc={tc}>Device fingerprints for new device detection</BulletPoint>
      </LegalSection>

      <LegalSection title="4. Legal Basis for Processing" icon="checkmark-circle-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>We process your personal data under the following legal bases as permitted by the DPA:</Paragraph>
        <BulletPoint tc={tc}>Contractual necessity: Processing required to provide our services (account management, transaction processing, wallet operations)</BulletPoint>
        <BulletPoint tc={tc}>Legal obligation: KYC/AML compliance under the Proceeds of Crime and Anti-Money Laundering Act, reporting to the Financial Reporting Centre (FRC)</BulletPoint>
        <BulletPoint tc={tc}>Legitimate interest: Fraud prevention, security monitoring, service improvement, and dispute resolution</BulletPoint>
        <BulletPoint tc={tc}>Consent: Marketing communications, optional analytics, and non-essential cookies (you may withdraw consent at any time)</BulletPoint>
      </LegalSection>

      <LegalSection title="5. How We Use Your Data" icon="analytics-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <BulletPoint tc={tc}>Process cryptocurrency deposits, conversions, and M-Pesa payouts</BulletPoint>
        <BulletPoint tc={tc}>Verify your identity and comply with KYC/AML regulations</BulletPoint>
        <BulletPoint tc={tc}>Detect and prevent fraud, unauthorized access, and suspicious transactions</BulletPoint>
        <BulletPoint tc={tc}>Send transaction confirmations, security alerts, and service notifications</BulletPoint>
        <BulletPoint tc={tc}>Provide customer support and resolve disputes</BulletPoint>
        <BulletPoint tc={tc}>Maintain audit trails as required by financial regulations</BulletPoint>
        <BulletPoint tc={tc}>Improve our services through aggregated, anonymized analytics</BulletPoint>
      </LegalSection>

      <LegalSection title="6. Data Sharing" icon="share-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>We may share your personal data with:</Paragraph>
        <BulletPoint tc={tc}>Safaricom PLC: M-Pesa integration for KES payouts and STK Push payments. Shared data: phone number, transaction amounts.</BulletPoint>
        <BulletPoint tc={tc}>Blockchain networks: Deposit addresses and transaction hashes are inherently public on blockchain ledgers. We do not share your identity with blockchain networks.</BulletPoint>
        <BulletPoint tc={tc}>Regulatory authorities: The Financial Reporting Centre (FRC), Kenya Revenue Authority (KRA), and law enforcement when required by law or court order.</BulletPoint>
        <BulletPoint tc={tc}>Cloud infrastructure providers: Hosting and storage services with data processing agreements (DPAs) in place.</BulletPoint>
        <Paragraph tc={tc}>
          We do NOT sell your personal data to third parties. We do NOT share data with advertisers or data brokers.
        </Paragraph>
      </LegalSection>

      <LegalSection title="7. Data Retention" icon="time-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <BulletPoint tc={tc}>Account data: Retained for the duration of your account plus 7 years (AML record-keeping requirement under Kenyan law)</BulletPoint>
        <BulletPoint tc={tc}>Transaction records: 7 years minimum (Proceeds of Crime and Anti-Money Laundering Act)</BulletPoint>
        <BulletPoint tc={tc}>KYC documents: 7 years after account closure</BulletPoint>
        <BulletPoint tc={tc}>Security logs: 2 years (for incident investigation)</BulletPoint>
        <BulletPoint tc={tc}>Marketing consent records: Until consent is withdrawn</BulletPoint>
        <Paragraph tc={tc}>
          After the retention period, data is securely deleted or anonymized beyond re-identification.
        </Paragraph>
      </LegalSection>

      <LegalSection title="8. Data Security" icon="lock-closed-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>We implement comprehensive security measures including:</Paragraph>
        <BulletPoint tc={tc}>AES-256 encryption for data at rest and TLS 1.3 for data in transit</BulletPoint>
        <BulletPoint tc={tc}>Bcrypt hashing for PINs and passwords (never stored in plaintext)</BulletPoint>
        <BulletPoint tc={tc}>Hardware Security Module (HSM) grade key management for wallet private keys</BulletPoint>
        <BulletPoint tc={tc}>Role-based access control (RBAC) with principle of least privilege</BulletPoint>
        <BulletPoint tc={tc}>Real-time intrusion detection and transaction monitoring</BulletPoint>
        <BulletPoint tc={tc}>Regular penetration testing and security audits</BulletPoint>
        <Paragraph tc={tc}>
          In the event of a data breach, we will notify the ODPC within 72 hours and affected users without undue delay, as required by Section 43 of the DPA.
        </Paragraph>
      </LegalSection>

      <LegalSection title="9. Your Rights" icon="hand-left-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>Under the Kenya Data Protection Act 2019, you have the right to:</Paragraph>
        <BulletPoint tc={tc}>Access: Request a copy of your personal data we hold (Section 26)</BulletPoint>
        <BulletPoint tc={tc}>Rectification: Correct inaccurate or incomplete data (Section 26)</BulletPoint>
        <BulletPoint tc={tc}>Erasure: Request deletion of your data, subject to legal retention obligations (Section 26)</BulletPoint>
        <BulletPoint tc={tc}>Portability: Receive your data in a structured, machine-readable format (Section 26)</BulletPoint>
        <BulletPoint tc={tc}>Object: Object to processing based on legitimate interest (Section 26)</BulletPoint>
        <BulletPoint tc={tc}>Withdraw consent: Withdraw consent for optional processing at any time (Section 32)</BulletPoint>
        <BulletPoint tc={tc}>Lodge a complaint: File a complaint with the ODPC at complaints@odpc.go.ke</BulletPoint>
        <Paragraph tc={tc}>
          To exercise your rights, email dpo@cpay.co.ke. We will respond within 30 days. Identity verification may be required.
        </Paragraph>
      </LegalSection>

      <LegalSection title="10. International Data Transfers" icon="globe-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          Your data may be processed on servers located outside Kenya for cloud hosting and blockchain monitoring purposes. Any international transfers comply with Section 48 of the DPA, including ensuring the receiving country has adequate data protection or implementing appropriate safeguards (Standard Contractual Clauses).
        </Paragraph>
        <Paragraph tc={tc}>
          Blockchain transaction data (addresses and amounts) is inherently global and immutable once recorded on public ledgers. This is a fundamental characteristic of blockchain technology.
        </Paragraph>
      </LegalSection>

      <LegalSection title="11. Children's Privacy" icon="people-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          CryptoPay services are not directed at individuals under 18 years of age. We do not knowingly collect personal data from minors. If we discover that a minor has created an account, we will promptly delete their data and close the account, in accordance with Section 33 of the DPA.
        </Paragraph>
      </LegalSection>

      <LegalSection title="12. Cookies & Analytics" icon="pie-chart-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          Our mobile application uses minimal local storage for essential functionality (session tokens, preferences, cached data). We do not use third-party tracking cookies or advertising SDKs.
        </Paragraph>
        <Paragraph tc={tc}>
          We may collect anonymized usage analytics to improve app performance. This data cannot be used to identify individual users.
        </Paragraph>
      </LegalSection>

      <LegalSection title="13. Policy Updates" icon="refresh-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc}>
          We may update this Privacy Policy to reflect changes in our practices or legal requirements. Material changes will be communicated via email and in-app notification at least 14 days before taking effect. The "Last Updated" date at the top of this policy indicates the most recent revision.
        </Paragraph>
      </LegalSection>

      <LegalSection title="14. Contact" icon="mail-outline" tc={tc} ts={ts} isDesktop={isDesktop}>
        <Paragraph tc={tc} bold>CryptoPay Technologies Ltd</Paragraph>
        <Paragraph tc={tc}>Data Protection Officer: dpo@cpay.co.ke</Paragraph>
        <Paragraph tc={tc}>General: privacy@cpay.co.ke</Paragraph>
        <Paragraph tc={tc}>ODPC Complaints: complaints@odpc.go.ke</Paragraph>
        <Paragraph tc={tc}>Nairobi, Kenya</Paragraph>
      </LegalSection>
    </>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────
export default function TermsAndPrivacyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { width } = useWindowDimensions();
  const isDesktop = isWeb && width >= 900;
  const isTablet = isWeb && width >= 600 && width < 900;
  const { isDark } = useThemeMode();
  const tc = getThemeColors(isDark);
  const ts = getThemeShadows(isDark);
  const { t } = useLocale();
  const initialTab: TabKey = params.tab === "privacy" ? "privacy" : "terms";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const horizontalPadding = isDesktop ? 48 : isTablet ? 32 : 20;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: tc.dark.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingTop: isDesktop ? 12 : 8,
          paddingBottom: 60,
          maxWidth: isDesktop ? 900 : undefined,
          alignSelf: isDesktop ? "center" : undefined,
          width: isDesktop ? "100%" : undefined,
        }}
      >
        {/* Back button */}
        <Pressable
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/settings" as any);
          }}
          style={({ pressed, hovered }: any) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: hovered
              ? tc.glass.highlight
              : pressed
                ? tc.dark.elevated
                : "transparent",
            alignSelf: "flex-start",
            marginBottom: 8,
            opacity: pressed ? 0.9 : 1,
            ...(isWeb
              ? ({
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  transform: hovered ? "translateX(-2px)" : "translateX(0px)",
                } as any)
              : {}),
          })}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={20} color={tc.textSecondary} />
          <Text style={{ color: tc.textSecondary, fontSize: 15, fontFamily: "DMSans_500Medium" }}>
            {t("common.back")}
          </Text>
        </Pressable>

        {/* Page Title */}
        <View style={{ marginBottom: isDesktop ? 28 : 20, paddingHorizontal: 4 }}>
          <Text
            style={{
              color: tc.textPrimary,
              fontSize: isDesktop ? 32 : 26,
              fontFamily: "DMSans_700Bold",
              letterSpacing: -0.5,
            }}
          >
            {t("settings.termsPrivacy")}
          </Text>
          <Text
            style={{
              color: tc.textMuted,
              fontSize: isDesktop ? 16 : 14,
              marginTop: 4,
              lineHeight: 22,
            }}
          >
            Legal documents governing your use of CryptoPay
          </Text>
        </View>

        {/* Tab Switcher */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: tc.dark.card,
            borderRadius: 16,
            padding: 4,
            marginBottom: 24,
            borderWidth: 1,
            borderColor: tc.glass.border,
            ...ts.sm,
          }}
        >
          {(
            [
              { key: "terms" as TabKey, label: t("settings.termsOfService"), icon: "document-text-outline" as keyof typeof Ionicons.glyphMap },
              { key: "privacy" as TabKey, label: t("settings.privacyPolicy"), icon: "shield-outline" as keyof typeof Ionicons.glyphMap },
            ] as const
          ).map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={({ hovered }: any) => ({
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor:
                  activeTab === tab.key
                    ? colors.primary[500] + "20"
                    : hovered
                      ? tc.glass.highlight
                      : "transparent",
                borderWidth: activeTab === tab.key ? 1 : 0,
                borderColor: colors.primary[500] + "30",
                ...(isWeb
                  ? ({ cursor: "pointer", transition: "all 0.2s ease" } as any)
                  : {}),
              })}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeTab === tab.key }}
            >
              <Ionicons
                name={tab.icon}
                size={16}
                color={activeTab === tab.key ? colors.primary[400] : tc.textMuted}
              />
              <Text
                style={{
                  color: activeTab === tab.key ? colors.primary[400] : tc.textMuted,
                  fontSize: 14,
                  fontFamily: activeTab === tab.key ? "DMSans_600SemiBold" : "DMSans_500Medium",
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Content */}
        {activeTab === "terms" ? (
          <TermsContent tc={tc} ts={ts} isDesktop={isDesktop} />
        ) : (
          <PrivacyContent tc={tc} ts={ts} isDesktop={isDesktop} />
        )}

        {/* Footer */}
        <View
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTopWidth: 1,
            borderTopColor: tc.glass.border,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: tc.textMuted,
              fontSize: 12,
              fontFamily: "DMSans_400Regular",
              textAlign: "center",
              lineHeight: 18,
            }}
          >
            CryptoPay Technologies Ltd | Nairobi, Kenya{"\n"}
            Regulated under the laws of the Republic of Kenya
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
