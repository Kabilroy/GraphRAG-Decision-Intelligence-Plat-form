import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildIndexedDocument } from "../server_engine/ingestion";
import {
  assertVerifiedResultConsistency,
  INSUFFICIENT_EVIDENCE_EXACT,
  parseQuestionIntent,
  runVendorMetricQA
} from "../server_engine/metric_qa";

const BASE_URL = "http://localhost:3000";

async function createPdfBase64(pages: string[]): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const pageText of pages) {
    const page = pdfDoc.addPage([612, 792]);
    let y = 745;
    for (const raw of pageText.split("\n")) {
      const line = raw.trimEnd();
      if (!line.trim()) {
        y -= 10;
        continue;
      }
      page.drawText(line.trim(), {
        x: 40,
        y,
        size: 10,
        font,
        color: rgb(0.1, 0.12, 0.18)
      });
      y -= 16;
    }
  }
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes).toString("base64");
}

async function uploadPdfPages(filename: string, pages: string[]) {
  const base64 = await createPdfBase64(pages);
  const res = await fetch(`${BASE_URL}/api/data/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, type: "PDF", base64 })
  });
  const json = await res.json();
  assert.equal(res.status, 200, `Upload failed for ${filename}: ${JSON.stringify(json)}`);
  assert.equal(json.success, true);
  return json;
}

async function queryDoc(question: string, docId: number) {
  const initRes = await fetch(`${BASE_URL}/api/ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, target_document_id: docId, active_document_id: docId })
  });
  const initJson = await initRes.json();
  assert.equal(initRes.status, 200, `Query init failed: ${JSON.stringify(initJson)}`);

  const streamRes = await fetch(`${BASE_URL}/api/ai/query/${initJson.session_id}/stream`);
  const streamText = await streamRes.text();
  const lines = streamText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "event: complete" && lines[i + 1]?.startsWith("data: ")) {
      return JSON.parse(lines[i + 1].replace("data: ", "")).state;
    }
  }
  throw new Error(`No complete event received for question: "${question}"`);
}

async function run() {
  console.log("================================================================================");
  console.log("DOCUMENT-GROUNDED Q&A & VERIFICATION PIPELINE TEST SUITE (10 MANDATORY TESTS)");
  console.log("================================================================================\n");

  let passed = 0;

  // TEST 1: Lowest and highest vendor on a single table
  {
    const up = await uploadPdfPages("Vendor_Scorecard_Single_Table.pdf", [
      [
        "VENDOR PERFORMANCE SCORECARD Q4",
        "Vendor Name | Tier | On-Time Delivery % | Target SLA",
        "Aurora Freight | Tier 1 | 94.2% | 95%",
        "Beacon Transit | Tier 2 | 72.4% | 95%",
        "Crestline Logistics | Tier 1 | 88.9% | 95%",
        "Harbor Carriers | Tier 1 | 96.8% | 95%"
      ].join("\n")
    ]);

    const lowState = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(lowState.qa_result.status, "answered");
    assert.equal(lowState.qa_result.records_compared, 4);
    assert.equal(lowState.qa_result.records[0].vendor, "Beacon Transit");
    assert.equal(lowState.qa_result.records[0].value, 72.4);
    assert.ok(lowState.decision.direct_answer.includes("Beacon Transit"));
    assert.ok(lowState.decision.direct_answer.includes("72.4%"));
    assert.equal(lowState.validation_result.validation_status, "PASSED");

    const highState = await queryDoc("Which vendor has the highest on-time delivery?", up.document_id);
    assert.equal(highState.qa_result.status, "answered");
    assert.equal(highState.qa_result.records_compared, 4);
    assert.equal(highState.qa_result.records[0].vendor, "Harbor Carriers");
    assert.equal(highState.qa_result.records[0].value, 96.8);
    assert.ok(highState.decision.direct_answer.includes("Harbor Carriers"));
    assert.ok(highState.decision.direct_answer.includes("96.8%"));
    assert.equal(highState.validation_result.validation_status, "PASSED");

    console.log("[PASS 1] Lowest (Beacon Transit 72.4%) and Highest (Harbor Carriers 96.8%) on single table.");
    passed++;
  }

  // TEST 2: Tie between two vendors
  {
    const up = await uploadPdfPages("Vendor_Scorecard_Tie.pdf", [
      [
        "CARRIER OTD AUDIT",
        "Vendor | Delivery Performance | Region",
        "Atlas Freight | 74.5% | West",
        "Boreal Logistics | 91.0% | East",
        "Cascade Transport | 74.5% | North",
        "Dune Express | 86.2% | South"
      ].join("\n")
    ]);

    const st = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(st.qa_result.status, "answered");
    assert.equal(st.qa_result.records_compared, 4);
    assert.deepEqual(st.qa_result.ties.sort(), ["Atlas Freight", "Cascade Transport"]);
    assert.ok(st.decision.direct_answer.includes("Atlas Freight"));
    assert.ok(st.decision.direct_answer.includes("Cascade Transport"));
    assert.ok(st.decision.direct_answer.toLowerCase().includes("tied"));
    assert.ok(st.decision.direct_answer.includes("74.5%"));
    console.log("[PASS 2] Tie explicitly detected and reported for Atlas Freight & Cascade Transport at 74.5%.");
    passed++;
  }

  // TEST 3: Table spanning multiple pages (continuation without repeated header)
  {
    const up = await uploadPdfPages("Vendor_MultiPage_Continuation.pdf", [
      [
        "QUARTERLY CARRIER OTD REPORT",
        "Vendor Name | On-Time Delivery % | Notes",
        "Orion Freight | 95.0% | Meets SLA",
        "Pinnacle Haulers | 88.0% | Minor port delay"
      ].join("\n"),
      [
        "Summit Carriers | 76.5% | Multi-hub congestion",
        "Titan Logistics | 91.2% | Normal transit"
      ].join("\n")
    ]);

    const st = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(st.qa_result.status, "answered");
    assert.equal(st.qa_result.records_compared, 4, `Expected 4 records across 2 pages, got ${st.qa_result.records_compared}`);
    assert.equal(st.qa_result.records[0].vendor, "Summit Carriers");
    assert.equal(st.qa_result.records[0].value, 76.5);
    assert.equal(st.qa_result.records[0].page, 2);
    assert.deepEqual(st.qa_result.supporting_pages, [1, 2]);
    console.log("[PASS 3] Multi-page continuation table (no repeated header) extracted all 4 vendors across Pages 1-2; Summit Carriers (76.5%, Page 2) won.");
    passed++;
  }

  // TEST 4: Percentages written as "92%", "92.0 %", and "0.92"
  {
    const up = await uploadPdfPages("Vendor_Mixed_Number_Formats.pdf", [
      [
        "CARRIER OTD FORMAT NORMALIZATION",
        "Vendor | OTD | Audit Group",
        "Alpha Freight | 92% | Group A",
        "Beta Carriers | 92.0 % | Group B",
        "Gamma Transport | 0.92 | Group C",
        "Omega Trucking | 81% | Group D"
      ].join("\n")
    ]);

    const lowState = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(lowState.qa_result.status, "answered");
    assert.equal(lowState.qa_result.records_compared, 4);
    assert.equal(lowState.qa_result.records[0].vendor, "Omega Trucking");
    assert.equal(lowState.qa_result.records[0].value, 81);
    const gammaRec = lowState.qa_result.records.find((r: any) => r.vendor === "Gamma Transport");
    const betaRec = lowState.qa_result.records.find((r: any) => r.vendor === "Beta Carriers");
    assert.ok(gammaRec && gammaRec.value === 92 && gammaRec.raw_value === "0.92");
    assert.ok(betaRec && betaRec.value === 92 && betaRec.raw_value === "92.0 %");
    assert.equal(lowState.validation_result.validation_status, "PASSED");

    const highState = await queryDoc("Which vendor has the highest on-time delivery?", up.document_id);
    assert.deepEqual(highState.qa_result.ties.sort(), ["Alpha Freight", "Beta Carriers", "Gamma Transport"]);
    console.log('[PASS 4] Normalized "92%", "92.0 %", and "0.92" cleanly to 92.0% and passed Critic.');
    passed++;
  }

  // TEST 5: Metric column missing -> Rule 9 exact insufficient evidence (NO supplier list substitution)
  {
    const up = await uploadPdfPages("Suppliers_No_OTD_Metric.pdf", [
      [
        "APPROVED SUPPLIER DIRECTORY",
        "Vendor | Primary Warehouse | Contract Tier",
        "Northwind Supply | Chicago Hub | Tier 1",
        "Southbridge Parts | Dallas Hub | Tier 2",
        "Eastgate Components | Newark Hub | Tier 1"
      ].join("\n")
    ]);

    const st = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(st.qa_result?.status, "insufficient_evidence");
    assert.equal(st.decision.answer_type, "insufficient_evidence");
    assert.equal(st.decision.direct_answer, INSUFFICIENT_EVIDENCE_EXACT);
    assert.ok(!st.decision.direct_answer.includes("Northwind Supply"), "Must NOT substitute supplier directory!");
    assert.equal(st.validation_result.validation_status, "INSUFFICIENT_EVIDENCE");
    console.log("[PASS 5] Missing metric column returned exact Rule 9 string without substituting supplier list.");
    passed++;
  }

  // TEST 6: Question about content not in PDF -> exact Rule 9 insufficient evidence
  {
    const up = await uploadPdfPages("Financial_Only_Memo.pdf", [
      [
        "QUARTERLY TREASURY CASHFLOW NOTE",
        "Total cash on hand increased by 14% year-over-year due to lower debt servicing costs."
      ].join("\n")
    ]);

    const st = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(st.decision.answer_type, "insufficient_evidence");
    assert.equal(st.decision.direct_answer, INSUFFICIENT_EVIDENCE_EXACT);
    assert.equal(st.qa_result.status, "insufficient_evidence");
    console.log("[PASS 6] Question about unrelated content missing from PDF returned exact Rule 9 string.");
    passed++;
  }

  // TEST 7: Two PDFs uploaded -> strictly uses active document_id only + rejects missing doc_id
  {
    const docA = await uploadPdfPages("Active_Scope_PDF_A.pdf", [
      [
        "SUPPLIER OTD APPENDIX A",
        "Vendor | On-Time Rate",
        "LeakTest Alpha Carrier | 55.0%",
        "Standard Beta Carrier | 89.0%"
      ].join("\n")
    ]);
    const docB = await uploadPdfPages("Active_Scope_PDF_B.pdf", [
      [
        "SUPPLIER OTD APPENDIX B",
        "Vendor | On-Time Rate",
        "Kestrel Carriers | 84.0%",
        "Monarch Logistics | 93.5%"
      ].join("\n")
    ]);

    const stB = await queryDoc("Which vendor has the lowest on-time delivery?", docB.document_id);
    assert.equal(stB.active_document_id, docB.document_id);
    assert.equal(stB.qa_result.document_id, docB.document_id);
    assert.equal(stB.qa_result.records[0].vendor, "Kestrel Carriers");
    assert.ok(!JSON.stringify(stB).includes("LeakTest Alpha Carrier"), "Cross-document leak detected from Doc A into Doc B!");

    const noDocRes = await fetch(`${BASE_URL}/api/ai/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "Which vendor has the lowest on-time delivery?" })
    });
    assert.equal(noDocRes.status, 400, "Omitting active target_document_id must return HTTP 400, never fall back.");
    console.log("[PASS 7] Strict document_id scoping verified across two uploads; omitted document_id rejected 400.");
    passed++;
  }

  // TEST 8: Scanned page -> OCR path flagged "ocr" / "ocr-low-confidence", unparsed page listed
  {
    // Part A: Mixed PDF via real upload (Page 1 text table, Page 2 blank/scanned image page without text layer)
    const upMixed = await uploadPdfPages("Mixed_Text_And_Unparsed_Scanned.pdf", [
      [
        "VENDOR DELIVERY SUMMARY",
        "Vendor | On-Time Delivery %",
        "Redwood Express | 78.0%",
        "Sequoia Freight | 90.0%"
      ].join("\n"),
      "   " // Blank/image-only scanned page 2 with <15 chars
    ]);
    assert.deepEqual(upMixed.unparsed_pages, [2], "Mixed PDF upload must list blank Page 2 in unparsed_pages.");
    const stMixed = await queryDoc("Which vendor has the lowest on-time delivery?", upMixed.document_id);
    assert.equal(stMixed.qa_result.status, "answered");
    assert.deepEqual(stMixed.qa_result.unparsed_pages, [2]);
    assert.equal(stMixed.qa_result.records[0].vendor, "Redwood Express");

    // Part B: OCR-extracted page metadata flagged "ocr" -> confidence_label "ocr-low-confidence"
    const ocrUploadRes = await fetch(`${BASE_URL}/api/data/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "Scanned_Vendor_OCR_Test.pdf",
        type: "PDF",
        pages: [
          {
            page_num: 1,
            text: "Vendor | On-Time Delivery %\nOCR Carrier One | 79.5%\nOCR Carrier Two | 91.0%",
            raw_text: "Vendor | On-Time Delivery %\nOCR Carrier One | 79.5%\nOCR Carrier Two | 91.0%",
            extraction: "ocr",
            ocr_used: true
          },
          {
            page_num: 2,
            text: "",
            raw_text: "",
            extraction: "unparsed",
            ocr_used: false
          }
        ]
      })
    });
    const ocrUpJson = await ocrUploadRes.json();
    assert.equal(ocrUploadRes.status, 200);
    assert.deepEqual(ocrUpJson.unparsed_pages, [2]);
    const stOcr = await queryDoc("Which vendor has the lowest on-time delivery?", ocrUpJson.document_id);
    assert.equal(stOcr.qa_result.status, "answered");
    assert.equal(stOcr.qa_result.records[0].extraction, "ocr");
    assert.equal(stOcr.qa_result.records[0].confidence_label, "ocr-low-confidence");
    assert.deepEqual(stOcr.qa_result.unparsed_pages, [2]);
    console.log('[PASS 8] Scanned/unparsed pages tracked in unparsed_pages and OCR values flagged "ocr" / "ocr-low-confidence".');
    passed++;
  }

  // TEST 9: Summary, table, and citation consistency assertion
  {
    const up = await uploadPdfPages("Consistency_Assertion_Check.pdf", [
      [
        "CARRIER PERFORMANCE AUDIT",
        "Vendor | On-Time Delivery %",
        "Falcon Freight | 69.8%",
        "Gryphon Logistics | 88.5%",
        "Phoenix Transport | 94.1%"
      ].join("\n")
    ]);
    const st = await queryDoc("Which vendor has the lowest on-time delivery?", up.document_id);
    assert.equal(st.qa_result.consistency_verified, true);
    const liveCheck = assertVerifiedResultConsistency(
      st.qa_result,
      st.decision.table_data.rows,
      st.evidence_package.source_citations
    );
    assert.equal(liveCheck.ok, true, `Consistency check failed: ${liveCheck.errors.join("; ")}`);

    // Verify assertion CATCHES an intentionally mismatched summary vs table
    const corrupted = { ...st.qa_result, answer: "WrongVendor has lowest on-time delivery at 10.0%" };
    const failCheck = assertVerifiedResultConsistency(
      corrupted,
      st.decision.table_data.rows,
      st.evidence_package.source_citations
    );
    assert.equal(failCheck.ok, false, "Assertion MUST catch summary/table mismatch!");
    console.log("[PASS 9] Single Source of Truth assertion verified both positive alignment and mismatch detection.");
    passed++;
  }

  // TEST 10: Vendor row not in PDF (memory / hallucination verification gate test) -> must NOT appear
  {
    const doc = buildIndexedDocument({
      id: 9991,
      title: "Verification_Gate_Strict.pdf",
      doc_type: "PDF",
      storage_path: "/tmp/gate.pdf",
      content: "Vendor | On-Time Delivery %\nReal Carrier East | 82.0%\nReal Carrier West | 91.5%",
      pages: [
        {
          page_num: 1,
          text: "Vendor | On-Time Delivery %\nReal Carrier East | 82.0%\nReal Carrier West | 91.5%",
          raw_text: "Vendor | On-Time Delivery %\nReal Carrier East | 82.0%\nReal Carrier West | 91.5%",
          extraction: "text",
          ocr_used: false
        }
      ]
    });

    const intent = parseQuestionIntent("Which vendor has the lowest on-time delivery?");
    // Inject a phantom unverified record pretending to come from outside memory / wrong page
    const gateRes = runVendorMetricQA(doc, "Which vendor has the lowest on-time delivery?", intent, [
      {
        vendor: "Hallucinated Memory Express",
        value: 12.0,
        raw_value: "12.0%",
        unit: "%",
        page: 1,
        evidence: "Hallucinated Memory Express | 12.0%",
        extraction: "text"
      }
    ]);

    assert.equal(gateRes.records.some((r) => r.vendor.includes("Hallucinated")), false, "Phantom vendor leaked past Verification Gate!");
    assert.equal((gateRes.dropped_unverified || []).length, 1);
    assert.equal(gateRes.dropped_unverified![0].vendor, "Hallucinated Memory Express");
    assert.equal(gateRes.records[0].vendor, "Real Carrier East");
    assert.ok(!gateRes.answer.includes("Hallucinated"));
    console.log("[PASS 10] Verification Gate dropped phantom out-of-PDF vendor candidate; only verbatim-verified rows appeared.");
    passed++;
  }

  console.log("\n================================================================================");
  console.log(`ALL ${passed}/10 DOCUMENT-GROUNDED Q&A & VERIFICATION TESTS PASSED.`);
  console.log("================================================================================");
}

run().catch((err) => {
  console.error("TEST SUITE FAILED:", err);
  process.exit(1);
});
