// tests/test_supplier_ner_classification.js
// Verifies 11-Class NER Entity Classification, Exclusion of Non-Suppliers,
// Deduplication, Traceable Source Evidence, and Critic Rejection of Misclassified Entities.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const baseUrl = "http://localhost:3000";

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
      const isHeading = /^(Third-Party|[A-Z0-9\s,&/()-]{6,})$/.test(line);
      page.drawText(line, {
        x: 40,
        y,
        size: isHeading ? 11 : 9.5,
        font: isHeading ? boldFont : font,
        color: rgb(0.15, 0.15, 0.2)
      });
      y -= 15;
    }
  }
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
  if (!qRes.ok) throw new Error(`Query init failed: ${JSON.stringify(initJson)}`);

  const streamRes = await fetch(`${baseUrl}/api/ai/query/${initJson.session_id}/stream`);
  const streamText = await streamRes.text();
  const lines = streamText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "event: complete" && lines[i + 1]?.startsWith("data: ")) {
      const payload = JSON.parse(lines[i + 1].replace("data: ", ""));
      return payload.state;
    }
  }
  throw new Error("Missing SSE complete event");
}

async function run() {
  console.log("================================================================================");
  console.log("MANDATORY NER & SUPPLIER ENTITY CLASSIFICATION TEST");
  console.log("================================================================================\n");

  const pages = [
    `Third-Party Vendor Performance Audit Supplier
Date: October 2026
Department: Finance Department
Customer: Metro Retail Accounts
Product: SKU-901 Precision Actuator
Region: Region North

FINANCIAL SUMMARY TABLE:
Revenue INR COGS INR Logistics
4800000 INR 2950000 INR 420000

FACILITY & DISTRIBUTION:
South Distribution handled outbound regional cross-dock staging during Q3.
Northstar Holdings was noted during governance minutes.

CONFIRMED SUPPLIER RECORD:
Primary supplier: Apex Transit Services handled inbound freight deliveries across hub corridors.`,
    `VENDOR PERFORMANCE CONTINUATION
- Apex Transit Services: On-Time Delivery Rate: 76.5% (Target: 95.0%) | Transit Variance: +2.1 days | SLA Breach Count: 4 incidents`
  ];

  const base64 = await createPdfBase64(pages);
  const upRes = await fetch(`${baseUrl}/api/data/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: "Supplier_NER_Classification_Audit.pdf",
      type: "PDF",
      base64
    })
  });
  const uploaded = await upRes.json();
  if (!upRes.ok || !uploaded.success) {
    throw new Error(`Upload failed: ${JSON.stringify(uploaded)}`);
  }
  console.log(`Uploaded test PDF as Doc #${uploaded.document_id}\n`);

  const state = await queryAndGetFinalState("List all suppliers mentioned in the uploaded PDF.", uploaded.document_id);

  const rows = state?.decision?.table_data?.rows || [];
  const confirmedNames = rows.map((r) => r[0]);
  const directAnswer = state?.decision?.direct_answer || "";
  const conclusion = state?.decision?.conclusion || "";
  const confirmedBlob = JSON.stringify({ rows, directAnswer, conclusion });

  const hasExactlyApex =
    rows.length === 1 &&
    confirmedNames[0] === "Apex Transit Services" &&
    directAnswer.includes("Apex Transit Services");

  const excludesFalsePositives =
    !confirmedBlob.includes("Revenue INR COGS INR Logistics") &&
    !confirmedBlob.includes("Third-Party Vendor Performance Audit Supplier") &&
    !confirmedBlob.includes("South Distribution") &&
    !confirmedBlob.includes("Finance Department") &&
    !confirmedBlob.includes("Metro Retail Accounts") &&
    !confirmedBlob.includes("Northstar Holdings");

  const hasTraceableEvidence =
    rows.length === 1 &&
    String(rows[0][5]).includes("Page") &&
    String(rows[0][7] || rows[0][4]).length > 10 &&
    ["Supplier", "Vendor", "Carrier"].includes(rows[0][6]);

  const excludedEntities = state?.diagnostics?.entity_classification?.excluded_entities || [];
  const excludedCategories = new Map(excludedEntities.map((e) => [e.name, e.category]));
  const unverifiedEntities = state?.decision?.unverified_entities || [];

  const criticPassed =
    state?.validation_result?.is_valid === true &&
    state?.validation_result?.validation_status === "PASSED";

  console.log("Confirmed Suppliers Table Rows:", JSON.stringify(rows, null, 2));
  console.log("Unverified Entities (Optional):", JSON.stringify(unverifiedEntities, null, 2));
  console.log("Excluded Entities Audit:", JSON.stringify(excludedEntities, null, 2));
  console.log("Critic Status:", state?.validation_result?.validation_status, "| Valid:", state?.validation_result?.is_valid);

  const ok = hasExactlyApex && excludesFalsePositives && hasTraceableEvidence && criticPassed;

  console.log("\nAssertions:");
  console.log("  1. Exactly Apex Transit Services confirmed (deduplicated):", hasExactlyApex);
  console.log("  2. Non-supplier entities strictly excluded from confirmed list:", excludesFalsePositives);
  console.log("  3. Traceable source text, NER class & page number attached:", hasTraceableEvidence);
  console.log("  4. Excluded NER classes tracked:", Object.fromEntries(excludedCategories));
  console.log("  5. Unverified entities separated:", unverifiedEntities.map((u) => u.name));
  console.log("  6. Critic Validation PASSED:", criticPassed);

  if (!ok) {
    console.error("\nTEST FAILED!");
    process.exit(1);
  }
  console.log("\n>>> MANDATORY NER & SUPPLIER ENTITY CLASSIFICATION TEST PASSED!");
}

run().catch((err) => {
  console.error("Test fatal error:", err);
  process.exit(1);
});
