import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "pdf-lib";
import {
  buildIndexedDocument,
  extractInventoryRecordsFromDoc,
  extractPdfBuffer,
  extractRegionalFinancialRecordsFromDoc,
  extractSuppliersFromText
} from "../server_engine/ingestion";
import { classifyUserQuery, hybridRetrieveChunks } from "../server_engine/retrieval";
import {
  buildEvidencePackage,
  executeDocumentGraphAgent,
  executeDocumentSQLAgent,
  synthesizeEvidenceFirstDecision
} from "../server_engine/agents";
import { runCriticValidationAgent } from "../server_engine/critic";
import { parseQuestionIntent, runVendorMetricQA } from "../server_engine/metric_qa";
import { DemoDocument } from "../server_engine/types";

interface TableDef {
  headers: string[];
  rows: string[][];
  colWidths: number[];
}

function drawRepeatingChrome(page: PDFPage, pageNum: number, totalPages: number, font: PDFFont) {
  page.drawText("FICTIONAL TEST DATA — Northstar Components", {
    x: 36,
    y: 768,
    size: 8.5,
    font,
    color: rgb(0.45, 0.48, 0.55)
  });
  page.drawText(`Page ${pageNum} of ${totalPages}`, {
    x: 515,
    y: 22,
    size: 8.5,
    font,
    color: rgb(0.45, 0.48, 0.55)
  });
}

function drawBorderedTable(
  page: PDFPage,
  startX: number,
  startY: number,
  table: TableDef,
  font: PDFFont,
  boldFont: PDFFont
): number {
  const rowHeight = 20;
  const allRows = [table.headers, ...table.rows];
  let y = startY;

  for (let r = 0; r < allRows.length; r++) {
    const isHdr = r === 0;
    const row = allRows[r];
    let x = startX;
    for (let c = 0; c < table.colWidths.length; c++) {
      const w = table.colWidths[c];
      // Draw stroked cell rectangle so pdf-parse getTable() detects grid cells
      page.drawRectangle({
        x,
        y: y - rowHeight,
        width: w,
        height: rowHeight,
        borderWidth: 0.75,
        borderColor: rgb(0.25, 0.3, 0.38)
      });
      const cellText = String(row[c] ?? "");
      page.drawText(cellText, {
        x: x + 4,
        y: y - 13.5,
        size: isHdr ? 7.8 : 7.5,
        font: isHdr ? boldFont : font,
        color: rgb(0.1, 0.12, 0.16)
      });
      x += w;
    }
    y -= rowHeight;
  }
  return y;
}

export async function buildNorthstarTestPackPdfBuffer(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const totalPages = 9;

  const newPage = (pageNum: number) => {
    const p = pdfDoc.addPage([612, 792]);
    drawRepeatingChrome(p, pageNum, totalPages, font);
    return p;
  };

  // Page 1: Cover Page
  {
    const p = newPage(1);
    p.drawText("Northstar Components — Supply Chain & Financial Operations Review", {
      x: 36,
      y: 710,
      size: 14,
      font: boldFont,
      color: rgb(0.08, 0.12, 0.2)
    });
    const metaLines = [
      "Document Title: FY2026 Q3 Operational Audit & Performance Pack",
      "Entity: Northstar Components",
      "Reporting Currency: INR",
      "Reporting Period: Q3 2026 (July 2026 - September 2026)",
      "Prepared By: Supply Chain & Finance Analytics Office",
      "Summary: Consolidates regional P&L, monthly totals, city-level sales hubs,",
      "shipment SLA tracking, warehouse inventory reorder checks, carrier scorecards,",
      "operational risk register, governance action items, and recovery roadmap."
    ];
    let y = 675;
    for (const line of metaLines) {
      p.drawText(line, { x: 36, y, size: 10, font, color: rgb(0.15, 0.18, 0.24) });
      y -= 18;
    }
  }

  // Page 2: Section 1 — Quarterly Financial P&L + Monthly Totals
  {
    const p = newPage(2);
    p.drawText("1. Quarterly Financial P&L;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    p.drawText("Reporting Currency: INR | Period: September 2026", { x: 36, y: 710, size: 9, font, color: rgb(0.25, 0.28, 0.35) });

    let yAfter = drawBorderedTable(
      p,
      36,
      695,
      {
        headers: ["Region", "Revenue", "COGS", "Logistics", "Operating expenses", "Operating profit", "Margin"],
        colWidths: [60, 82, 82, 72, 86, 86, 62],
        rows: [
          ["North", "INR 2,840,000", "INR 1,520,000", "INR 310,000", "INR 597,000", "INR 413,000", "14.5%"],
          ["South", "INR 2,910,000", "INR 1,580,000", "INR 320,000", "INR 597,000", "INR 413,000", "14.2%"],
          ["East", "INR 2,150,000", "INR 1,140,000", "INR 240,000", "INR 480,000", "INR 290,000", "13.5%"],
          ["West", "INR 2,320,000", "INR 1,210,000", "INR 260,000", "INR 540,000", "INR 310,000", "13.4%"]
        ]
      },
      font,
      boldFont
    );

    p.drawText("Monthly Totals (Q3 2026 Consolidated)", { x: 36, y: yAfter - 28, size: 10.5, font: boldFont, color: rgb(0.1, 0.14, 0.22) });
    drawBorderedTable(
      p,
      36,
      yAfter - 42,
      {
        headers: ["Month", "Revenue", "Expenses", "Operating profit", "Margin"],
        colWidths: [105, 110, 110, 115, 90],
        rows: [
          ["July 2026", "INR 3,210,000", "INR 2,760,000", "INR 450,000", "14.0%"],
          ["August 2026", "INR 3,420,000", "INR 2,950,000", "INR 470,000", "13.7%"],
          ["September 2026", "INR 3,590,000", "INR 3,084,000", "INR 506,000", "14.1%"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 3: Section 2 — Regional & City Sales Breakdown (7 rows)
  {
    const p = newPage(3);
    p.drawText("2. Regional & City Sales Breakdown;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["Region", "City / Hub", "Units Sold", "Sales", "Target", "Achievement %", "Rating"],
        colWidths: [55, 95, 65, 90, 90, 80, 55],
        rows: [
          ["North", "Delhi NCR Hub", "4,200", "INR 1,680,000", "INR 1,600,000", "105.0%", "4.5"],
          ["North", "Jaipur Depot", "2,900", "INR 1,160,000", "INR 1,200,000", "96.7%", "4.1"],
          ["South", "Chennai Hub", "4,650", "INR 1,790,000", "INR 1,750,000", "102.3%", "4.6"],
          ["South", "Bengaluru Hub", "3,100", "INR 1,120,000", "INR 1,100,000", "101.8%", "4.4"],
          ["East", "Kolkata Hub", "3,450", "INR 2,150,000", "INR 2,200,000", "97.7%", "4.0"],
          ["West", "Mumbai Hub", "3,800", "INR 1,480,000", "INR 1,500,000", "98.7%", "4.3"],
          ["West", "Pune Depot", "2,250", "INR 840,000", "INR 820,000", "102.4%", "4.2"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 4: Section 3 — Delivery Performance & Delay Report (8 rows)
  {
    const p = newPage(4);
    p.drawText("3. Delivery Performance & Delay Report;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["Delivery ID", "Carrier", "Route", "SLA (days)", "Actual (days)", "Delay (days)", "Status"],
        colWidths: [72, 128, 92, 60, 65, 62, 55],
        rows: [
          ["NS-DL-2101", "Meridian Freight Services", "Delhi - Jaipur", "2", "3", "1", "Delayed"],
          ["NS-DL-2102", "BluePeak Logistics Pvt Ltd", "Mumbai - Pune", "2", "2", "0", "On Time"],
          ["NS-DL-2103", "Harborline Transport Co", "Chennai - Bengaluru", "3", "6", "3", "Delayed"],
          ["NS-DL-2104", "BluePeak Logistics Pvt Ltd", "Kolkata - Patna", "3", "3", "0", "On Time"],
          ["NS-DL-2105", "Meridian Freight Services", "Delhi - Lucknow", "2", "4", "2", "Delayed"],
          ["NS-DL-2106", "Harborline Transport Co", "Mumbai - Ahmedabad", "2", "7", "5", "Delayed"],
          ["NS-DL-2107", "BluePeak Logistics Pvt Ltd", "Chennai - Hyderabad", "2", "2", "0", "On Time"],
          ["NS-DL-2108", "Meridian Freight Services", "Pune - Nagpur", "3", "4", "1", "Delayed"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 5: Section 4 — Inventory Status & Reorder Levels (6 rows)
  {
    const p = newPage(5);
    p.drawText("4. Inventory Status & Reorder Review;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["SKU", "Item Description", "Current Stock", "Reorder Point", "Deficit", "Status"],
        colWidths: [82, 155, 72, 72, 58, 95],
        rows: [
          ["NS-SKU-101", "Servo Drive Controller", "45", "120", "75", "BELOW REORDER POINT"],
          ["NS-SKU-102", "Linear Actuator Assembly", "210", "150", "0", "Above Reorder Point"],
          ["NS-SKU-103", "Industrial Pressure Sensor", "30", "180", "150", "BELOW REORDER POINT"],
          ["NS-SKU-104", "Precision Ball Bearing Kit", "95", "140", "45", "BELOW REORDER POINT"],
          ["NS-SKU-105", "PLC Communication Module", "320", "200", "0", "Above Reorder Point"],
          ["NS-SKU-106", "Thermal Overload Relay", "60", "110", "50", "BELOW REORDER POINT"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 6: Section 5 — Vendor Performance Scorecard (3 rows)
  {
    const p = newPage(6);
    p.drawText("5. Vendor Performance Evaluation;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["Vendor", "On-Time %", "Target SLA", "Damage %", "Transit Variance", "Rating"],
        colWidths: [148, 72, 72, 72, 95, 75],
        rows: [
          ["Meridian Freight Services", "84.5%", "95%", "1.4%", "+2.1 days", "4.2"],
          ["BluePeak Logistics Pvt Ltd", "91.2%", "95%", "0.9%", "+0.8 days", "4.6"],
          ["Harborline Transport Co", "78.4%", "95%", "2.8%", "+3.4 days", "3.7"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 7: Section 6 — Supply Chain Risk Register (4 rows)
  {
    const p = newPage(7);
    p.drawText("6. Supply Chain Risk Register;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["Risk ID", "Risk Description", "Severity", "Likelihood", "Mitigation Plan", "Owner"],
        colWidths: [55, 165, 65, 68, 115, 72],
        rows: [
          ["RSK-01", "Port congestion on West corridor", "High", "High", "Dual-carrier routing", "Head of Logistics"],
          ["RSK-02", "Single-source sensor dependency", "Critical", "Medium", "Qualify secondary supplier", "Procurement Lead"],
          ["RSK-03", "In-transit cargo damage spike", "High", "Medium", "Shock-pallet packaging", "Warehouse Manager"],
          ["RSK-04", "Safety stock buffer depletion", "High", "High", "Automated reorder triggers", "Inventory Lead"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 8: Section 7 — Governance & Meeting Action Items (4 rows)
  {
    const p = newPage(8);
    p.drawText("7. Governance & Meeting Action Items;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["Owner", "Action Item", "Priority", "Deadline"],
        colWidths: [115, 245, 80, 95],
        rows: [
          ["Head of Logistics", "Reallocate West corridor lanes from Harborline", "High", "15 Oct 2026"],
          ["Procurement Lead", "Renegotiate SLA credits for delayed shipments", "High", "22 Oct 2026"],
          ["Inventory Lead", "Trigger replenishment POs for 4 deficit SKUs", "Critical", "10 Oct 2026"],
          ["Finance Controller", "Audit Q3 regional operating expense variances", "Medium", "30 Oct 2026"]
        ]
      },
      font,
      boldFont
    );
  }

  // Page 9: Section 8 — Strategic Recommendations (4 rows)
  {
    const p = newPage(9);
    p.drawText("8. Strategic Recommendations & Recovery Roadmap;", { x: 36, y: 730, size: 12, font: boldFont, color: rgb(0.08, 0.12, 0.2) });
    drawBorderedTable(
      p,
      36,
      700,
      {
        headers: ["Rec ID", "Recommendation", "Priority", "Timeline", "Expected Impact"],
        colWidths: [55, 200, 65, 85, 130],
        rows: [
          ["REC-01", "Shift 30% Harborline volume to BluePeak", "High", "Q4 2026", "Reduce delay by 45%"],
          ["REC-02", "Replenish 320 deficit units immediately", "Critical", "Immediate", "Prevent West stockouts"],
          ["REC-03", "Mandate cushioned palletizing on fragile freight", "Medium", "Nov 2026", "Cut damage below 1.2%"],
          ["REC-04", "Deploy automated reorder alerts at 110% ROP", "Medium", "Q1 2027", "Stabilize fill rate"]
        ]
      },
      font,
      boldFont
    );
  }

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

async function runPipelineOnDoc(doc: DemoDocument, allDocs: DemoDocument[], question: string) {
  const investigationId = `inv-test-${Date.now()}`;
  const classification = classifyUserQuery(question, doc);
  const retrievedChunks = hybridRetrieveChunks(doc, question, classification, 6);
  const sqlEvidence = executeDocumentSQLAgent(doc, question, classification);
  const graphEvidence = executeDocumentGraphAgent(doc, classification);
  const evidencePkg = buildEvidencePackage({
    doc,
    investigation_id: investigationId,
    query: question,
    classification,
    chunks: retrievedChunks,
    sqlEvidence,
    graphEvidence
  });
  const decision = await synthesizeEvidenceFirstDecision({
    doc,
    classification,
    sqlEvidence,
    graphEvidence,
    evidencePkg
  });
  const validation = runCriticValidationAgent({
    doc,
    allDocs,
    investigation_id: investigationId,
    classification,
    retrievedChunks,
    sqlEvidence,
    graphEvidence,
    evidencePkg,
    decision
  });
  return { classification, retrievedChunks, sqlEvidence, evidencePkg, decision, validation };
}

async function main() {
  const pdfBuf = await buildNorthstarTestPackPdfBuffer();
  const parsed = await extractPdfBuffer(pdfBuf, "fictional_supply_chain_test_pack_2026.pdf");
  assert.equal(parsed.success, true, "PDF extraction must succeed");
  assert.equal(parsed.pages_count, 9, "Expected 9 pages");

  const doc = buildIndexedDocument({
    id: 202,
    title: "fictional_supply_chain_test_pack_2026.pdf",
    doc_type: "PDF",
    storage_path: "/uploads/fictional_supply_chain_test_pack_2026.pdf",
    content: parsed.text,
    pages: parsed.pages,
    unparsed_pages: parsed.unparsed_pages,
    extraction_status: parsed.extractionStatus,
    is_uploaded: true
  });

  const tableCounts: Record<string, number> = {};
  for (const tbl of doc.sql_records) {
    tableCounts[tbl.table_name] = tbl.rows.length;
  }
  console.log("SQL_TABLE_COUNTS=" + JSON.stringify(tableCounts));
  console.log("ATOMIC_ROWS=" + doc.atomic_table_rows.length);
  console.log("SECTIONS_COUNT=" + doc.sections.length, doc.sections.map((s) => `${s.section_number}: ${s.section_title} (p${s.page_number})`));

  if (process.env.BASELINE_ONLY === "1") {
    console.log("SUPPLIERS_BEFORE=" + JSON.stringify(extractSuppliersFromText(doc.content, doc.chunks).map((s) => s.name)));
    console.log("PNL_BEFORE=" + JSON.stringify(extractRegionalFinancialRecordsFromDoc(doc).map((r) => ({ region: r.region, profit: r.operating_profit, margin: r.margin_pct }))));
    console.log("INV_BEFORE=" + JSON.stringify(extractInventoryRecordsFromDoc(doc).map((r) => r.sku)));
    return;
  }

  // Assert exact expected results (ALL 7 root causes + 9 tables + Q&A + Critic)
  const expectedTables: Array<[string, number]> = [
    ["regional_p_and_l", 4],
    ["monthly_totals", 3],
    ["regional_sales", 7],
    ["delivery_report", 8],
    ["inventory_status", 6],
    ["vendor_performance", 3],
    ["risk_register", 4],
    ["meeting_action_items", 4],
    ["recommendations", 4]
  ];
  for (const [name, expectedCount] of expectedTables) {
    const tbl = doc.sql_records.find((t) => t.table_name === name);
    assert.ok(tbl, `Missing SQL table: ${name}`);
    assert.equal(tbl.rows.length, expectedCount, `Table ${name} expected ${expectedCount} rows, got ${tbl.rows.length}`);
    for (const row of tbl.rows) {
      assert.equal(row.document_id, 202, `${name} row missing document_id=202`);
      assert.ok(Number.isFinite(row.source_page) && row.source_page >= 1, `${name} row missing source_page`);
      assert.ok(typeof row.chunk_id === "string" && row.chunk_id.startsWith("doc-202-"), `${name} row missing valid chunk_id: ${row.chunk_id}`);
    }
  }

  // Root Cause #1: Inventory records (6 SKUs including NS-SKU-101..106) & never false-matching NS-DL-2106
  const invRows = extractInventoryRecordsFromDoc(doc);
  assert.equal(invRows.length, 6);
  assert.ok(!invRows.some((r) => r.sku.startsWith("NS-DL")), "Must not match delivery IDs as SKUs");
  assert.ok(invRows.some((r) => r.sku === "NS-SKU-101" && r.deficit === 75));
  assert.ok(invRows.some((r) => r.sku === "NS-SKU-103" && r.deficit === 150));

  // Root Cause #2: Regional P&L column mapping (opex != COGS/Logistics, no July month leak, valid margin)
  const pnlRows = extractRegionalFinancialRecordsFromDoc(doc);
  assert.equal(pnlRows.length, 4);
  const north = pnlRows.find((r) => r.region === "North");
  assert.ok(north, "Must extract North region");
  assert.equal(north.gross_revenue, 2840000);
  assert.equal(north.operating_expenses, 597000, "operating_expenses must come from Operating expenses column, not COGS/Logistics");
  assert.equal(north.operating_profit, 413000);
  assert.equal(north.margin_pct, "14.5%");
  assert.ok(!pnlRows.some((r) => /July|August|September/i.test(r.region)), "Monthly rows must not leak into regional_p_and_l");

  // Root Cause #4: Suppliers (3 vendors from col 0, no "Target SLA Transit")
  const suppliers = extractSuppliersFromText(doc.content, doc.chunks, doc.atomic_table_rows, doc.id);
  const supNames = suppliers.map((s) => s.name);
  assert.equal(supNames.length, 3, `Expected 3 vendors, got: ${JSON.stringify(supNames)}`);
  assert.ok(supNames.includes("Meridian Freight Services"));
  assert.ok(supNames.includes("BluePeak Logistics Pvt Ltd"));
  assert.ok(supNames.includes("Harborline Transport Co"));
  assert.ok(!supNames.some((n) => /target|sla|transit\s*$|rate|variance|accuracy/i.test(n) && !/Freight|Logistics|Transport/.test(n)));

  // Root Cause #5: Sections (cover page + 8 numbered sections = 9, no repeating headers/footers)
  assert.equal(doc.sections.length, 9, `Expected 9 sections, got ${doc.sections.length}`);
  assert.ok(doc.sections.every((s) => !/FICTIONAL TEST DATA|^Page \d+/i.test(s.section_title)));
  assert.ok(doc.sections.some((s) => s.section_title.includes("Quarterly Financial P&L")));

  // Root Cause #6: Zero hardcoded doc-0-p1-c0 in any artifact
  const docJson = JSON.stringify(doc);
  assert.ok(!docJson.includes("doc-0-"), "Indexed doc must not contain doc-0-* chunk IDs");

  // Root Cause #7: End-to-End Q&A + Critic checks across Inventory, Financial, Vendor OTD, Vendor Damage, Delivery, Sales
  const invRes = await runPipelineOnDoc(doc, [doc], "Which SKUs are below reorder point, which SKU has the largest shortage, and what is the total replenishment needed?");
  assert.notEqual(invRes.decision.answer_type, "insufficient_evidence", "Inventory query must never return insufficient_evidence");
  assert.equal(invRes.validation.validation_status, "PASSED", `Inventory Critic failed: ${invRes.validation.rejection_reasons.join("; ")}`);
  assert.equal(invRes.decision.inventory_analysis.total_below_reorder, 4);
  assert.equal(invRes.decision.inventory_analysis.total_replenishment_units, 320);
  assert.equal(invRes.decision.inventory_analysis.largest_shortage_sku.sku, "NS-SKU-103");
  assert.ok(invRes.evidencePkg.source_citations.some((c) => c.page_number === 5 && c.chunk_id.startsWith("doc-202-p5-")), "Must cite page-5 chunk");

  const finRes = await runPipelineOnDoc(doc, [doc], "Calculate the total operating profit across all four regions.");
  assert.equal(finRes.validation.validation_status, "PASSED", `Financial Critic failed: ${finRes.validation.rejection_reasons.join("; ")}`);
  assert.ok(finRes.decision.direct_answer.includes("1,426,000"));
  assert.ok(finRes.sqlEvidence.table_inspected.startsWith("regional_p_and_l"));

  const vendorOtdRes = await runPipelineOnDoc(doc, [doc], "Which vendor has the lowest on-time delivery?");
  assert.equal(vendorOtdRes.validation.validation_status, "PASSED");
  assert.equal(vendorOtdRes.decision.qa_result.records[0].vendor, "Harborline Transport Co");
  assert.equal(vendorOtdRes.decision.qa_result.records[0].value, 78.4);

  const vendorDmgRes = await runPipelineOnDoc(doc, [doc], "Which vendor has the highest damage rate?");
  assert.equal(vendorDmgRes.validation.validation_status, "PASSED", `Damage QA Critic failed: ${vendorDmgRes.validation.rejection_reasons.join("; ")}`);
  assert.equal(vendorDmgRes.decision.qa_result.records[0].vendor, "Harborline Transport Co");
  assert.equal(vendorDmgRes.decision.qa_result.records[0].value, 2.8);

  const delivRes = await runPipelineOnDoc(doc, [doc], "Which delivery had the highest delay in the delivery report?");
  assert.equal(delivRes.validation.validation_status, "PASSED", `Delivery Critic failed: ${delivRes.validation.rejection_reasons.join("; ")}`);
  assert.ok(delivRes.sqlEvidence.table_inspected.startsWith("delivery_report"));
  assert.equal(delivRes.sqlEvidence.rows.length, 8);

  const missingOtdIntent = parseQuestionIntent("Which vendor has the lowest customer satisfaction score?");
  const missingQa = runVendorMetricQA(doc, "Which vendor has the lowest customer satisfaction score?", missingOtdIntent);
  assert.equal(missingQa.status, "insufficient_evidence");

  console.log("ALL SUPPLY CHAIN PACK TESTS PASSED!");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
