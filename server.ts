import crypto from "crypto";
import fs from "fs";
import express, { Request, Response, NextFunction } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

import {
  DemoDocument
} from "./server_engine/types";
import {
  buildIndexedDocument,
  extractExcelBuffer,
  extractPdfBuffer,
  PdfPageInput
} from "./server_engine/ingestion";
import {
  classifyUserQuery,
  hybridRetrieveChunks
} from "./server_engine/retrieval";
import {
  buildAnalyticsResult,
  buildEvidencePackage,
  executeDocumentGraphAgent,
  executeDocumentSQLAgent,
  synthesizeEvidenceFirstDecision,
  validateReadOnlyCypher
} from "./server_engine/agents";
import {
  buildInvestigationDiagnostics,
  runCriticValidationAgent
} from "./server_engine/critic";
import {
  buildDocumentBriefing,
  buildDocumentDashboardAnalytics,
  buildSuggestedPromptsForDocument
} from "./server_engine/analytics";
import { executeReadOnlyCypherQuery } from "./server_engine/cypher";

dotenv.config();

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err && (err instanceof SyntaxError || err.type === "entity.parse.failed")) {
    return res.status(400).json({ error: "Malformed JSON request payload." });
  }
  return next(err);
});

export interface AnalysisSession {
  id: string;
  investigation_id: string;
  user_id: string;
  question: string;
  target_document_id?: number;
  status: "PLANNING" | "RETRIEVING" | "ANALYZING" | "COMPLETED" | "FAILED";
  created_at: string;
  state: any;
}

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: "admin" | "analyst" | "viewer";
  company: string;
  department: string;
  created_at: string;
}

// In-Memory Global Stores
let idSeq = 1000;
function nextUniqueId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now()}-${idSeq}-${crypto.randomUUID().slice(0, 4)}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

const dbSessions: Map<string, AnalysisSession> = new Map();
const formatAuditTimestamp = () => new Date().toISOString().replace("T", " ").substring(0, 19);
const dbAuditLogs: Array<{
  id: string;
  correlation_id?: string;
  user_id: string;
  action: string;
  entity: string;
  entity_id: string;
  outcome?: "success" | "denied";
  created_at: string;
}> = [
  {
    id: "log-101",
    correlation_id: "corr-seed-201",
    user_id: "system",
    action: "SYSTEM_INDEX_SEED",
    entity: "Document",
    entity_id: "doc-201",
    outcome: "success",
    created_at: formatAuditTimestamp()
  }
];
const dbUsers: Map<string, StoredUser> = new Map();
const dbTokens: Map<string, string> = new Map(); // token -> normalizedEmail

const dbDataSources: Array<{
  id: string;
  document_id?: number;
  name: string;
  type: string;
  status: string;
  row_count: number;
  upload_date: string;
  source_version?: string;
  is_uploaded?: boolean;
  is_active?: boolean;
}> = [
  { id: "ds-01", document_id: 201, name: "sample_supply_chain_documents_complete.pdf", type: "PDF", status: "INDEXED", row_count: 5, upload_date: "2026-10-28", is_uploaded: false, is_active: true },
  { id: "ds-02", document_id: 101, name: "Q3 Supply Chain Performance & Supplier Y Operational Delays Report", type: "PDF", status: "INDEXED", row_count: 3, upload_date: "2026-08-10", is_uploaded: false, is_active: true }
];

const dbDocuments: DemoDocument[] = [];

/**
 * Seeds initial sample documents by running them through the exact same
 * real PDF/text extraction, chunking, SQL schema extraction, and GraphRAG indexer.
 */
async function seedInitialDocuments() {
  const samplePdfPath = path.join(process.cwd(), "public", "sample_supply_chain_documents_complete.pdf");
  if (fs.existsSync(samplePdfPath)) {
    const pdfBuf = fs.readFileSync(samplePdfPath);
    const parsed = await extractPdfBuffer(pdfBuf, "sample_supply_chain_documents_complete.pdf");
    if (parsed.success && parsed.text) {
      const doc201 = buildIndexedDocument({
        id: 201,
        title: "sample_supply_chain_documents_complete.pdf",
        doc_type: "PDF",
        storage_path: "/public/sample_supply_chain_documents_complete.pdf",
        uploaded_at: "2026-10-28T10:00:00Z",
        content: parsed.text,
        pages: parsed.pages,
        extraction_status: parsed.extractionStatus,
        is_uploaded: false
      });
      dbDocuments.push(doc201);
      const ds01 = dbDataSources.find((d) => d.id === "ds-01");
      if (ds01) {
        ds01.row_count = doc201.chunks.length;
        ds01.source_version = doc201.source_version;
      }
    }
  }

  // Fallback only if public sample PDF file is absent on disk
  if (!dbDocuments.some((d) => d.id === 201)) {
    const fallbackDoc201 = buildIndexedDocument({
      id: 201,
      title: "sample_supply_chain_documents_complete.pdf",
      doc_type: "PDF",
      storage_path: "/public/sample_supply_chain_documents_complete.pdf",
      uploaded_at: "2026-10-28T10:00:00Z",
      content: "Sample supply chain PDF file not found on disk."
    });
    dbDocuments.push(fallbackDoc201);
  }

  const doc101Content = `Q3 SUPPLY CHAIN PERFORMANCE & SUPPLIER Y OPERATIONAL DELAYS REPORT
EXECUTIVE AUDIT FINDING:
During Q3 2025, Supplier Y experienced catastrophic port congestion and warehouse logistics bottlenecks in Region A (North America East). As the primary supplier of Product X (Industrial Sensor Hub), delivery fulfillment latency increased from 4.2 days to 28.5 days. Consequently, regional retail and enterprise accounts experienced severe stockouts. Product X sales in Region A dropped by 35.0% quarter-over-quarter ($497,000 revenue reduction). Other sales regions (EMEA, APAC) sourced by secondary suppliers remained unaffected and showed +4.2% growth.
Immediate recommendation is to reallocate 40% of Region A Product X sourcing to secondary supplier Apex Global.`;

  const doc101 = buildIndexedDocument({
    id: 101,
    title: "Q3 Supply Chain Performance & Supplier Y Operational Delays Report",
    doc_type: "SUPPLY_CHAIN_AUDIT",
    storage_path: "/data/documents/supplier_y_q3_audit.pdf",
    uploaded_at: "2026-08-10T10:00:00Z",
    content: doc101Content,
    pages: [{ page_num: 1, text: doc101Content }],
    is_uploaded: false
  });
  dbDocuments.push(doc101);
}

function parseStrictDocId(raw: any): { provided: boolean; valid: boolean; value?: number } {
  if (raw === undefined || raw === null) return { provided: false, valid: true };
  if (typeof raw !== "string" && typeof raw !== "number") return { provided: true, valid: false };
  const str = String(raw).trim();
  if (str === "") return { provided: false, valid: true };
  if (!/^\d+$/.test(str)) return { provided: true, valid: false };
  const parsed = Number(str);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { provided: true, valid: false };
  return { provided: true, valid: true, value: parsed };
}

function resolveTargetDocSafe(req: Request): { doc?: DemoDocument; status?: number; error?: string } {
  const raw = req.query.document_id ?? req.body?.document_id ?? req.body?.active_document_id;
  const parsed = parseStrictDocId(raw);
  if (parsed.provided && !parsed.valid) {
    return { status: 400, error: "Invalid document_id: must be a positive integer." };
  }
  if (parsed.provided && parsed.value !== undefined) {
    const found = dbDocuments.find((d) => d.id === parsed.value);
    if (!found) {
      return { status: 404, error: `Document #${parsed.value} not found.` };
    }
    return { doc: found };
  }
  const fallback =
    dbDocuments.find((d) => d.is_uploaded) ||
    dbDocuments.find((d) => d.id === 201) ||
    dbDocuments[0];
  if (!fallback) {
    return { status: 404, error: "No documents available in workspace." };
  }
  return { doc: fallback };
}

function getLatestSessionForDoc(docId: number): AnalysisSession | undefined {
  const sessions = Array.from(dbSessions.values())
    .filter((s) => s.status === "COMPLETED" && (s.state?.active_document_id === docId || s.target_document_id === docId));
  return sessions.length > 0 ? sessions[sessions.length - 1] : undefined;
}

let isSeeded = false;
let seedError: Error | null = null;
let seedPromise: Promise<void> | null = null;

function ensureSeedStarted(): Promise<void> {
  if (!seedPromise) {
    seedPromise = seedInitialDocuments()
      .then(() => {
        isSeeded = true;
      })
      .catch((err) => {
        seedError = err instanceof Error ? err : new Error(String(err));
        console.error("[Seed] Initial document seeding failed:", seedError);
      });
  }
  return seedPromise;
}

// --- API Endpoints ---

app.get("/api/health", (_req: Request, res: Response) => {
  return res.status(200).json({
    status: seedError ? "degraded" : "ok",
    ready: isSeeded,
    documents_count: dbDocuments.length
  });
});

app.use("/api", async (req: Request, _res: Response, next: NextFunction) => {
  if (req.path === "/health") return next();
  await ensureSeedStarted();
  return next();
});

// 1. Auth & User Management
app.post("/api/auth/login", (req: Request, res: Response) => {
  const { email, password } = req.body || {};
  if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
    return res.status(400).json({ error: "Valid email and password strings are required." });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const user = dbUsers.get(normalizedEmail);

  if (!user) {
    dbAuditLogs.unshift({
      id: nextUniqueId("log"),
      user_id: "unregistered",
      action: "AUTH_LOGIN_FAILED",
      entity: "AuthSession",
      entity_id: normalizedEmail,
      created_at: formatAuditTimestamp()
    });
    return res.status(404).json({
      error: "Access Denied: No account found for this email. Without actual registration, you cannot log in. Please complete registration first.",
      requiresRegistration: true
    });
  }

  if (!verifyPassword(password, user.passwordHash)) {
    dbAuditLogs.unshift({
      id: nextUniqueId("log"),
      user_id: user.id,
      action: "AUTH_LOGIN_FAILED",
      entity: "AuthSession",
      entity_id: normalizedEmail,
      created_at: formatAuditTimestamp()
    });
    return res.status(401).json({ error: "Invalid password for this registered account." });
  }

  const token = `tok_${crypto.randomBytes(24).toString("hex")}`;
  dbTokens.set(token, user.email);

  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    user_id: user.id,
    action: "USER_LOGIN",
    entity: "AuthSession",
    entity_id: `${user.email}`,
    created_at: formatAuditTimestamp()
  });
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      company: user.company,
      department: user.department,
      createdAt: user.created_at,
      token
    },
    token
  });
});

app.post("/api/auth/register", (req: Request, res: Response) => {
  const { name, email, password, role, company, department } = req.body || {};
  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Name, email, and password strings are required." });
  }

  const trimmedName = name.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (trimmedName.length < 2) {
    return res.status(400).json({ error: "Name must be at least 2 non-whitespace characters." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }
  if (dbUsers.has(normalizedEmail)) {
    return res.status(409).json({ error: "An account with this email address already exists." });
  }
  if (password.length < 6 || password.trim().length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 non-whitespace characters long." });
  }

  const newId = `usr-${String(dbUsers.size + 1).padStart(2, "0")}`;
  const newUser: StoredUser = {
    id: newId,
    email: normalizedEmail,
    name: trimmedName,
    passwordHash: hashPassword(password),
    role: role === "admin" || role === "analyst" || role === "viewer" ? role : "analyst",
    company: (typeof company === "string" && company.trim()) || "Enterprise Supply Chain Corp",
    department: (typeof department === "string" && department.trim()) || "Operations Intelligence",
    created_at: new Date().toISOString()
  };

  dbUsers.set(normalizedEmail, newUser);
  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    user_id: newUser.id,
    action: "USER_REGISTERED",
    entity: "User",
    entity_id: newUser.email,
    created_at: formatAuditTimestamp()
  });

  const token = `tok_${crypto.randomBytes(24).toString("hex")}`;
  dbTokens.set(token, newUser.email);

  return res.status(201).json({
    message: "Registration successful",
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      company: newUser.company,
      department: newUser.department,
      createdAt: newUser.created_at,
      token
    },
    token
  });
});

app.post("/api/auth/logout", (req: Request, res: Response) => {
  const userId = req.body?.user_id || "unknown";
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (bearerToken) {
    dbTokens.delete(bearerToken);
  }
  if (typeof req.body?.token === "string" && req.body.token.trim()) {
    dbTokens.delete(req.body.token.trim());
  }
  if (typeof userId === "string" && userId !== "unknown") {
    const matchedUser = Array.from(dbUsers.values()).find((u) => u.id === userId);
    if (matchedUser) {
      for (const [tok, em] of dbTokens.entries()) {
        if (em === matchedUser.email) dbTokens.delete(tok);
      }
    }
  }
  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    user_id: String(userId),
    action: "USER_LOGOUT",
    entity: "AuthSession",
    entity_id: String(userId),
    created_at: formatAuditTimestamp()
  });
  return res.json({ success: true, message: "Logged out successfully" });
});

app.get("/api/auth/users", (_req: Request, res: Response) => {
  const safeUsers = Array.from(dbUsers.values()).map(({ passwordHash: _pw, ...rest }) => rest);
  return res.json({ users: safeUsers });
});

app.get("/api/auth/me", (req: Request, res: Response) => {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required. Missing Bearer token." });
  }
  const token = authHeader.slice(7).trim();
  const email = dbTokens.get(token);
  if (!email) {
    return res.status(401).json({ error: "Invalid or expired authentication token." });
  }
  const user = dbUsers.get(email);
  if (!user) {
    return res.status(401).json({ error: "User account no longer exists." });
  }
  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    company: user.company,
    department: user.department,
    createdAt: user.created_at
  });
});

// 2. Document Catalog Endpoint
app.get("/api/documents", (_req: Request, res: Response) => {
  const safeDocs = dbDocuments.map((d) => ({
    id: d.id,
    title: d.title,
    doc_type: d.doc_type,
    storage_path: d.storage_path,
    uploaded_at: d.uploaded_at,
    source_version: d.source_version,
    extraction_status: d.extraction_status,
    is_uploaded: Boolean(d.is_uploaded),
    is_active: d.is_active !== false,
    pages_count: d.pages_count || d.chunks.length,
    unparsed_pages: d.unparsed_pages || [],
    atomic_table_rows_count: d.atomic_table_rows?.length || 0,
    sections_count: d.sections.length,
    chunks_count: d.chunks.length,
    tables_count: d.sql_records.length,
    graph_nodes_count: d.graph_nodes.length,
    graph_edges_count: d.graph_edges.length,
    suggested_prompts: buildSuggestedPromptsForDocument(d),
    chunks: d.chunks.map((c) => ({
      document_id: c.document_id,
      chunk_id: c.chunk_id,
      chunk_index: c.chunk_index,
      page_number: c.page_number,
      section_title: c.section_title,
      content_type: c.content_type,
      text: c.content
    })),
    content_preview: d.content.slice(0, 300)
  }));
  return res.json({ documents: safeDocs });
});

app.get("/api/documents/:id", (req: Request, res: Response) => {
  const parsed = parseStrictDocId(req.params.id);
  if (!parsed.valid || parsed.value === undefined) {
    return res.status(400).json({ error: "Invalid document ID: must be a positive integer." });
  }
  const doc = dbDocuments.find((d) => d.id === parsed.value);
  if (!doc) {
    return res.status(404).json({ error: "Document not found" });
  }
  const { pdf_base64: _pdfBin, ...docRest } = doc;
  return res.json({
    ...docRest,
    is_uploaded: Boolean(doc.is_uploaded),
    is_active: doc.is_active !== false,
    suggested_prompts: buildSuggestedPromptsForDocument(doc),
    chunks: doc.chunks.map(({ vector: _v, ...rest }) => rest)
  });
});

app.patch("/api/documents/:id/status", (req: Request, res: Response) => {
  const parsed = parseStrictDocId(req.params.id);
  if (!parsed.valid || parsed.value === undefined) {
    return res.status(400).json({ error: "Invalid document ID: must be a positive integer." });
  }
  const doc = dbDocuments.find((d) => d.id === parsed.value);
  if (!doc) {
    return res.status(404).json({ error: "Document not found" });
  }
  const nextActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : doc.is_active === false;
  doc.is_active = nextActive;
  const ds = dbDataSources.find((s) => s.document_id === doc.id);
  if (ds) {
    ds.is_active = nextActive;
    ds.status = nextActive ? doc.extraction_status : "INACTIVE";
  }
  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    correlation_id: `corr-${crypto.randomUUID().slice(0, 8)}`,
    user_id: String(req.body?.user_id || "usr-01"),
    action: nextActive ? "DOCUMENT_ACTIVATED" : "DOCUMENT_DEACTIVATED",
    entity: "Document",
    entity_id: `doc-${doc.id}`,
    outcome: "success",
    created_at: formatAuditTimestamp()
  });
  return res.json({ success: true, document_id: doc.id, is_active: doc.is_active });
});

app.delete("/api/documents/:id", (req: Request, res: Response) => {
  const parsed = parseStrictDocId(req.params.id);
  if (!parsed.valid || parsed.value === undefined) {
    return res.status(400).json({ error: "Invalid document ID: must be a positive integer." });
  }
  const idx = dbDocuments.findIndex((d) => d.id === parsed.value);
  if (idx === -1) {
    return res.status(404).json({ error: "Document not found" });
  }
  const [removed] = dbDocuments.splice(idx, 1);
  const dsIdx = dbDataSources.findIndex((s) => s.document_id === parsed.value);
  if (dsIdx !== -1) dbDataSources.splice(dsIdx, 1);

  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    correlation_id: `corr-${crypto.randomUUID().slice(0, 8)}`,
    user_id: String(req.body?.user_id || "usr-01"),
    action: "DOCUMENT_DELETED",
    entity: "Document",
    entity_id: `doc-${removed.id} (${removed.title})`,
    outcome: "success",
    created_at: formatAuditTimestamp()
  });
  return res.json({ success: true, deleted_document_id: removed.id });
});

app.get("/api/data/sources", (_req: Request, res: Response) => {
  return res.json({ sources: dbDataSources });
});

app.post("/api/data/retrieval-test", (req: Request, res: Response) => {
  const { query, top_k } = req.body || {};
  if (typeof query !== "string" || !query.trim()) {
    return res.status(400).json({ error: "A non-empty query string is required for retrieval test." });
  }
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Document not found", results: [] });
  }
  const doc = resolved.doc;
  const classification = classifyUserQuery(query.trim(), doc);
  const limit = Math.min(12, Math.max(1, Number(top_k) || 5));
  const chunks = hybridRetrieveChunks(doc, query.trim(), classification, limit).slice(0, limit);
  return res.json({
    document_id: doc.id,
    document_name: doc.title,
    query: query.trim(),
    category: classification.category,
    results: chunks.map((c) => ({
      chunk_id: c.chunk_id,
      page_number: c.page_number,
      section_title: c.section_title,
      score: c.score,
      dense_score: c.dense_score,
      keyword_score: c.keyword_score,
      content: c.content
    }))
  });
});

// 3. Real PDF & Excel Parsing Endpoint with Page Preservation & Scanned-PDF Detection
app.post("/api/data/parse-pdf", async (req: Request, res: Response) => {
  const { base64, filename } = req.body || {};
  if (typeof base64 !== "string" || !base64.trim()) {
    return res.status(400).json({ error: "No valid base64 data provided." });
  }

  const rawFilename = typeof filename === "string" && filename.trim() ? filename.trim() : "Uploaded_Document.pdf";
  const safeFilename = path.basename(rawFilename).replace(/[\r\n\0]/g, "") || "Uploaded_Document.pdf";
  const cleanB64 = base64.replace(/^data:[^;]+;base64,/i, "").trim();
  const buffer = Buffer.from(cleanB64, "base64");
  const isExcel = /\.(?:xlsx|xls)$/i.test(safeFilename);
  const parsed = isExcel ? extractExcelBuffer(buffer, safeFilename) : await extractPdfBuffer(buffer, safeFilename);

  if (!parsed.success) {
    return res.status(422).json(parsed);
  }
  return res.json(parsed);
});

app.post("/api/data/parse-excel", async (req: Request, res: Response) => {
  const { base64, filename } = req.body || {};
  if (typeof base64 !== "string" || !base64.trim()) {
    return res.status(400).json({ error: "No valid base64 data provided." });
  }
  const safeFilename =
    path.basename(typeof filename === "string" && filename.trim() ? filename.trim() : "Uploaded_Sheet.xlsx").replace(/[\r\n\0]/g, "");
  const cleanB64 = base64.replace(/^data:[^;]+;base64,/i, "").trim();
  const parsed = extractExcelBuffer(Buffer.from(cleanB64, "base64"), safeFilename);
  if (!parsed.success) {
    return res.status(422).json(parsed);
  }
  return res.json(parsed);
});

// 4. Document Ingestion, Section/Table Extraction & Vector Indexing Endpoint
app.post("/api/data/upload", async (req: Request, res: Response) => {
  const { filename, title, name, type, content: providedContent, base64, pages: providedPages } = req.body || {};
  if (providedContent !== undefined && typeof providedContent !== "string") {
    return res.status(400).json({ error: "Field 'content' must be a string." });
  }
  if (base64 !== undefined && typeof base64 !== "string") {
    return res.status(400).json({ error: "Field 'base64' must be a base64 string." });
  }

  const rawName = (typeof filename === "string" && filename) || (typeof title === "string" && title) || (typeof name === "string" && name) || `Uploaded_Document_${Date.now()}.pdf`;
  const resolvedTitle = path.basename(rawName).replace(/[\r\n\0]/g, "").trim() || `Uploaded_Document_${Date.now()}.pdf`;
  const newId = nextUniqueId("ds");
  const docId = dbDocuments.length > 0 ? Math.max(...dbDocuments.map((d) => d.id)) + 1 : 301;

  let extractedText = (typeof providedContent === "string" ? providedContent : "").trim();
  let pages: PdfPageInput[] | undefined = Array.isArray(providedPages) ? providedPages : undefined;
  let unparsedPages: number[] = [];
  let extractionStatus: DemoDocument["extraction_status"] = "INDEXED";
  let extractionNotes: string | undefined;

  let cleanPdfB64: string | undefined;
  if (typeof base64 === "string" && base64.trim()) {
    const cleanB64 = base64.replace(/^data:[^;]+;base64,/i, "").trim();
    const buffer = Buffer.from(cleanB64, "base64");
    const isExcel = /\.(?:xlsx|xls)$/i.test(resolvedTitle) || String(type || "").toUpperCase() === "XLSX";
    if (!isExcel && resolvedTitle.toLowerCase().endsWith(".pdf")) {
      cleanPdfB64 = cleanB64;
    }
    const parsedResult = isExcel ? extractExcelBuffer(buffer, resolvedTitle) : await extractPdfBuffer(buffer, resolvedTitle);
    if (!parsedResult.success) {
      // Do NOT silently mask scanned/failed PDFs with fake text unless user explicitly provided text
      if (!extractedText) {
        return res.status(422).json({
          success: false,
          extraction_status: parsedResult.extractionStatus,
          isScanned: parsedResult.isScanned,
          unparsed_pages: parsedResult.unparsed_pages,
          error: parsedResult.error || "Document text extraction failed."
        });
      }
      extractionNotes = parsedResult.error;
    } else {
      extractedText = parsedResult.text;
      pages = parsedResult.pages;
      unparsedPages = parsedResult.unparsed_pages || [];
      extractionStatus = parsedResult.extractionStatus;
    }
  } else if (pages && pages.length > 0 && !extractedText) {
    extractedText = pages.map((p) => p.text || p.raw_text || "").filter(Boolean).join("\n\n").trim();
  }

  if (!extractedText || extractedText.length < 5) {
    return res.status(400).json({
      success: false,
      extraction_status: "EXTRACTION_FAILED",
      error: `Document "${resolvedTitle}" contains no extractable text or tabular content.`
    });
  }

  const docTypeRaw =
    typeof type === "string" && type.trim()
      ? type.trim()
      : resolvedTitle.toLowerCase().endsWith(".csv")
        ? "CSV"
        : /\.(?:xlsx|xls)$/i.test(resolvedTitle)
          ? "XLSX"
          : "PDF";
  const indexedDoc = buildIndexedDocument({
    id: docId,
    title: resolvedTitle,
    doc_type: docTypeRaw.toUpperCase(),
    storage_path: `/data/uploads/${resolvedTitle}`,
    content: extractedText,
    pages,
    unparsed_pages: unparsedPages,
    extraction_status: extractionStatus,
    extraction_notes: extractionNotes,
    is_uploaded: true,
    is_active: true,
    pdf_base64: cleanPdfB64
  });

  dbDocuments.unshift(indexedDoc);
  dbDataSources.unshift({
    id: newId,
    document_id: indexedDoc.id,
    name: resolvedTitle,
    type: indexedDoc.doc_type,
    status: indexedDoc.extraction_status,
    row_count: indexedDoc.chunks.length,
    upload_date: new Date().toISOString().split("T")[0],
    source_version: indexedDoc.source_version,
    is_uploaded: true,
    is_active: true
  });

  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    correlation_id: `corr-${crypto.randomUUID().slice(0, 8)}`,
    user_id: String(req.body?.user_id || "usr-01"),
    action: "DOCUMENT_INGESTED",
    entity: indexedDoc.doc_type,
    entity_id: `doc-${indexedDoc.id} (${indexedDoc.title})`,
    outcome: "success",
    created_at: formatAuditTimestamp()
  });

  console.log(
    `[Ingestion] Indexed doc_id=${indexedDoc.id} title="${indexedDoc.title}" version=${indexedDoc.source_version} pages=${indexedDoc.pages_count} unparsed=[${indexedDoc.unparsed_pages.join(",")}] atomic_table_rows=${indexedDoc.atomic_table_rows.length} sections=${indexedDoc.sections.length} chunks=${indexedDoc.chunks.length} sql_tables=${indexedDoc.sql_records.length} graph_nodes=${indexedDoc.graph_nodes.length}`
  );

  return res.json({
    success: true,
    document_id: indexedDoc.id,
    title: indexedDoc.title,
    source_version: indexedDoc.source_version,
    extraction_status: indexedDoc.extraction_status,
    is_uploaded: true,
    pages_count: indexedDoc.pages_count,
    unparsed_pages: indexedDoc.unparsed_pages,
    atomic_table_rows_count: indexedDoc.atomic_table_rows.length,
    sections_count: indexedDoc.sections.length,
    chunks_count: indexedDoc.chunks.length,
    tables_extracted: indexedDoc.sql_records.length,
    graph_entities_extracted: indexedDoc.graph_nodes.length,
    suggested_prompts: buildSuggestedPromptsForDocument(indexedDoc),
    content_preview: indexedDoc.content.slice(0, 200),
    message: `Document #${indexedDoc.id} ("${indexedDoc.title}") extracted, chunked, and indexed with strict isolation.`
  });
});

// 5. AI Query Initiation (Requires & propagates investigation_id and target_document_id strictly)
app.post("/api/ai/query", async (req: Request, res: Response) => {
  const { question, target_document_id, active_document_id, user_id } = req.body || {};
  if (question !== undefined && typeof question !== "string") {
    return res.status(400).json({ error: "Field 'question' must be a string." });
  }
  const requestedDocId = active_document_id ?? target_document_id;
  const parsedDoc = parseStrictDocId(requestedDocId);
  if (parsedDoc.provided && !parsedDoc.valid) {
    return res.status(400).json({ error: "Invalid target_document_id: must be a positive integer." });
  }
  if (!parsedDoc.provided || parsedDoc.value === undefined) {
    return res.status(400).json({ error: "Active target_document_id (or active_document_id) is required for strict document scoping." });
  }
  const parsedDocId = parsedDoc.value;

  const exists = dbDocuments.some((d) => d.id === parsedDocId);
  if (!exists) {
    return res.status(404).json({ error: `Target document #${parsedDocId} does not exist.` });
  }

  const sessionId = `session-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const investigationId = `inv-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

  const session: AnalysisSession = {
    id: sessionId,
    investigation_id: investigationId,
    user_id: String(user_id || "usr-01"),
    question: (question || "Extract operational findings from the active document.").trim(),
    target_document_id: parsedDocId,
    status: "PLANNING",
    created_at: new Date().toISOString(),
    state: null
  };

  dbSessions.set(sessionId, session);
  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    user_id: session.user_id,
    action: "GRAPHRAG_QUERY",
    entity: "AnalysisSession",
    entity_id: `${investigationId} (doc-${parsedDocId ?? "auto"})`,
    created_at: formatAuditTimestamp()
  });
  return res.json({
    session_id: sessionId,
    investigation_id: investigationId,
    active_document_id: parsedDocId,
    status: "INITIATED"
  });
});

// 6. SSE Multi-Agent Execution Stream (Strict Evidence-First Pipeline)
app.get("/api/ai/query/:session_id/stream", async (req: Request, res: Response) => {
  const { session_id } = req.params;
  const session = dbSessions.get(session_id);

  if (!session) {
    return res.status(404).json({ error: "Analysis session not found" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const questionText = session.question;
    const investigationId = session.investigation_id;

    // --- Step 1: Lock Active Target Document Strictly by ID (Rule 1: Never fall back across docs) ---
    const targetDoc: DemoDocument | undefined =
      session.target_document_id !== undefined
        ? dbDocuments.find((d) => d.id === session.target_document_id)
        : undefined;

    if (!targetDoc) {
      sendEvent("error", { message: "Active target document not found or unspecified." });
      res.end();
      return;
    }

    console.log(
      `[Investigation:start] inv=${investigationId} session=${session_id} active_document_id=${targetDoc.id} title="${targetDoc.title}" version=${targetDoc.source_version}`
    );

    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "Document Selection Agent",
      status: "RUNNING",
      message: `Locked Doc #${targetDoc.id}: "${targetDoc.title}" (${targetDoc.source_version}).`
    });
    await new Promise((r) => setTimeout(r, 120));

    // --- Step 2: 11-Category Query Classification ---
    const classification = classifyUserQuery(questionText, targetDoc);

    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "Query Classification Agent",
      status: "RUNNING",
      message: `Category: ${classification.category}. ${classification.reasoning}`
    });

    const plan = {
      intent: classification.category,
      needs_sql: classification.needs_sql,
      needs_graph: classification.needs_graph,
      needs_docs: true,
      needs_forecast: false,
      reasoning: classification.reasoning
    };
    sendEvent("plan_created", { investigation_id: investigationId, plan });
    await new Promise((r) => setTimeout(r, 120));

    // --- Step 3: Hybrid Qdrant Retrieval (Strict document_id filter + Exhaustive Scan) ---
    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "Vector Search Agent (Qdrant Isolation)",
      status: "RUNNING",
      message: `Searching BGE-M3 dense + keyword index strictly where document_id = ${targetDoc.id}...`
    });

    const retrievedChunks = hybridRetrieveChunks(targetDoc, questionText, classification, 6);
    await new Promise((r) => setTimeout(r, 120));

    // --- Step 4: Schema-Aware Read-Only SQL Agent ---
    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "SQL Agent (PostgreSQL RO)",
      status: "RUNNING",
      message: `Inspecting schema & running parameterized SELECT WHERE document_id = $1 ($1=${targetDoc.id})...`
    });

    const sqlEvidence = executeDocumentSQLAgent(targetDoc, questionText, classification);
    await new Promise((r) => setTimeout(r, 100));

    // --- Step 5: Provenance-Verified Neo4j GraphRAG Agent ---
    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "Neo4j GraphRAG Agent",
      status: "RUNNING",
      message: classification.needs_graph
        ? `Traversing provenance-verified subgraph where document_id = ${targetDoc.id}...`
        : `Skipping graph traversal (${classification.category} answered directly from PDF/SQL).`
    });

    const graphEvidence = executeDocumentGraphAgent(targetDoc, classification);
    await new Promise((r) => setTimeout(r, 100));

    sendEvent("retrieval_complete", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      sqlEvidence,
      graphEvidence,
      docEvidence: { chunks: retrievedChunks }
    });

    // --- Step 6: Build Structured Intermediate EvidencePackage ---
    const evidencePkg = buildEvidencePackage({
      doc: targetDoc,
      investigation_id: investigationId,
      query: questionText,
      classification,
      chunks: retrievedChunks,
      sqlEvidence,
      graphEvidence
    });
    const analyticsResult = buildAnalyticsResult(targetDoc, evidencePkg);

    // --- Step 7: Evidence-First Decision Synthesizer ---
    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "Evidence-First Synthesis Agent",
      status: "RUNNING",
      message: "Synthesizing structured answer strictly from validated EvidencePackage..."
    });

    const decision = await synthesizeEvidenceFirstDecision({
      doc: targetDoc,
      classification,
      sqlEvidence,
      graphEvidence,
      evidencePkg
    });
    sendEvent("decision_complete", { investigation_id: investigationId, decision });
    await new Promise((r) => setTimeout(r, 100));

    // --- Step 8: Independent 12-Point Critic & Multi-Factor Confidence Scoring ---
    sendEvent("step", {
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      node: "Critic / 12-Point Verification Agent",
      status: "RUNNING",
      message: "Running 12-point claim, entity, unit, citation, SQL conflict, and anti-contamination checks..."
    });

    const validationResult = runCriticValidationAgent({
      doc: targetDoc,
      allDocs: dbDocuments,
      investigation_id: investigationId,
      classification,
      retrievedChunks,
      sqlEvidence,
      graphEvidence,
      evidencePkg,
      decision
    });

    // Never hide failed critic checks: if validation rejected or conflict detected, annotate decision honestly
    if (!validationResult.is_valid && decision.answer_type !== "insufficient_evidence") {
      decision.assumptions = [
        ...(decision.assumptions || []),
        `CRITIC NOTICE (${validationResult.validation_status}): ${validationResult.rejection_reasons.join("; ")}`
      ];
    }

    // --- Step 9: Build Investigation Diagnostics ---
    const diagnostics = buildInvestigationDiagnostics({
      doc: targetDoc,
      investigation_id: investigationId,
      query: questionText,
      classification,
      retrievedChunks,
      sqlEvidence,
      graphEvidence,
      validationResult,
      evidencePkg
    });

    // Structured non-sensitive diagnostic logging (never logs raw private doc contents)
    console.log(
      `[Investigation:complete] inv=${investigationId} doc_id=${targetDoc.id} version=${targetDoc.source_version} category=${classification.category} chunks=${retrievedChunks.length} pages=[${diagnostics.retrieved_page_numbers.join(",")}] sql_rows=${sqlEvidence.row_count} graph_edges=${graphEvidence.paths.length} critic=${validationResult.validation_status} conf=${validationResult.confidence_score}`
    );

    const finalState = {
      session_id,
      investigation_id: investigationId,
      active_document_id: targetDoc.id,
      active_document_name: targetDoc.title,
      page_count: targetDoc.pages_count,
      unparsed_pages: targetDoc.unparsed_pages || [],
      source_document_version: targetDoc.source_version,
      question: questionText,
      plan,
      sql_evidence: sqlEvidence,
      graph_evidence: graphEvidence,
      doc_evidence: { chunks: retrievedChunks },
      analytics_result: analyticsResult,
      forecast_result: {
        status: "not_applicable",
        point_estimates: [],
        lower_bounds: [],
        upper_bounds: [],
        confidence_interval_pct: 95,
        historical_periods_used: 0
      },
      evidence_package: evidencePkg,
      qa_result: evidencePkg.qa_result,
      decision,
      validation_result: validationResult,
      diagnostics,
      iteration_count: 1,
      errors: []
    };

    session.status = "COMPLETED";
    session.state = finalState;
    dbSessions.set(session_id, session);

    sendEvent("complete", { session_id, investigation_id: investigationId, state: finalState });
    res.end();
  } catch (err: any) {
    console.error(`[Investigation:error] session=${session_id}:`, err?.message || err);
    sendEvent("error", { message: err?.message || "Pipeline execution failed" });
    res.end();
  }
});

// 7. Graph Explorer Endpoint (Strict Document Isolation & Provenance)
app.get("/api/graph/entities", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Document not found", nodes: [], edges: [] });
  }
  const targetDoc = resolved.doc;

  return res.json({
    document_id: targetDoc.id,
    document_name: targetDoc.title,
    is_uploaded: Boolean(targetDoc.is_uploaded),
    nodes: targetDoc.graph_nodes || [],
    edges: targetDoc.graph_edges || []
  });
});

app.post("/api/graph/query", (req: Request, res: Response) => {
  const { cypher, user_id } = req.body || {};
  const validation = validateReadOnlyCypher(cypher || "MATCH (n) RETURN n LIMIT 10");

  if (!validation.isValid) {
    dbAuditLogs.unshift({
      id: nextUniqueId("log"),
      correlation_id: `corr-${crypto.randomUUID().slice(0, 8)}`,
      user_id: String(user_id || "usr-01"),
      action: "CYPHER_GUARDRAIL_BLOCKED",
      entity: "Neo4jGraph",
      entity_id: String(cypher || "").slice(0, 48),
      outcome: "denied",
      created_at: formatAuditTimestamp()
    });
    return res.status(400).json({ error: validation.error });
  }

  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Document not found", result: [] });
  }
  const targetDoc = resolved.doc;

  dbAuditLogs.unshift({
    id: nextUniqueId("log"),
    correlation_id: `corr-${crypto.randomUUID().slice(0, 8)}`,
    user_id: String(user_id || "usr-01"),
    action: "CYPHER_EXPLORATION",
    entity: "Neo4jGraph",
    entity_id: `doc-${targetDoc.id}`,
    outcome: "success",
    created_at: formatAuditTimestamp()
  });

  const verifiedResults = executeReadOnlyCypherQuery(
    cypher || "MATCH (n)-[r]->(m) RETURN n,r,m LIMIT 100",
    targetDoc
  );

  return res.json({
    cypher_executed: cypher,
    document_id: targetDoc.id,
    result: verifiedResults
  });
});

app.post("/api/graph/rebuild", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Document not found" });
  }
  const existing = resolved.doc;
  const rebuilt = buildIndexedDocument({
    id: existing.id,
    title: existing.title,
    doc_type: existing.doc_type,
    storage_path: existing.storage_path,
    uploaded_at: existing.uploaded_at,
    is_uploaded: existing.is_uploaded,
    is_active: existing.is_active,
    pdf_base64: existing.pdf_base64,
    content: existing.content,
    pages: existing.raw_pages.map((p) => ({
      page_num: p.page_num,
      text: p.raw_text || p.text,
      raw_text: p.raw_text,
      extraction: p.extraction,
      ocr_used: p.ocr_used,
      parse_error: p.parse_error
    })),
    unparsed_pages: existing.unparsed_pages,
    extraction_status: existing.extraction_status,
    extraction_notes: existing.extraction_notes
  });

  const docIdx = dbDocuments.findIndex((d) => d.id === existing.id);
  if (docIdx >= 0) {
    dbDocuments[docIdx] = rebuilt;
  }

  return res.json({
    document_id: rebuilt.id,
    document_name: rebuilt.title,
    is_uploaded: Boolean(rebuilt.is_uploaded),
    nodes: rebuilt.graph_nodes || [],
    edges: rebuilt.graph_edges || []
  });
});

// 8. Executive Reports & Document-Scoped Briefing Endpoint
app.get("/api/reports/briefing", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Target document not found" });
  }
  const targetDoc = resolved.doc;
  const latestSession = getLatestSessionForDoc(targetDoc.id);
  return res.json(buildDocumentBriefing(targetDoc, latestSession));
});

app.get("/api/reports", (req: Request, res: Response) => {
  const parsedFilter = parseStrictDocId(req.query.document_id);
  if (parsedFilter.provided && !parsedFilter.valid) {
    return res.status(400).json({ error: "Invalid document_id: must be a positive integer." });
  }
  const docFilter = parsedFilter.value;
  if (docFilter !== undefined && !dbDocuments.some((d) => d.id === docFilter)) {
    return res.status(404).json({ error: `Document #${docFilter} not found.` });
  }

  const sessions = Array.from(dbSessions.values())
    .filter((s) => s.status === "COMPLETED" && s.state?.decision)
    .filter((s) => (docFilter !== undefined ? s.state?.active_document_id === docFilter : true));

  const reports = sessions.slice(0, 10).map((s) => ({
    id: s.investigation_id,
    document_id: s.state.active_document_id,
    title: s.state.decision.title || s.question,
    created_at: s.created_at.split("T")[0],
    confidence: s.state.validation_result?.confidence_score || 0,
    priority: s.state.decision.priority || "INFO",
    summary: s.state.decision.conclusion || s.state.decision.direct_answer || ""
  }));

  if (reports.length === 0) {
    const resolved = resolveTargetDocSafe(req);
    if (resolved.doc) {
      const targetDoc = resolved.doc;
      reports.push({
        id: `rep-doc-${targetDoc.id}`,
        document_id: targetDoc.id,
        title: `Executive Operations Briefing: ${targetDoc.title}`,
        created_at: (targetDoc.uploaded_at || new Date().toISOString()).split("T")[0],
        confidence: 1.0,
        priority: "INFO",
        summary: `Grounded briefing indexed for "${targetDoc.title}" (${targetDoc.pages_count} page(s), ${targetDoc.sections.length} section(s)).`
      });
    }
  }
  return res.json({ reports });
});

app.post("/api/reports/generate", (req: Request, res: Response) => {
  const { session_id, document_id } = req.body || {};
  const session = session_id ? dbSessions.get(session_id) : undefined;
  const resolved = resolveTargetDocSafe(req);
  if (resolved.status === 400) {
    return res.status(400).json({ error: resolved.error });
  }
  const targetDoc = resolved.doc;
  return res.json({
    report_id: nextUniqueId("rep"),
    document_id: session?.state?.active_document_id || targetDoc?.id || document_id,
    title:
      session?.state?.decision?.title ||
      (targetDoc ? `Executive Decision Briefing — ${targetDoc.title}` : "Executive Decision Briefing"),
    generated_at: new Date().toISOString(),
    download_url: "#"
  });
});

// 9. Audit Logs
app.get("/api/audit-logs", (_req: Request, res: Response) => {
  const enrichedLogs = dbAuditLogs.map((l) => ({
    ...l,
    correlation_id: l.correlation_id || l.id,
    outcome:
      l.outcome ||
      (/FAILED|BLOCKED|DENIED|REJECTED/i.test(l.action) ? "denied" : "success")
  }));
  return res.json({ logs: enrichedLogs });
});

// 10. Dashboard Analytics, Summary, KPIs & Trends (Strictly Document-Scoped — zero hardcoded leaks)
app.get("/api/dashboard/analytics", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Target document not found" });
  }
  const targetDoc = resolved.doc;
  const latestSession = getLatestSessionForDoc(targetDoc.id);
  return res.json(buildDocumentDashboardAnalytics(targetDoc, latestSession));
});

app.get("/api/dashboard/summary", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Target document not found" });
  }
  const targetDoc = resolved.doc;
  const analytics = buildDocumentDashboardAnalytics(targetDoc, getLatestSessionForDoc(targetDoc.id));
  const pnl = analytics.charts.regional_pnl;
  const totalRevenue = pnl.reduce((s: number, r: any) => s + Number(r.gross_revenue || 0), 0);
  const invBelow = analytics.charts.inventory_status.filter((r: any) => r.status === "BELOW REORDER POINT");
  const scoredVendors = analytics.charts.vendor_performance.filter(
    (r: any) => typeof r.on_time_pct === "number" && Number.isFinite(r.on_time_pct)
  );
  const avgOtd =
    scoredVendors.length > 0
      ? scoredVendors.reduce((s: number, r: any) => s + Number(r.on_time_pct), 0) / scoredVendors.length
      : null;

  return res.json({
    document_id: targetDoc.id,
    document_title: targetDoc.title,
    total_revenue: totalRevenue,
    supplier_reliability_index: avgOtd !== null ? Number(avgOtd.toFixed(1)) : null,
    at_risk_products_count: invBelow.length,
    kpis: analytics.kpis
  });
});

app.get("/api/dashboard/kpis", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Target document not found", kpis: [] });
  }
  const targetDoc = resolved.doc;
  const analytics = buildDocumentDashboardAnalytics(targetDoc, getLatestSessionForDoc(targetDoc.id));
  return res.json({ document_id: targetDoc.id, kpis: analytics.kpis });
});

app.get("/api/dashboard/trends", (req: Request, res: Response) => {
  const resolved = resolveTargetDocSafe(req);
  if (!resolved.doc) {
    return res.status(resolved.status || 404).json({ error: resolved.error || "Target document not found" });
  }
  const targetDoc = resolved.doc;
  const analytics = buildDocumentDashboardAnalytics(targetDoc, getLatestSessionForDoc(targetDoc.id));
  return res.json({
    document_id: targetDoc.id,
    document_title: targetDoc.title,
    charts: analytics.charts
  });
});

// Server Initialization
async function startServer() {
  const rawPort = process.env.PORT ? parseInt(process.env.PORT, 10) : NaN;
  const nginxPort = process.env.NGINX_PORT ? parseInt(process.env.NGINX_PORT, 10) : NaN;
  const defaultAppPort = process.env.DEFAULT_APP_PORT ? parseInt(process.env.DEFAULT_APP_PORT, 10) : 3000;
  const PORT = Number.isFinite(rawPort) && rawPort !== nginxPort ? rawPort : defaultAppPort;

  // Start document seeding immediately without blocking HTTP port binding
  ensureSeedStarted();

  if (process.env.NODE_ENV !== "production") {
    let viteMiddlewares: any = null;
    let viteError: Error | null = null;
    const viteReadyPromise = createViteServer({
      root: process.cwd(),
      server: {
        middlewareMode: true,
        hmr: false,
        ...(process.env.DISABLE_HMR === "true" ? { watch: null } : {})
      },
      appType: "spa"
    })
      .then((vite) => {
        viteMiddlewares = vite.middlewares;
        return vite;
      })
      .catch((err) => {
        viteError = err instanceof Error ? err : new Error(String(err));
        console.error("[Vite] Failed to initialize Vite dev server:", viteError);
        return null;
      });

    app.use(async (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      if (!viteMiddlewares) {
        await viteReadyPromise;
      }
      if (viteMiddlewares) {
        return viteMiddlewares(req, res, next);
      }
      return res.status(503).send(viteError ? `Vite initialization error: ${viteError.message}` : "Starting server...");
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[GraphRAG Decision Platform] Server listening on http://0.0.0.0:${PORT}`);
  });

  server.on("error", (err: any) => {
    console.error("Server listener error:", err);
    process.exit(1);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  console.error("Fatal server initialization error:", err);
  process.exit(1);
});
