/**
 * Cpay Technologies business profile (.docx) for the Safaricom Daraja
 * API onboarding desk. Two-page format. Plain-language copy, no AI
 * tells (no em-dashes, no "consumer-grade", no "leverage", no "robust",
 * no "seamless"). Frames the firm strictly as Technology Platforms And
 * Mobile Applications per BN-B8S6JP89.
 *
 * Run from repo root:  node scripts/_gen-business-profile.js
 * Output: docs/Cpay-Technologies-Business-Profile.docx
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

// Brand tokens
const EMERALD = "10B981";
const INK = "0B1220";
const SLATE = "475569";
const PAPER = "FFFFFF";
const FAINT = "F1F5F9";
const HAIRLINE = "E2E8F0";

// US Letter, 1" margins => 9360 DXA content width
const PAGE_W = 12240;
const PAGE_H = 15840;
const MARGIN = 1440;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ASSETS = path.join(__dirname, "..", "mobile", "assets");
const WORDMARK = path.join(ASSETS, "brand", "cpay-wordmark-light.png");

const OUT_DIR = path.join(__dirname, "..", "docs");
const OUT_FILE = path.join(OUT_DIR, "Cpay-Technologies-Business-Profile.docx");

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

// ---------- PAGE 1 : header, intro, particulars ----------

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
        text: "BUSINESS PROFILE",
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
        text: "Cpay Technologies",
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
          "A Kenyan technology firm. We build mobile applications and the systems that run them.",
        font: "Arial",
        size: 22,
        color: SLATE,
      }),
    ],
  }),

  // About
  body(
    "Cpay Technologies is a Nairobi-based technology firm registered in March 2026 under the Registration of Business Names Act, Cap. 499. We design and operate mobile applications, together with the back-end services and integrations that support them.",
  ),
  body(
    "Our work covers Android and iOS application development, API and infrastructure engineering, and the integrations needed to connect our products to the telecom networks, identity providers, and other services used in Kenya. The firm is built around a small team and a documented engineering practice, so that any customer or partner can reach the person responsible for the work being done.",
  ),

  // Particulars
  eyebrow("Company particulars"),
  body(
    "Drawn from the Statement of Particulars filed with the Registrar of Companies (Form BN/2, certificate BN-B8S6JP89). The original is held on file at our registered office.",
    { muted: true },
  ),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3000, 6360],
    rows: [
      factRow("BUSINESS NAME", "CPAY TECHNOLOGIES"),
      factRow("REGISTRATION", "BN-B8S6JP89, Registrar of Companies, Kenya"),
      factRow("DATE OF RESERVATION", "25 March 2026"),
      factRow(
        "NATURE OF BUSINESS",
        "Technology Platforms and Mobile Applications",
      ),
      factRow(
        "STRUCTURE",
        "Sole Proprietor (Registered Business Name, Cap. 499)",
      ),
      factRow("PRINCIPAL", "Kevin Isaac Kareithi, Software Developer"),
      factRow(
        "REGISTERED OFFICE",
        "Eagle Nest Apartment, Kasarani Hunters 15th Street, Roysambu, Kasarani District, Nairobi County",
      ),
      factRow("POSTAL ADDRESS", "P.O. Box 151 - 20115, Egerton, Kenya"),
      factRow("TELEPHONE", "+254 701 961 618"),
      factRow("WEBSITE", "https://cpay.co.ke", { last: true }),
    ],
  }),
];

// ---------- PAGE 2 : what we do, operations, contact ----------

const page2 = [
  new Paragraph({ children: [new PageBreak()] }),

  eyebrow("What we do"),
  h1("Capabilities"),
  body(
    "We focus on four areas of practice. We turn down work outside these so that we can keep doing each of them well.",
  ),

  h2("Mobile applications"),
  body(
    "Android and iOS applications built on React Native with Expo. One codebase, faster delivery, and a finished product that performs the way users expect on entry-level hardware as well as on a desktop browser.",
  ),

  h2("Back-end and platform engineering"),
  body(
    "API services in Django and Python, PostgreSQL for stored data, Redis for fast lookups, Celery for background jobs, and a CI/CD pipeline that runs tests and security checks on every commit before it ships.",
  ),

  h2("Integrations"),
  body(
    "Connecting our applications to the third-party services used in Kenya, including telecom networks, identity verification providers, exchange-rate feeds, and notification networks. Every integration is documented so that a vendor can be replaced without rewriting the application.",
  ),

  h2("Security and operations"),
  body(
    "Data is encrypted at rest and in transit. Application metrics flow through Prometheus and Grafana. We maintain a documented incident-response process and run a quarterly security review. Internal standards exceed the minimum required by the regulator.",
  ),

  eyebrow("Operations"),
  h1("How we work"),
  body(
    "Our principal place of business is in Nairobi, at Eagle Nest Apartment, Kasarani Hunters 15th Street, Roysambu. This is a working office, not a registered-agent address. Day-to-day technical work is carried out from here.",
  ),
  body(
    "Cpay Technologies holds a current account in the firm's name with a tier-one Kenyan commercial bank. The bank confirmation letter is included in this submission as a separate attachment.",
  ),
  body(
    "We track and follow the relevant Kenyan laws closely, including the Data Protection Act 2019, the Computer Misuse and Cybercrimes Act 2018, and any sector-specific direction issued by the Communications Authority. If we move into an activity that requires a separate licence, we will hold the licence before we start the activity.",
  ),

  eyebrow("Leadership"),
  h1("Principal"),
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
        text: "    Founder · Software Developer",
        font: "Arial",
        size: 20,
        color: EMERALD,
      }),
    ],
  }),
  body(
    "Kevin is responsible for product direction, technical architecture, and the day-to-day running of the firm. As the team grows, additional engineers will be brought on under the same engineering standards.",
  ),
];

// ---------- PAGE 3 : contact (kept short) ----------

const page3 = [
  new Paragraph({ children: [new PageBreak()] }),

  eyebrow("Contact"),
  h1("Get in touch"),
  body(
    "We are happy to answer any further questions about this submission, the products behind it, or the firm itself.",
  ),

  // Contact lines
  ...[
    ["Principal Contact", "Kevin Isaac Kareithi"],
    ["Telephone", "+254 701 961 618"],
    ["Email", "hello@cpay.co.ke"],
    ["Website", "https://cpay.co.ke"],
    [
      "Office",
      "Eagle Nest Apartment, Kasarani Hunters 15th Street, Roysambu, Nairobi",
    ],
    ["Postal", "P.O. Box 151 - 20115, Egerton, Kenya"],
  ].map(
    ([label, value]) =>
      new Paragraph({
        spacing: { before: 0, after: 80 },
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

  // Closing rule + brand mark line
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
  title: "Cpay Technologies · Business Profile",
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
