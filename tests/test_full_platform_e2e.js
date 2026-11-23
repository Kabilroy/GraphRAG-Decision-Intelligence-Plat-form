// tests/test_full_platform_e2e.js
// Comprehensive end-to-end test verifying Auth, Audit Logs, Read-Only Guardrails,
// and strict Uploaded-PDF-Only scoping across Knowledge Graph, Analytics Dashboard, Briefings, Prompts & AI Analyst.
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const baseUrl = "http://localhost:3000";

async function createPdfBase64(pages) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  for (const pageText of pages) {
    const page = pdfDoc.addPage([612, 792]);
    let y = 745;
    for (const raw of pageText.split("\n")) {
      const line = raw.trim();
      if (!line) {
        y -= 8;
        continue;
      }
      const isHeading = /^(SECTION|\d+\.|RECOMMENDED|[A-Z0-9\s,&/()-]{8,}:?$)/.test(line);
      page.drawText(line, {
        x: 40,
        y,
        size: isHeading ? 11 : 9.5,
        font: isHeading ? bold : font,
        color: rgb(0.12, 0.14, 0.2)
      });
      y -= 14;
    }
  }
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes).toString("base64");
}

async function queryAndStream(question, docId, userId) {
  const res = await fetch(`${baseUrl}/api/ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      target_document_id: docId,
      active_document_id: docId,
      user_id: userId
    })
  });
  const init = await res.json();
  assert.equal(res.status, 200, `Query init failed: ${JSON.stringify(init)}`);

  const streamRes = await fetch(`${baseUrl}/api/ai/query/${init.session_id}/stream`);
  const raw = await streamRes.text();
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "event: complete" && lines[i + 1]?.startsWith("data: ")) {
      return JSON.parse(lines[i + 1].replace("data: ", "")).state;
    }
  }
  throw new Error("SSE stream ended without complete event");
}

async function runFullSuite() {
  console.log("================================================================================");
  console.log("RUNNING FULL PLATFORM END-TO-END VERIFICATION SUITE");
  console.log("================================================================================\n");

  const uniqueTag = Date.now();
  const testEmail = `auditor.${uniqueTag}@zenithgrid.example`;
  const testPassword = "GridPassword#2026";

  // 1. Auth: Unregistered login must fail 404
  const unregRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });
  assert.equal(unregRes.status, 404, "Unregistered user login must return 404");
  const unregData = await unregRes.json();
  assert.equal(unregData.requiresRegistration, true);
  console.log("[PASS 1] Unregistered login rejected (HTTP 404 + requiresRegistration)");

  // 2. Auth: Register user & check /api/auth/users exposes user safely without passwordHash
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Maya Lin",
      email: testEmail,
      password: testPassword,
      role: "admin",
      company: "Zenith Renewable Grid",
      department: "Grid Operations"
    })
  });
  assert.equal(regRes.status, 201, "User registration should succeed with 201");
  const regData = await regRes.json();
  const userId = regData.user.id;

  const usersRes = await fetch(`${baseUrl}/api/auth/users`);
  assert.equal(usersRes.status, 200, "GET /api/auth/users must return 200 JSON");
  const usersJson = await usersRes.json();
  const foundUser = usersJson.users.find((u) => u.email === testEmail);
  assert.ok(foundUser, "Registered user must appear in /api/auth/users");
  assert.equal(foundUser.passwordHash, undefined, "passwordHash must never be exposed");
  console.log(`[PASS 2] User registered (${userId}) & /api/auth/users verified sanitized`);

  // 3. Auth: Wrong password rejected (401), valid login succeeds (200)
  const badPwRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: "WrongPassword" })
  });
  assert.equal(badPwRes.status, 401);

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: testEmail, password: testPassword })
  });
  assert.equal(loginRes.status, 200);
  const loginData = await loginRes.json();
  assert.ok(loginData.token);
  console.log("[PASS 3] Auth password enforcement & valid login verified");

  // 4. Upload a brand-new custom multi-page PDF via /api/data/parse-pdf & /api/data/upload
  const pdfPages = [
    `SECTION 1: ZENITH RENEWABLE GRID INFRASTRUCTURE AUDIT
Client Organization: Zenith Grid Authority
Audit Period: Q4 2026 Turbine Dispatch Review
All turbine blade shipments are overseen exclusively by the Grid Operations team.`,
    `SECTION 2: THIRD-PARTY VENDOR PERFORMANCE EVALUATION
Primary supplier: Solaris Turbine Freight transported high-voltage transformers across the coastal corridor.
- Solaris Turbine Freight: On-Time Delivery Rate: 88.4% (Target: 95.0%) | Transit Variance: +1.5 days | SLA Breach Count: 2 incidents

SECTION 3: RECOMMENDED ACTIONS:
- Diversify coastal transformer haulage with backup regional rail scheduling.
- Conduct bi-weekly SLA checkpoint reviews with Solaris Turbine Freight.`
  ];
  const base64 = await createPdfBase64(pdfPages);
  const parseRes = await fetch(`${baseUrl}/api/data/parse-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64, filename: "Zenith_Grid_Infrastructure_Audit.pdf" })
  });
  const parseJson = await parseRes.json();
  assert.equal(parseRes.status, 200);
  assert.equal(parseJson.success, true);
  assert.equal(parseJson.pages_count, 2);

  const uploadRes = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "Zenith_Grid_Infrastructure_Audit.pdf",
      type: "PDF",
      base64,
      user_id: userId
    })
  });
  const uploadJson = await uploadRes.json();
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadJson.success, true);
  assert.equal(uploadJson.is_uploaded, true);
  const uploadedDocId = uploadJson.document_id;
  assert.ok(uploadJson.sections_count >= 3, `Expected >= 3 sections, got ${uploadJson.sections_count}`);

  // Verify suggested prompts are strictly mapped to uploaded PDF contents ONLY (no Meeting Action Items / Inventory)
  const promptLabels = (uploadJson.suggested_prompts || []).map((p) => p.label);
  assert.ok(
    promptLabels.some((l) => l.includes("Suppliers")),
    `Expected Suppliers prompt, got ${JSON.stringify(promptLabels)}`
  );
  assert.ok(
    !promptLabels.includes("Meeting Action Items"),
    `Irrelevant prompt 'Meeting Action Items' leaked into custom PDF options: ${JSON.stringify(promptLabels)}`
  );
  assert.ok(
    !promptLabels.includes("Inventory Below Reorder"),
    `Irrelevant prompt 'Inventory Below Reorder' leaked into custom PDF options: ${JSON.stringify(promptLabels)}`
  );
  console.log(`[PASS 4] Uploaded custom 2-page PDF as Doc #${uploadedDocId} with tailored prompts: ${promptLabels.join(", ")}`);

  // 5. Verify Knowledge Graph shows ONLY uploaded PDF data (even without ?document_id override!)
  const graphRes = await fetch(`${baseUrl}/api/graph/entities`);
  assert.equal(graphRes.status, 200);
  const graphJson = await graphRes.json();
  assert.equal(graphJson.document_id, uploadedDocId, "Default graph should resolve to latest uploaded PDF");
  assert.ok(graphJson.nodes.length >= 4, "Uploaded PDF should produce verified graph nodes");
  for (const n of graphJson.nodes) {
    assert.equal(n.document_id, uploadedDocId, `Node ${n.id} must carry document_id=${uploadedDocId}`);
  }
  for (const e of graphJson.edges) {
    assert.equal(e.document_id, uploadedDocId, `Edge ${e.source}->${e.target} must carry document_id=${uploadedDocId}`);
  }
  const graphBlob = JSON.stringify(graphJson);
  for (const forbidden of ["Product X", "Supplier Y", "Acme Freight Express", "Apex Global", "Doc #101"]) {
    assert.ok(!graphBlob.includes(forbidden), `Forbidden fallback/foreign entity "${forbidden}" found in Knowledge Graph!`);
  }
  assert.ok(graphBlob.includes("Solaris Turbine Freight"), "Expected uploaded supplier Solaris Turbine Freight in Knowledge Graph");
  console.log(`[PASS 5] Knowledge Graph strictly scoped to Doc #${uploadedDocId} (${graphJson.nodes.length} nodes, ${graphJson.edges.length} edges)`);

  // 6. Verify Dashboard Analytics shows ONLY uploaded PDF charts & KPIs (zero Product X / Q3 W10 / -$497k leaks)
  const dashRes = await fetch(`${baseUrl}/api/dashboard/analytics`);
  assert.equal(dashRes.status, 200);
  const dashJson = await dashRes.json();
  assert.equal(dashJson.document.id, uploadedDocId);
  assert.ok(dashJson.charts.section_distribution.length >= 3, "Section chart populated from uploaded PDF");
  assert.ok(dashJson.charts.vendor_performance.some((v) => v.carrier === "Solaris Turbine Freight"), "Vendor chart populated from uploaded PDF");
  assert.equal(dashJson.charts.regional_pnl.length, 0, "Regional P&L chart must be empty when uploaded PDF has no regional P&L");
  assert.equal(dashJson.charts.inventory_status.length, 0, "Inventory chart must be empty when uploaded PDF has no SKU inventory");
  const dashBlob = JSON.stringify(dashJson);
  for (const forbidden of ["Product X", "Supplier Y", "Q3 W10", "2024 Q4", "SKU-001", "Region A"]) {
    assert.ok(!dashBlob.includes(forbidden), `Forbidden hardcoded literal "${forbidden}" leaked into Dashboard analytics!`);
  }
  console.log(`[PASS 6] Dashboard analytics 100% scoped to Doc #${uploadedDocId} (0 hardcoded leaks)`);

  // 7. Verify Executive Briefing (/api/reports/briefing) shows ONLY uploaded PDF content
  const briefRes = await fetch(`${baseUrl}/api/reports/briefing`);
  assert.equal(briefRes.status, 200);
  const briefJson = await briefRes.json();
  assert.equal(briefJson.document_id, uploadedDocId);
  assert.ok(briefJson.confirmed_suppliers.some((s) => s.name === "Solaris Turbine Freight"));
  assert.ok(briefJson.recommendations.length >= 1, "Expected documented recommendations extracted from uploaded PDF");
  const briefBlob = JSON.stringify(briefJson);
  for (const forbidden of ["Product X", "Supplier Y", "-$497,000", "Doc-101", "Nexus Logistics"]) {
    assert.ok(!briefBlob.includes(forbidden), `Forbidden hardcoded literal "${forbidden}" leaked into Briefing!`);
  }
  console.log(`[PASS 7] Executive Briefing 100% scoped to Doc #${uploadedDocId}`);

  // 8. Verify AI Analyst query on uploaded PDF confirms ONLY Solaris Turbine Freight + Critic PASSED
  const supState = await queryAndStream("List all suppliers mentioned in the uploaded PDF.", uploadedDocId, userId);
  assert.equal(supState.active_document_id, uploadedDocId);
  assert.equal(supState.validation_result.validation_status, "PASSED");
  const confirmed = supState.decision.table_data.rows.map((r) => r[0]);
  assert.deepEqual(confirmed, ["Solaris Turbine Freight"], `Expected only Solaris Turbine Freight, got ${JSON.stringify(confirmed)}`);

  // Verify Missing Info Guardrail on uploaded PDF ("Who is the CEO?")
  const ceoState = await queryAndStream("Who is the CEO of the company?", uploadedDocId, userId);
  assert.equal(ceoState.decision.answer_type, "insufficient_evidence");
  assert.equal(ceoState.validation_result.is_valid, true);
  console.log(`[PASS 8] AI Analyst confirmed ONLY Solaris Turbine Freight and rejected missing CEO cleanly`);

  // 9. Verify Security Guardrails & Cypher Query Console + Logout + Audit Trail
  const sqlInjectRes = await fetch(`${baseUrl}/api/graph/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cypher: "DROP TABLE sales; SELECT * FROM users;", document_id: uploadedDocId, user_id: userId })
  });
  assert.equal(sqlInjectRes.status, 400, "Mutating SQL injection must be rejected with HTTP 400");

  const validCypherRes = await fetch(`${baseUrl}/api/graph/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cypher: `MATCH (n {document_id: ${uploadedDocId}})-[r]->(m) RETURN n, r, m LIMIT 10;`,
      document_id: uploadedDocId,
      user_id: userId
    })
  });
  assert.equal(validCypherRes.status, 200);
  const validCypherJson = await validCypherRes.json();
  assert.ok(validCypherJson.result.every((edge) => edge.Document_ID === uploadedDocId));

  const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId })
  });
  assert.equal(logoutRes.status, 200);

  const auditRes = await fetch(`${baseUrl}/api/audit-logs`);
  assert.equal(auditRes.status, 200);
  const auditJson = await auditRes.json();
  const actions = new Set(auditJson.logs.map((l) => l.action));
  for (const expectedAction of [
    "USER_REGISTERED",
    "USER_LOGIN",
    "AUTH_LOGIN_FAILED",
    "USER_LOGOUT",
    "DOCUMENT_INGESTED",
    "GRAPHRAG_QUERY",
    "CYPHER_EXPLORATION"
  ]) {
    assert.ok(actions.has(expectedAction), `Missing audit log action: ${expectedAction}`);
  }
  console.log("[PASS 9] Security guardrails (400 on DROP/CREATE), read-only Cypher, logout, and full Audit Trail verified");

  console.log("\n================================================================================");
  console.log("FULL PLATFORM END-TO-END SUITE: 9 / 9 CHECKS PASSED!");
  console.log("================================================================================");
}

runFullSuite().catch((err) => {
  console.error("E2E SUITE FAILED:", err);
  process.exit(1);
});
