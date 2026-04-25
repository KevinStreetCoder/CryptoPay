/**
 * Cpay company brief (.docx) for investor conversations and partner
 * presentations. Same visual system as the Daraja business profile,
 * but the copy here can speak plainly about what the product actually
 * does (M-Pesa payments funded by digital assets).
 *
 * Same hard rules as the first profile:
 *   - No em-dashes (period or comma instead)
 *   - No AI buzzwords (leverage, seamless, robust, cutting-edge,
 *     consumer-grade, effortless, paradigm, etc.)
 *   - 100% human voice, short sentences, specific numbers
 *
 * Run from repo root:  node scripts/_gen-investor-profile.js
 * Output: docs/Cpay-Company-Brief.docx
 */
const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  HeadingLevel,
  LevelFormat,
  BorderStyle,
  WidthType,
  ShadingType,
  PageBreak,
} = require("docx");

// Brand tokens (identical to business profile)
const EMERALD = "10B981";
const INK = "0B1220";
const SLATE = "475569";
const PAPER = "FFFFFF";
const FAINT = "F1F5F9";
const HAIRLINE = "E2E8F0";

const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ASSETS = path.join(__dirname, "..", "mobile", "assets");
const WORDMARK = path.join(ASSETS, "brand", "cpay-wordmark-light.png");

const OUT_DIR = path.join(__dirname, "..", "docs");
const OUT_FILE = path.join(OUT_DIR, "Cpay-Company-Brief.docx");

// ---------- helpers ----------

const eyebrow = (text) =>
  new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text: text.toUpperCase(),
        font: "Arial",
        size: 16,
        bold: true,
        color: EMERALD,
        characterSpacing: 40,
      }),
    ],
  });

const h1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 80, after: 120 },
    children: [
      new TextRun({
        text,
        font: "Arial",
        size: 32,
        bold: true,
        color: INK,
      }),
    ],
  });

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({
        text,
        font: "Arial",
        size: 22,
        bold: true,
        color: INK,
      }),
    ],
  });

const body = (text, opts = {}) =>
  new Paragraph({
    spacing: { before: 0, after: 120, line: 300 },
    alignment: opts.align || AlignmentType.LEFT,
    children: [
      new TextRun({
        text,
        font: "Arial",
        size: 21,
        color: opts.muted ? SLATE : INK,
      }),
    ],
  });

const bullet = (text) =>
  new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 0, after: 60, line: 280 },
    children: [
      new TextRun({
        text,
        font: "Arial",
        size: 21,
        color: INK,
      }),
    ],
  });

const numbered = (text) =>
  new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { before: 0, after: 80, line: 280 },
    children: [
      new TextRun({
        text,
        font: "Arial",
        size: 21,
        color: INK,
      }),
    ],
  });

const cellBorder = (isLast) => {
  const rule = { style: BorderStyle.SINGLE, size: 4, color: HAIRLINE };
  return {
    top: rule,
    bottom: isLast ? rule : { style: BorderStyle.NONE, size: 0, color: PAPER },
    left: { style: BorderStyle.NONE, size: 0, color: PAPER },
    right: { style: BorderStyle.NONE, size: 0, color: PAPER },
  };
};

const factRow = (label, value, opts = {}) => {
  const labelCell = new TableCell({
    width: { size: 3000, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 160, right: 100 },
    shading: { fill: FAINT, type: ShadingType.CLEAR },
    borders: cellBorder(opts.last),
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: label,
            font: "Arial",
            size: 17,
            bold: true,
            color: SLATE,
            characterSpacing: 20,
          }),
        ],
      }),
    ],
  });
  const valueCell = new TableCell({
    width: { size: 6360, type: WidthType.DXA },
    margins: { top: 100, bottom: 100, left: 160, right: 160 },
    borders: cellBorder(opts.last),
    children: [
      new Paragraph({
        spacing: { before: 0, after: 0 },
        children: [
          new TextRun({
            text: value,
            font: "Arial",
            size: 21,
            color: INK,
          }),
        ],
      }),
    ],
  });
  return new TableRow({ children: [labelCell, valueCell] });
};

// ---------- PAGE 1 : header, what we do, particulars ----------

const page1 = [
  // Brand mark
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 240 },
    children: [
      new ImageRun({
        type: "png",
        data: fs.readFileSync(WORDMARK),
        transformation: { width: 160, height: 40 },
        altText: {
          title: "Cpay",
          description: "Cpay brand wordmark",
          name: "cpay-wordmark",
        },
      }),
    ],
  }),

  // Title block
  new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text: "COMPANY BRIEF",
        font: "Arial",
        size: 16,
        bold: true,
        color: EMERALD,
        characterSpacing: 80,
      }),
    ],
  }),
  new Paragraph({
    spacing: { before: 0, after: 80 },
    children: [
      new TextRun({
        text: "Cpay",
        font: "Arial",
        size: 44,
        bold: true,
        color: INK,
      }),
    ],
  }),
  new Paragraph({
    spacing: { before: 0, after: 240 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 8,
        color: EMERALD,
        space: 1,
      },
    },
    children: [
      new TextRun({
        text:
          "Pay any M-Pesa Paybill, Till, or phone number with the digital assets you already hold. Live rates, transparent fees, KES delivered in seconds.",
        font: "Arial",
        size: 22,
        color: SLATE,
      }),
    ],
  }),

  // What we do
  eyebrow("What we do"),
  h1("The product"),
  body(
    "Cpay is a consumer mobile and web app that turns digital assets (USDT, USDC, BTC, ETH, SOL) into spendable M-Pesa balance. The user holds their assets in a Cpay wallet, types in a Paybill, Till, or M-Pesa number, and confirms a payment. The app converts to KES at the live rate and sends the funds via M-Pesa to the recipient. The recipient sees a normal M-Pesa transaction. The user pays from a balance they already had on chain.",
  ),
  body(
    "Cpay also handles the surrounding work that makes this feel routine. A multi-chain wallet generated from a BIP-39 seed. Live deposit tracking on Tron, Ethereum, Polygon, Bitcoin, and Solana. KYC and tier-based limits. Email and SMS receipts with PDF copies for reconciliation. Push notifications. Two-factor authentication. Full transaction history with M-Pesa receipt numbers attached.",
  ),

  // Particulars
  eyebrow("At a glance"),
  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3000, 6360],
    rows: [
      factRow("LEGAL ENTITY", "CPAY TECHNOLOGIES, BN-B8S6JP89"),
      factRow("FOUNDED", "March 2026, Nairobi, Kenya"),
      factRow("FOUNDER", "Kevin Isaac Kareithi, Software Developer"),
      factRow("STAGE", "Live in production, pre-seed"),
      factRow("MARKET", "Kenya, with Tanzania and Uganda on the roadmap"),
      factRow("WEBSITE", "https://cpay.co.ke", { last: true }),
    ],
  }),
];

// ---------- PAGE 2 : problem, how it works, product, revenue ----------

const page2 = [
  new Paragraph({ children: [new PageBreak()] }),

  eyebrow("Why this exists"),
  h1("The problem"),
  body(
    "Kenyans hold a meaningful share of their savings in stablecoins and other digital assets. Spending those balances locally still means selling them to a peer on Telegram or WhatsApp, waiting for the buyer to send M-Pesa, hoping nothing goes wrong, and only then completing the original errand. The off-ramp is slow, manual, and built on personal trust.",
  ),
  body(
    "M-Pesa moves over a billion shillings a day across Paybill, Till, and person-to-person transfers. None of that infrastructure speaks to a wallet. A Cpay user pays a Kenya Power bill, settles a school fee, or sends rent the same way they would from M-Pesa, except the funds come from their on-chain balance and settle in the same transaction.",
  ),

  eyebrow("Flow"),
  h1("How a payment works"),
  numbered(
    "The user opens Cpay, picks the asset they want to pay from, and enters the M-Pesa Paybill, Till, or phone number.",
  ),
  numbered(
    "Cpay returns a quote: the live exchange rate, the fee, and the exact KES the recipient will see.",
  ),
  numbered(
    "The user confirms with PIN or biometric. Cpay locks the user's on-chain balance and sends the KES leg through Safaricom Daraja or a partner gateway.",
  ),
  numbered(
    "On settlement Cpay records the M-Pesa receipt number, sends a push notification, an SMS, and a PDF receipt. The user sees the transaction in their history, the recipient sees a standard M-Pesa entry.",
  ),

  eyebrow("Product"),
  h1("What is in the app today"),
  bullet("Multi-chain wallet (USDT TRC-20, USDC Polygon, BTC, ETH, SOL) generated from a BIP-39 seed phrase, with derived deposit addresses per user."),
  bullet("Pay Bill, Pay Till, Send M-Pesa, Deposit, Send, and Swap flows."),
  bullet("Live rates via CoinGecko and on-chain feeds, refreshed every 30 seconds."),
  bullet("Tiered KYC (Phone Only, ID Verified, KRA Verified, Enhanced Due Diligence) with daily and monthly limits enforced server-side."),
  bullet("Two-factor authentication (TOTP), biometric unlock, OTP on new device or new IP, push approval from a trusted second device."),
  bullet("Email receipts, SMS receipts, PDF receipts, push notifications, and a fully searchable transaction history."),
  bullet("Available on Android today, with iOS and a desktop web build in active development."),

  eyebrow("How we make money"),
  h1("Revenue"),
  body(
    "Cpay earns on two lines per transaction. A small spread on the KES conversion, disclosed up front in the quote so the user always sees the rate they will actually receive. A flat per-transaction fee scaled to the size of the payment. Both numbers are tuned to undercut the cost of the informal off-ramp the user is currently using.",
  ),
  body(
    "Future revenue lines on the roadmap include card issuance, a B2B API for businesses to accept on-chain payments and settle in KES, and savings products built on the wallet rail. Each of those expands the per-user revenue without changing the core experience of the consumer app.",
  ),
];

// ---------- PAGE 3 : traction, team, regulatory, contact ----------

const page3 = [
  new Paragraph({ children: [new PageBreak()] }),

  eyebrow("Where we are"),
  h1("Traction and roadmap"),
  body(
    "Cpay is live in production at cpay.co.ke and on Android. The platform handles real users, real KYC, real settlements, and real M-Pesa receipts. Onboarding to the Safaricom Daraja API is in progress, which moves us off the partner gateway and onto first-party rails.",
  ),
  h2("Next twelve months"),
  bullet("iOS launch and a polished desktop web build."),
  bullet("VASP licensing under the Virtual Asset Service Providers Act 2025."),
  bullet("Tanzania and Uganda corridor for cross-border remittances."),
  bullet("Cpay Card, a virtual and physical card backed by the wallet balance."),
  bullet("B2B API for merchants and platforms to accept on-chain payments."),

  eyebrow("People"),
  h1("Team"),
  new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text: "Kevin Isaac Kareithi",
        font: "Arial",
        size: 24,
        bold: true,
        color: INK,
      }),
      new TextRun({
        text: "    Founder · Engineer",
        font: "Arial",
        size: 20,
        color: EMERALD,
      }),
    ],
  }),
  body(
    "Kevin built Cpay solo through to first production users. He owns product, engineering, and operations today. The next two hires will be a senior backend engineer and a head of compliance, in that order.",
  ),

  eyebrow("Compliance"),
  h1("Regulatory posture"),
  body(
    "Cpay Technologies is registered in Kenya (BN-B8S6JP89) and operates from a Nairobi office. We track the Virtual Asset Service Providers Act 2025 closely and are preparing for licensing under the framework, including the KES 50 million capital requirement. We follow the Data Protection Act 2019, run KYC and AML processes server-side, and hold a current account in the firm's name with a tier-one Kenyan bank.",
  ),

  eyebrow("Talk to us"),
  h1("Contact"),
  ...[
    ["Founder", "Kevin Isaac Kareithi"],
    ["Email", "kevin@cpay.co.ke"],
    ["Telephone", "+254 701 961 618"],
    ["Website", "https://cpay.co.ke"],
    [
      "Office",
      "Eagle Nest Apartment, Kasarani Hunters 15th Street, Roysambu, Nairobi",
    ],
  ].map(
    ([label, value]) =>
      new Paragraph({
        spacing: { before: 0, after: 60 },
        children: [
          new TextRun({
            text: `${label}    `,
            font: "Arial",
            size: 17,
            bold: true,
            color: SLATE,
            characterSpacing: 40,
          }),
          new TextRun({
            text: value,
            font: "Arial",
            size: 21,
            color: INK,
          }),
        ],
      }),
  ),

  // Closing rule + sign-off
  new Paragraph({
    spacing: { before: 320, after: 60 },
    border: {
      bottom: {
        style: BorderStyle.SINGLE,
        size: 6,
        color: HAIRLINE,
        space: 1,
      },
    },
    children: [new TextRun("")],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 0 },
    children: [
      new TextRun({
        text: "Cpay Technologies  ·  Nairobi, Kenya  ·  April 2026",
        font: "Arial",
        size: 17,
        color: SLATE,
        characterSpacing: 40,
      }),
    ],
  }),
];

// ---------- assemble ----------

const doc = new Document({
  creator: "Cpay Technologies",
  title: "Cpay · Company Brief",
  styles: {
    default: {
      document: {
        run: { font: "Arial", size: 21, color: INK },
      },
    },
    paragraphStyles: [
      {
        id: "Heading1",
        name: "Heading 1",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: INK },
        paragraph: { spacing: { before: 80, after: 120 }, outlineLevel: 0 },
      },
      {
        id: "Heading2",
        name: "Heading 2",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: INK },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 1 },
      },
    ],
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: "•",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 540, hanging: 280 } },
              run: { color: EMERALD },
            },
          },
        ],
      },
      {
        reference: "numbers",
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: { indent: { left: 540, hanging: 280 } },
              run: { color: EMERALD, bold: true },
            },
          },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: [...page1, ...page2, ...page3],
    },
  ],
});

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT_FILE, buf);
  console.log(`wrote ${OUT_FILE} (${buf.length} bytes)`);
});
