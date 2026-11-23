// tests/run_all_7_tests.js
// Automated End-to-End Test Suite for All 7 Mandatory Grounding & Document Isolation Tests

async function runTests() {
  console.log("================================================================================");
  console.log("RUNNING MANDATORY END-TO-END TEST SUITE (TESTS 1 THROUGH 7)");
  console.log("================================================================================\n");

  const baseUrl = "http://localhost:3000";
  let testsPassed = 0;
  let testsTotal = 7;

  // Helper to query and consume SSE stream
  async function queryAndGetFinalState(question, targetDocId) {
    const qRes = await fetch(`${baseUrl}/api/ai/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, target_document_id: targetDocId })
    });
    const { session_id } = await qRes.json();

    const streamRes = await fetch(`${baseUrl}/api/ai/query/${session_id}/stream`);
    const streamText = await streamRes.text();

    const lines = streamText.split("\n");
    let finalState = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "event: complete" && lines[i + 1]?.startsWith("data: ")) {
        try {
          const payload = JSON.parse(lines[i + 1].replace("data: ", ""));
          finalState = payload.state;
          break;
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      }
    }
    return finalState;
  }

  // --- TEST 1 ---
  console.log("--------------------------------------------------------------------------------");
  console.log("TEST 1: Extract all meeting action items with owners and deadlines.");
  console.log("--------------------------------------------------------------------------------");
  const state1 = await queryAndGetFinalState("Extract all meeting action items with owners and deadlines.", 201);
  const t1Rows = state1?.decision?.table_data?.rows || [];
  console.log("Table Data Rows Count:", t1Rows.length);
  console.log("Extracted Rows:\n", JSON.stringify(t1Rows, null, 2));
  console.log("Source Citation:", state1?.decision?.source_citation);

  const t1HasAll4 = t1Rows.length === 4 &&
    t1Rows.some(r => r[0].includes("Head of Logistics") && r[2].includes("6 Nov 2026")) &&
    t1Rows.some(r => r[0].includes("Procurement Lead") && r[2].includes("9 Nov 2026")) &&
    t1Rows.some(r => r[0].includes("Warehouse Manager") && r[2].includes("4 Nov 2026")) &&
    t1Rows.some(r => r[0].includes("Finance Controller") && r[2].includes("11 Nov 2026"));

  if (t1HasAll4) {
    console.log(">>> TEST 1 PASSED: Exactly 4 action items extracted with correct owners and deadlines.");
    testsPassed++;
  } else {
    console.error(">>> TEST 1 FAILED!");
  }

  // --- TEST 2 ---
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 2: Identify the logistics delay root causes.");
  console.log("--------------------------------------------------------------------------------");
  const state2 = await queryAndGetFinalState("Identify the logistics delay root causes.", 201);
  const t2Bullets = state2?.decision?.bullet_points || [];
  console.log("Root Causes Count:", t2Bullets.length);
  console.log("Documented Root Causes:\n", JSON.stringify(t2Bullets, null, 2));
  console.log("Recommendations (Separated):\n", state2?.decision?.recommendation);
  console.log("Source Citation:", state2?.decision?.source_citation);

  const t2HasAll3 = t2Bullets.length === 3 &&
    t2Bullets.some(b => b.toLowerCase().includes("cross-dock capacity planning failure")) &&
    t2Bullets.some(b => b.toLowerCase().includes("missing automated shipment exception alerts")) &&
    t2Bullets.some(b => b.toLowerCase().includes("unclear carrier escalation ownership"));

  if (t2HasAll3) {
    console.log(">>> TEST 2 PASSED: Exactly 3 documented root causes correctly identified and recommendations separated.");
    testsPassed++;
  } else {
    console.error(">>> TEST 2 FAILED!");
  }

  // --- TEST 3 ---
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 3: Which region generated the highest operating profit in September?");
  console.log("--------------------------------------------------------------------------------");
  const state3 = await queryAndGetFinalState("Which region generated the highest operating profit in September?", 201);
  const t3Table = state3?.decision?.table_data;
  console.log("Table Rows:\n", JSON.stringify(t3Table?.rows, null, 2));
  console.log("Conclusion:", state3?.decision?.conclusion);

  const t3HasEqualNorthSouth = 
    state3?.decision?.conclusion?.toLowerCase().includes("north and south") &&
    state3?.decision?.conclusion?.includes("413,000") &&
    (state3?.decision?.conclusion?.toLowerCase().includes("equal") || state3?.decision?.conclusion?.toLowerCase().includes("tied"));

  if (t3HasEqualNorthSouth) {
    console.log(">>> TEST 3 PASSED: Correctly identified North and South both generated INR 413,000 equal operating profit.");
    testsPassed++;
  } else {
    console.error(">>> TEST 3 FAILED!");
  }

  // --- TEST 4 ---
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 4: Which inventory items are below their reorder point?");
  console.log("--------------------------------------------------------------------------------");
  const state4 = await queryAndGetFinalState("Which inventory items are below their reorder point?", 201);
  const t4Rows = state4?.decision?.table_data?.rows || [];
  console.log("Table Rows (Below Reorder Point):\n", JSON.stringify(t4Rows, null, 2));
  console.log("Conclusion:", state4?.decision?.conclusion);

  const t4HasSkus = t4Rows.length === 3 &&
    t4Rows.some(r => r[0] === "SKU-001" && r[5].includes("BELOW REORDER POINT")) &&
    t4Rows.some(r => r[0] === "SKU-003" && r[5].includes("BELOW REORDER POINT")) &&
    t4Rows.some(r => r[0] === "SKU-005" && r[5].includes("BELOW REORDER POINT")) &&
    !t4Rows.some(r => r[0] === "SKU-002" || r[0] === "SKU-004");

  if (t4HasSkus) {
    console.log(">>> TEST 4 PASSED: Exactly SKU-001, SKU-003, and SKU-005 identified below reorder point; SKU-002 and SKU-004 distinguished.");
    testsPassed++;
  } else {
    console.error(">>> TEST 4 FAILED!");
  }

  // --- TEST 5 ---
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 5: Query-to-Retrieval Alignment: What are the suppliers and vendors mentioned in the document and what are their performance metrics?");
  console.log("--------------------------------------------------------------------------------");
  const state5 = await queryAndGetFinalState("What are the suppliers and vendors mentioned in the document and what are their performance metrics?", 201);
  console.log("Retrieved Chunks Pages:", state5?.doc_evidence?.chunks?.map(c => `[Page ${c.page_number}] ${c.section_title}`));
  console.log("SQL Query Executed:", state5?.sql_evidence?.query);
  console.log("SQL Rows Count:", state5?.sql_evidence?.rows?.length);
  console.log("Vendor Findings Table:\n", JSON.stringify(state5?.decision?.table_data?.rows, null, 2));
  console.log("Identified Issues:\n", JSON.stringify(state5?.decision?.bullet_points, null, 2));
  console.log("Critic Feedback:", state5?.validation_result?.feedback);

  const t5RetrievedVendorAudit = state5?.doc_evidence?.chunks?.some(c => c.page_number === 5 || c.section_title?.includes("Vendor"));
  const t5ExcludedMeetingItems = !state5?.doc_evidence?.chunks?.some(c => c.page_number === 1 || c.section_title?.includes("Meeting"));
  const t5HasCarriers = state5?.decision?.table_data?.rows?.some(r => r[0].includes("Acme") && r[1].includes("71.4%")) &&
    state5?.decision?.table_data?.rows?.some(r => r[0].includes("Delta") && r[1].includes("68.2%")) &&
    state5?.decision?.table_data?.rows?.some(r => r[0].includes("Global") && r[1].includes("79.5%"));
  const t5SqlTableCorrect = state5?.sql_evidence?.query?.includes("vendor_performance");

  if (t5RetrievedVendorAudit && t5ExcludedMeetingItems && t5HasCarriers && t5SqlTableCorrect) {
    console.log(">>> TEST 5 PASSED: Strict query-to-retrieval alignment enforced! Vendor audit chunks retrieved, meeting action items strictly excluded, and verified carrier metrics extracted.");
    testsPassed++;
  } else {
    console.error(">>> TEST 5 FAILED! Details:", { t5RetrievedVendorAudit, t5ExcludedMeetingItems, t5HasCarriers, t5SqlTableCorrect });
  }

  // --- TEST 6 ---
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 6: Analyze Product X sales decline in Region A. (Document Isolation Check)");
  console.log("--------------------------------------------------------------------------------");
  const state6 = await queryAndGetFinalState("Analyze Product X sales decline in Region A.", 201);
  console.log("Answer Type:", state6?.decision?.answer_type);
  console.log("Insufficient Evidence Reason:", state6?.decision?.insufficient_evidence_reason);
  console.log("Conclusion:", state6?.decision?.conclusion);
  console.log("Critic Feedback:", state6?.validation_result?.feedback);

  const t6Passed = state6?.decision?.answer_type === "insufficient_evidence" &&
    state6?.decision?.insufficient_evidence_reason?.includes("NOT available in the selected document") &&
    state6?.sql_evidence?.rows?.length === 0;

  if (t6Passed) {
    console.log(">>> TEST 6 PASSED: Correctly identified that Product X is not in sample supply chain doc. Zero cross-document leakage!");
    testsPassed++;
  } else {
    console.error(">>> TEST 6 FAILED!");
  }

  // --- TEST 7 ---
  console.log("\n--------------------------------------------------------------------------------");
  console.log("TEST 7: Upload a second unrelated PDF and select it as Active Target.");
  console.log("--------------------------------------------------------------------------------");
  // Upload second document
  const uploadRes = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "Biotech_Clinical_Trials_Phase3_Audit.pdf",
      type: "PDF",
      content: `CLINICAL TRIAL SUMMARY REPORT
Protocol: BIO-8899 Phase 3 Oncology Study
Primary Endpoint: Progression-Free Survival increased by 4.2 months in Cohort B.
Adverse Events: Grade 3 neutropenia observed in 6.4% of participants.
Trial Recommendation: Advance candidate to FDA Fast-Track Biologics License Application filing.`
    })
  });
  const uploadJson = await uploadRes.json();
  const secondDocId = uploadJson.document_id;
  console.log(`Uploaded Second PDF ID #${secondDocId}: "${uploadJson.title}"`);

  // Query second document
  const state7 = await queryAndGetFinalState("What were the trial endpoints and adverse events in Phase 3 study?", secondDocId);
  console.log("State 7 Grounded Title:", state7?.decision?.source_document_title);
  console.log("State 7 Root Cause / Finding:", state7?.decision?.root_cause);
  console.log("State 7 Retrieved Chunks:", state7?.doc_evidence?.chunks?.map(c => `[Doc #${c.document_id}] ${c.title}`));

  const t7OnlyFromSecondDoc = state7?.doc_evidence?.chunks?.every(c => c.document_id === secondDocId) &&
    state7?.decision?.source_document_title?.includes("Biotech_Clinical_Trials") &&
    state7?.decision?.root_cause?.includes("BIO-8899");

  if (t7OnlyFromSecondDoc) {
    console.log(">>> TEST 7 PASSED: 100% of evidence came from the second PDF. Zero contamination from previous PDFs!");
    testsPassed++;
  } else {
    console.error(">>> TEST 7 FAILED!");
  }

  console.log("\n================================================================================");
  console.log(`TEST SUITE RESULTS: ${testsPassed} OF ${testsTotal} TESTS PASSED.`);
  console.log("================================================================================");
}

runTests().catch(console.error);
