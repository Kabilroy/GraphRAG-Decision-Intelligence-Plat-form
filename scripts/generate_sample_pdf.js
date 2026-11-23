import fs from "fs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { PDFParse } from "pdf-parse";

const pagesData = [
  {
    title: "EXECUTIVE OPERATIONS MEETING MINUTES",
    date: "28 October 2026",
    content: `EXECUTIVE OPERATIONS MEETING MINUTES
Date: 28 October 2026
Meeting Attendees: Chief Operating Officer, Head of Logistics, Procurement Lead, Warehouse Manager, Finance Controller

EXECUTIVE ACTION ITEMS:
1. Head of Logistics | Publish exception dashboard pilot plan | 6 Nov 2026
2. Procurement Lead | Obtain vendor recovery plan | 9 Nov 2026
3. Warehouse Manager | Complete SKU-002 reconciliation | 4 Nov 2026
4. Finance Controller | Issue freight-charge validation checklist | 11 Nov 2026

Discussion Notes:
- The committee reviewed Q3 operations and recognized that while cross-dock handling times require improvement, immediate priority must be given to exception visibility and inventory reconciliation.
- Next operational review is scheduled for 12 November 2026.
Meeting adjourned at 11:30 AM.`
  },
  {
    title: "LOGISTICS DELAY POST-MORTEM REPORT",
    date: "October 2026",
    content: `LOGISTICS DELAY POST-MORTEM REPORT
Date: October 2026
Incident: Regional Cross-Dock Delivery Latency Escalation

DOCUMENTED ROOT CAUSES:
1. Cross-dock capacity planning failure: Over-allocation at regional transit hubs resulted in unmanaged trailer backlogs and sorting bottlenecks.
2. Missing automated shipment exception alerts: Lack of real-time EDI and telemetry exception triggers delayed carrier escalation by 72+ hours.
3. Unclear carrier escalation ownership: Ambiguity between regional dispatchers and central procurement created confusion over who had authority to authorize alternate expedited carriers.

ACTIONABLE EXECUTIVE RECOMMENDATIONS:
- Deploy automated exception monitoring across primary cross-dock facilities.
- Establish single-point carrier escalation protocols with pre-authorized SLA breach penalties.
- Re-align carrier service agreements to penalize non-compliance.`
  },
  {
    title: "FINANCIAL P&L STATEMENT (SEPTEMBER 2026)",
    date: "September 2026",
    content: `FINANCIAL P&L STATEMENT (SEPTEMBER 2026)
Reporting Currency: INR (Indian Rupees)

REGIONAL PERFORMANCE BREAKDOWN:
- Region: North | Gross Revenue: INR 2,840,000 | Operating Expenses: INR 2,427,000 | September Operating Profit: INR 413,000 | Margin: 14.5%
- Region: South | Gross Revenue: INR 2,910,000 | Operating Expenses: INR 2,497,000 | September Operating Profit: INR 413,000 | Margin: 14.2%
- Region: East  | Gross Revenue: INR 2,150,000 | Operating Expenses: INR 1,860,000 | September Operating Profit: INR 290,000 | Margin: 13.5%
- Region: West  | Gross Revenue: INR 2,320,000 | Operating Expenses: INR 2,010,000 | September Operating Profit: INR 310,000 | Margin: 13.4%

FINANCIAL CONCLUSION & AUDIT CERTIFICATION:
North and South both generated equal operating profit (INR 413,000 each), representing the highest operating profit across all regions for September 2026.`
  },
  {
    title: "NUMERICAL INVENTORY STATUS & REORDER-POINT REVIEW",
    date: "31 October 2026",
    content: `NUMERICAL INVENTORY STATUS & REORDER-POINT REVIEW
Audit As-Of Date: 31 October 2026

INVENTORY STOCK LEVELS VS REORDER THRESHOLDS:
- SKU-001 (Precision Roller Bearings): Current Stock: 140 units | Reorder Point: 200 units | Status: BELOW REORDER POINT (Deficit: -60 units) | Action: Immediate Reorder Required
- SKU-002 (Hydraulic Flange Seal): Current Stock: 520 units | Reorder Point: 300 units | Status: Above Reorder Point (Healthy buffer) | Action: Routine Reconciliation
- SKU-003 (Control Solenoid Valve): Current Stock: 85 units | Reorder Point: 150 units | Status: BELOW REORDER POINT (Deficit: -65 units) | Action: Immediate Reorder Required
- SKU-004 (High-Pressure Coupler): Current Stock: 410 units | Reorder Point: 400 units | Status: Above Reorder Point (Adequate) | Action: Routine Monitoring
- SKU-005 (Digital Sensor Cable Assembly): Current Stock: 60 units | Reorder Point: 120 units | Status: BELOW REORDER POINT (Deficit: -60 units) | Action: Immediate Reorder Required

REORDER STATUS CONCLUSION:
SKU-001, SKU-003, and SKU-005 are below their designated reorder point thresholds and require expedited replenishment. SKU-002 and SKU-004 remain above their reorder points.`
  },
  {
    title: "VENDOR PERFORMANCE AUDIT REPORT",
    date: "Q3 2026",
    content: `VENDOR PERFORMANCE AUDIT REPORT
Audit Period: Q3 2026
Audit Scope: Primary Freight and Carrier Logistics Partners

VENDOR AUDIT FIGURES & FINDINGS:
- Acme Freight Express: On-Time Delivery Rate: 71.4% (Target: 95.0%) | Transit Variance: +4.2 days | SLA Breach Count: 14 incidents
- Delta Logistics Corp: On-Time Delivery Rate: 68.2% (Target: 95.0%) | Transit Variance: +5.8 days | In-Transit Shipment Damage: 4.8%
- Global Carrier Partners: On-Time Delivery Rate: 79.5% (Target: 95.0%) | Transit Variance: +3.1 days | Telemetry Availability: 62.0%

OVERALL VENDOR PERFORMANCE ISSUES:
1. Systemic on-time delivery deficit across all three primary freight carriers (ranging between 68.2% and 79.5%, severely trailing the 95.0% enterprise SLA requirement).
2. Recurring customs and dock turnaround delays contributing up to +5.8 days of transit variance.
3. Elevated shipment damage rate at Delta Logistics (4.8%) and sub-par GPS telemetry visibility at Global Carrier Partners (62.0%).

Audit Verification Note:
All figures verified directly against carrier dispatch logs. Note that this document does not contain any records or metrics concerning Product X or Region A sales.`
  }
];

function wrapText(text, maxChars = 88) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const wrapped = [];
  let current = "";
  for (const w of words) {
    if ((current + (current ? " " : "") + w).length <= maxChars) {
      current = current ? `${current} ${w}` : w;
    } else {
      if (current) wrapped.push(current);
      current = w;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

async function generateSamplePdf() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < pagesData.length; i++) {
    const pData = pagesData[i];
    const page = pdfDoc.addPage([612, 792]);
    const { height } = page.getSize();

    // Header
    page.drawText(pData.title, {
      x: 40,
      y: height - 50,
      size: 14,
      font: boldFont,
      color: rgb(0.1, 0.15, 0.3)
    });

    page.drawText(`Page ${i + 1} of ${pagesData.length} · ${pData.date}`, {
      x: 40,
      y: height - 68,
      size: 9,
      font: font,
      color: rgb(0.4, 0.4, 0.4)
    });

    // Body Lines with clean wrapping (prevents right-margin text truncation)
    const rawLines = pData.content.split("\n");
    let currentY = height - 95;
    for (const rawLine of rawLines) {
      if (rawLine.trim().length === 0) {
        currentY -= 8;
        continue;
      }
      const isHeader = rawLine.endsWith(":") && rawLine === rawLine.toUpperCase();
      const wrappedLines = wrapText(rawLine, isHeader ? 78 : 90);
      for (let wIdx = 0; wIdx < wrappedLines.length; wIdx++) {
        page.drawText(wrappedLines[wIdx], {
          x: wIdx === 0 ? 40 : 50,
          y: currentY,
          size: isHeader ? 11 : 10,
          font: isHeader ? boldFont : font,
          color: isHeader ? rgb(0.1, 0.1, 0.2) : rgb(0.2, 0.2, 0.2)
        });
        currentY -= 14;
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync("sample_supply_chain_documents_complete.pdf", pdfBytes);
  fs.writeFileSync("public/sample_supply_chain_documents_complete.pdf", pdfBytes);
  console.log("Successfully generated sample_supply_chain_documents_complete.pdf! Size:", pdfBytes.length);

  // Test parsing with pdf-parse
  const parser = new PDFParse({ data: Buffer.from(pdfBytes) });
  const info = await parser.getInfo();
  const textResult = await parser.getText();
  console.log("PDF parsed successfully! Pages:", info.total, "Length:", textResult.text.length);
}

generateSamplePdf().catch(console.error);
