// tests/run_all_12_tests.js
// Automated End-to-End Test Suite for All 12 Accuracy, PDF Grounding, Provenance, and Isolation Tests
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const baseUrl = "http://localhost:3000";

function wrapPdfLine(text, maxChars = 90) {
  if (text.length <= maxChars) return [text];
  const words = text.split(" ");
  const out = [];
  let cur = "";
  for (const w of words) {
    if ((cur + (cur ? " " : "") + w).length <= maxChars) {
      cur = cur ? `${cur} ${w}` : w;
    } else {
      if (cur) out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function createPdfBase64(pages) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const p of pages) {
    const page = pdfDoc.addPage([612, 792]);
    const { height } = page.getSize();
    let y = height - 45;

    for (const rawLine of p.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        y -= 8;
        continue;
      }
      const isHeading = /^(SECTION\s+\d+|[A-Z0-9\s,&/()-]{6,})$/.test(line);
      const wrapped = wrapPdfLine(line, 90);
      for (let wi = 0; wi < wrapped.length; wi++) {
        page.drawText(wrapped[wi], {
          x: wi === 0 ? 40 : 50,
          y,
          size: isHeading ? 11 : 9.5,
          font: isHeading ? boldFont : font,
          color: rgb(0.15, 0.15, 0.2)
        });
        y -= 14;
      }
    }
  }
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes).toString("base64");
}

async function createBlankScannedPdfBase64() {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([612, 792]); // Page with zero extractable text
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes).toString("base64");
}

async function queryAndGetFinalState(question, targetDocId) {
  const qRes = await fetch(`${baseUrl}/api/ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, target_document_id: targetDocId, active_document_id: targetDocId })
  });
  const initJson = await qRes.json();
  if (!qRes.ok) {
    throw new Error(`Query init failed (${qRes.status}): ${JSON.stringify(initJson)}`);
  }

  const streamRes = await fetch(`${baseUrl}/api/ai/query/${initJson.session_id}/stream`);
  const streamText = await streamRes.text();
  const lines = streamText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "event: complete" && lines[i + 1]?.startsWith("data: ")) {
      const payload = JSON.parse(lines[i + 1].replace("data: ", ""));
      return payload.state;
    }
  }
  throw new Error(`Did not receive SSE complete event for session ${initJson.session_id}`);
}

async function uploadPdf(filename, pages) {
  const base64 = await createPdfBase64(pages);
  const res = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, type: "PDF", base64 })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(`Upload failed for ${filename}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function runTests() {
  console.log("================================================================================");
  console.log("RUNNING MANDATORY 12-TEST GRAPHRAG GROUNDING & ISOLATION SUITE");
  console.log("================================================================================\n");

  let passed = 0;
  const total = 12;

  // Prepare 9-section comprehensive PDF uploaded with Apex Transit Services via real PDF parsing
  const nineSectionPages = [
    `SECTION 1: EXECUTIVE OPERATIONS SUMMARY
Date: 28 October 2026
Attendees: Chief Operating Officer, Head of Logistics, Procurement Lead, Warehouse Manager, Finance Controller`,
    `SECTION 2: EXECUTIVE MEETING ACTION ITEMS
1. Head of Logistics | Publish exception dashboard pilot plan | 6 Nov 2026
2. Procurement Lead | Obtain vendor recovery plan | 9 Nov 2026
3. Warehouse Manager | Complete SKU-002 reconciliation | 4 Nov 2026
4. Finance Controller | Issue freight-charge validation checklist | 11 Nov 2026`,
    `SECTION 3: LOGISTICS DELAY POST-MORTEM ANALYSIS
Incident: Regional Cross-Dock Delivery Latency Escalation
DOCUMENTED ROOT CAUSES:
1. Cross-dock capacity planning failure: Over-allocation at regional transit hubs.
2. Missing automated shipment exception alerts: Delayed carrier escalation by 72+ hours.
3. Unclear carrier escalation ownership: Ambiguity over expedited carrier authority.`,
    `SECTION 4: SEPTEMBER FINANCIAL P&L STATEMENT
Reporting Currency: INR
Region: North | Gross Revenue: INR 2,840,000 | Operating Expenses: INR 2,427,000 | September Operating Profit: INR 413,000 | Margin: 14.5%
Region: South | Gross Revenue: INR 2,910,000 | Operating Expenses: INR 2,497,000 | September Operating Profit: INR 413,000 | Margin: 14.2%
Region: East  | Gross Revenue: INR 2,150,000 | Operating Expenses: INR 1,860,000 | September Operating Profit: INR 290,000 | Margin: 13.5%
Region: West  | Gross Revenue: INR 2,320,000 | Operating Expenses: INR 2,010,000 | September Operating Profit: INR 310,000 | Margin: 13.4%`,
    `SECTION 5: INVENTORY STATUS & REORDER REVIEW
- SKU-001 (Precision Roller Bearings): Current Stock: 140 units | Reorder Point: 200 units | Status: BELOW REORDER POINT
- SKU-002 (Hydraulic Flange Seal): Current Stock: 520 units | Reorder Point: 300 units | Status: Above Reorder Point
- SKU-003 (Control Solenoid Valve): Current Stock: 85 units | Reorder Point: 150 units | Status: BELOW REORDER POINT
- SKU-004 (High-Pressure Coupler): Current Stock: 410 units | Reorder Point: 400 units | Status: Above Reorder Point
- SKU-005 (Digital Sensor Cable Assembly): Current Stock: 60 units | Reorder Point: 120 units | Status: BELOW REORDER POINT`,
    `SECTION 6: SUPPLIER & CARRIER AUDIT
- Apex Transit Services: On-Time Delivery Rate: 74.0% (Target: 95.0%) | Transit Variance: +3.8 days | SLA Breach Count: 9 incidents
- Meridian Freight Group: On-Time Delivery Rate: 81.2% (Target: 95.0%) | Transit Variance: +2.6 days | Telemetry Availability: 78.0%`,
    `SECTION 7: WAREHOUSE THROUGHPUT METRICS
Regional cross-dock utilization reached 94.2% during peak October consolidation windows.`,
    `SECTION 8: FLEET TELEMETRY COMPLIANCE
Mandatory EDI 214 status updates must fire within 30 minutes of hub arrival.`,
    `SECTION 9: NEXT QUARTER GOVERNANCE ROADMAP
Audit steering committee convenes on 15 November 2026 to review carrier recovery milestones.`
  ];

  const uploaded9 = await uploadPdf("Enterprise_9Section_Supply_Chain_2026.pdf", nineSectionPages);
  const uploaded9Id = uploaded9.document_id;
  console.log(`Uploaded 9-section PDF as Doc #${uploaded9Id} (version ${uploaded9.source_version}, ${uploaded9.sections_count} sections)\n`);

  // TEST 1: List all suppliers in uploaded PDF (Apex Transit Services)
  {
    const st = await queryAndGetFinalState("List all suppliers mentioned in the uploaded PDF.", uploaded9Id);
    const rows = st?.decision?.table_data?.rows || [];
    const blob = JSON.stringify(rows);
    const ok =
      st.active_document_id === uploaded9Id &&
      blob.includes("Apex Transit Services") &&
      blob.includes("Meridian Freight Group") &&
      !st.doc_evidence.chunks.some((c) => c.section_title.includes("ACTION ITEMS")) &&
      st.validation_result?.is_valid === true;
    console.log(`[TEST 1] Suppliers in uploaded PDF -> ${ok ? "PASSED" : "FAILED"} (rows=${rows.length})`);
    if (ok) passed++;
    else console.error("  Details:", { rows, valid: st.validation_result });
  }

  // TEST 2: Meeting action items with owners & deadlines
  {
    const st = await queryAndGetFinalState("Extract all meeting action items with owners and deadlines.", uploaded9Id);
    const rows = st?.decision?.table_data?.rows || [];
    const ok =
      rows.length === 4 &&
      rows.some((r) => r[0].includes("Head of Logistics") && r[2].includes("6 Nov 2026")) &&
      rows.some((r) => r[0].includes("Procurement Lead") && r[2].includes("9 Nov 2026")) &&
      rows.some((r) => r[0].includes("Warehouse Manager") && r[2].includes("4 Nov 2026")) &&
      rows.some((r) => r[0].includes("Finance Controller") && r[2].includes("11 Nov 2026")) &&
      st.validation_result?.is_valid === true;
    console.log(`[TEST 2] Meeting action items -> ${ok ? "PASSED" : "FAILED"} (rows=${rows.length})`);
    if (ok) passed++;
    else console.error("  Details:", rows);
  }

  // TEST 3: Main sections covered in PDF (all 9 sections!)
  {
    const st = await queryAndGetFinalState("What are the main sections covered in this PDF?", uploaded9Id);
    const rows = st?.decision?.table_data?.rows || [];
    const ok =
      rows.length === 9 &&
      JSON.stringify(rows).includes("FLEET TELEMETRY COMPLIANCE") &&
      JSON.stringify(rows).includes("NEXT QUARTER GOVERNANCE ROADMAP") &&
      st.validation_result?.is_valid === true;
    console.log(`[TEST 3] Main sections covered in PDF -> ${ok ? "PASSED" : "FAILED"} (sections=${rows.length})`);
    if (ok) passed++;
    else console.error("  Details:", rows);
  }

  // TEST 4: Highest operating profit in September (North & South INR 413,000)
  {
    const st = await queryAndGetFinalState("Which regions generated the highest operating profit in September?", uploaded9Id);
    const conc = (st?.decision?.conclusion || "") + " " + (st?.decision?.direct_answer || "");
    const ok =
      conc.toLowerCase().includes("north") &&
      conc.toLowerCase().includes("south") &&
      conc.includes("413,000") &&
      conc.includes("INR") &&
      st.validation_result?.is_valid === true;
    console.log(`[TEST 4] September Operating Profit -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", conc);
  }

  // TEST 5: Inventory SKUs below reorder points (SKU-001, SKU-003, SKU-005)
  {
    const st = await queryAndGetFinalState("Which inventory SKUs are below their reorder points?", uploaded9Id);
    const rows = st?.decision?.table_data?.rows || [];
    const skus = rows.map((r) => r[0]);
    const ok =
      rows.length === 3 &&
      skus.includes("SKU-001") &&
      skus.includes("SKU-003") &&
      skus.includes("SKU-005") &&
      !skus.includes("SKU-002") &&
      !skus.includes("SKU-004") &&
      st.validation_result?.is_valid === true;
    console.log(`[TEST 5] Inventory SKUs below reorder -> ${ok ? "PASSED" : "FAILED"} (skus=${skus.join(",")})`);
    if (ok) passed++;
    else console.error("  Details:", rows);
  }

  // TEST 6: Original sample PDF (Doc #201) suppliers & performance (NO Apex Transit Services!)
  {
    const st = await queryAndGetFinalState(
      "List the suppliers mentioned in the original sample PDF and their delivery performance.",
      201
    );
    const blob = JSON.stringify(st?.decision?.table_data?.rows || []);
    const ok =
      st.active_document_id === 201 &&
      blob.includes("Acme Freight Express") &&
      blob.includes("71.4%") &&
      blob.includes("Delta Logistics Corp") &&
      blob.includes("68.2%") &&
      blob.includes("Global Carrier Partners") &&
      blob.includes("79.5%") &&
      !blob.includes("Apex Transit Services") &&
      !st.doc_evidence.chunks.some((c) => c.page_number === 1) &&
      st.validation_result?.is_valid === true;
    console.log(`[TEST 6] Original sample PDF (Doc #201) suppliers -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", { blob, chunks: st.doc_evidence.chunks.map((c) => c.page_number) });
  }

  // TEST 7: Analyze Product X sales decline in Region A on Doc #201 (Must be unavailable!)
  {
    const st = await queryAndGetFinalState("Analyze Product X sales decline in Region A.", 201);
    const ok =
      st?.decision?.answer_type === "insufficient_evidence" &&
      st?.sql_evidence?.rows?.length === 0 &&
      st?.validation_result?.validation_status === "INSUFFICIENT_EVIDENCE";
    console.log(`[TEST 7] Product X in Region A on Doc #201 (Missing Info) -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", st?.decision);
  }

  // TEST 8: Who is the CEO of the company? on Doc #201 (Must NOT confuse COO with CEO!)
  {
    const st = await queryAndGetFinalState("Who is the CEO of the company?", 201);
    const ok =
      st?.decision?.answer_type === "insufficient_evidence" &&
      (st?.decision?.insufficient_evidence_reason || "").includes("CEO") &&
      !(st?.decision?.direct_answer || "").includes("is the CEO");
    console.log(`[TEST 8] Who is the CEO? (COO != CEO distinction) -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", st?.decision);
  }

  // TEST 9: What is the supplier's contract value? on Doc #201 (Must be unavailable!)
  {
    const st = await queryAndGetFinalState("What is the supplier's contract value?", 201);
    const ok =
      st?.decision?.answer_type === "insufficient_evidence" &&
      (st?.decision?.insufficient_evidence_reason || "").includes("Contract Value");
    console.log(`[TEST 9] Supplier Contract Value (Missing Info) -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", st?.decision);
  }

  // TEST 10: Two consecutive different queries -> zero context contamination
  {
    const stA = await queryAndGetFinalState("Which inventory SKUs are below their reorder points?", 201);
    const stB = await queryAndGetFinalState("Identify the logistics delay root causes.", 201);
    const blobB = JSON.stringify(stB?.decision || {});
    const ok =
      stA.investigation_id !== stB.investigation_id &&
      !blobB.includes("SKU-001") &&
      !blobB.includes("SKU-003") &&
      blobB.toLowerCase().includes("cross-dock capacity planning failure") &&
      blobB.toLowerCase().includes("missing automated shipment exception alerts");
    console.log(`[TEST 10] Consecutive Query Isolation -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", { invA: stA.investigation_id, invB: stB.investigation_id, blobB });
  }

  // TEST 11: Upload TWO PDFs with different suppliers (and identical filenames!) -> strict unique doc_id isolation
  const pdfA = await uploadPdf("Vendor_Audit_Report.pdf", [
    `VENDOR PERFORMANCE AUDIT
- Omega Maritime Logistics: On-Time Delivery Rate: 64.0% (Target: 95.0%) | Transit Variance: +6.5 days | SLA Breach Count: 18 incidents`
  ]);
  const pdfB = await uploadPdf("Vendor_Audit_Report.pdf", [
    `VENDOR PERFORMANCE AUDIT
- Vanguard Rail Carriers: On-Time Delivery Rate: 88.5% (Target: 95.0%) | Transit Variance: +1.9 days | Telemetry Availability: 91.0%`
  ]);
  {
    const stA = await queryAndGetFinalState("List all suppliers mentioned in the uploaded PDF.", pdfA.document_id);
    const stB = await queryAndGetFinalState("List all suppliers mentioned in the uploaded PDF.", pdfB.document_id);
    const blobA = JSON.stringify(stA?.decision?.table_data?.rows || []);
    const blobB = JSON.stringify(stB?.decision?.table_data?.rows || []);
    const ok =
      pdfA.document_id !== pdfB.document_id &&
      blobA.includes("Omega Maritime Logistics") &&
      !blobA.includes("Vanguard Rail Carriers") &&
      blobB.includes("Vanguard Rail Carriers") &&
      !blobB.includes("Omega Maritime Logistics");
    console.log(`[TEST 11] Duplicate-Filename Dual-PDF Isolation -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", { blobA, blobB });
  }

  // TEST 12: Switch active_document_id between Doc #101, pdfA, and Doc #201 + verify scanned PDF rejection
  {
    const st101 = await queryAndGetFinalState("Why did Product X sales drop in Region A during Q3?", 101);
    const stA2 = await queryAndGetFinalState("List all suppliers mentioned in the uploaded PDF.", pdfA.document_id);
    const blankBase64 = await createBlankScannedPdfBase64();
    const scanRes = await fetch(`${baseUrl}/api/data/parse-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "scanned_image_only.pdf", base64: blankBase64 })
    });
    const scanJson = await scanRes.json();

    const ok =
      st101.active_document_id === 101 &&
      JSON.stringify(st101.decision).includes("Supplier Y") &&
      stA2.active_document_id === pdfA.document_id &&
      JSON.stringify(stA2.decision).includes("Omega Maritime Logistics") &&
      !JSON.stringify(stA2.decision).includes("Supplier Y") &&
      scanRes.status === 422 &&
      scanJson.isScanned === true;

    console.log(`[TEST 12] Active Target Switching & Scanned-PDF Rejection -> ${ok ? "PASSED" : "FAILED"}`);
    if (ok) passed++;
    else console.error("  Details:", { st101Id: st101.active_document_id, stA2Id: stA2.active_document_id, scanStatus: scanRes.status, scanJson });
  }

  // TEST 13: Financial performance analysis query routing & isolation (must NOT select meeting_action_items)
  {
    const stFin = await queryAndGetFinalState(
      "Give me a regional financial performance analysis for September 2026, comparing gross revenue, operating expenses, operating profit, and profit margin.",
      uploaded9Id
    );
    const tableInspected = stFin?.sql_evidence?.table_inspected || "";
    const rows = stFin?.decision?.table_data?.rows || [];
    const ok =
      stFin?.decision?.answer_type === "comparison" &&
      tableInspected.startsWith("regional_p_and_l") &&
      rows.length >= 4 &&
      rows.some((r) => r[0].toLowerCase().includes("north")) &&
      rows.some((r) => r[0].toLowerCase().includes("south")) &&
      stFin.validation_result?.is_valid === true;

    console.log(`[TEST 13] Financial Query Routing & SQL Isolation -> ${ok ? "PASSED" : "FAILED"} (table=${tableInspected})`);
    if (ok) passed++;
    else console.error("  Details:", { tableInspected, decision: stFin?.decision, sql: stFin?.sql_evidence });
  }

  // TEST 14: Meeting action items query routing (must NOT select regional_p_and_l)
  {
    const stMeet = await queryAndGetFinalState(
      "Extract all meeting action items with owners and deadlines.",
      uploaded9Id
    );
    const tableInspected = stMeet?.sql_evidence?.table_inspected || "";
    const rows = stMeet?.decision?.table_data?.rows || [];
    const ok =
      tableInspected.startsWith("meeting_action_items") &&
      rows.length === 4 &&
      stMeet.validation_result?.is_valid === true;

    console.log(`[TEST 14] Meeting Query Routing & Table Separation -> ${ok ? "PASSED" : "FAILED"} (table=${tableInspected})`);
    if (ok) passed++;
    else console.error("  Details:", { tableInspected, decision: stMeet?.decision });
  }

  console.log("\n================================================================================");
  console.log(`FINAL EVALUATION RESULT: ${passed} / 14 TESTS PASSED.`);
  console.log("================================================================================");

  if (passed !== 14) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});
