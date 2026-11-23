import React, { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Terminal, CheckCircle2, ShieldAlert, Play } from "lucide-react";

interface SecuritySandboxPageProps {
  activeDocumentId?: number;
}

interface SandboxSuiteRow {
  id: string;
  input: string;
  expected: string;
  result: "PENDING" | "PASS" | "FAIL";
  detail?: string;
}

export const SecuritySandboxPage: React.FC<SecuritySandboxPageProps> = ({ activeDocumentId = 201 }) => {
  const [payload, setPayload] = useState("MATCH (n) DETACH DELETE n");
  const [result, setResult] = useState<{ status: number; body: any } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const [suiteRows, setSuiteRows] = useState<SandboxSuiteRow[]>([
    { id: "drop", input: "DROP TABLE sales", expected: "Reject", result: "PENDING" },
    { id: "sqli", input: "SELECT...; DELETE...", expected: "Reject", result: "PENDING" },
    { id: "detach", input: "MATCH (n) DETACH DELETE n", expected: "Reject", result: "PENDING" },
    { id: "auth", input: "Unauthenticated profile API", expected: "Deny", result: "PENDING" },
    { id: "tenant", input: "Cross-tenant doc #999999 read", expected: "Deny", result: "PENDING" }
  ]);
  const [isRunningSuite, setIsRunningSuite] = useState(false);

  const presets = [
    { label: "DROP TABLE SQL Injection", query: "DROP TABLE sales; SELECT * FROM users;" },
    { label: "Cypher DETACH DELETE", query: "MATCH (n) DETACH DELETE n" },
    { label: "Cypher CREATE Mutation", query: "CREATE (n:FakeEntity {name: 'Injected'}) RETURN n" },
    {
      label: "Valid Read-Only MATCH",
      query: `MATCH (n {document_id: ${activeDocumentId}})-[r]->(m) RETURN n,r,m LIMIT 10`
    }
  ];

  const runLiveSuite = useCallback(async () => {
    setIsRunningSuite(true);
    try {
      const [r1, r2, r3, r4, r5] = await Promise.all([
        fetch("/api/graph/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cypher: "DROP TABLE sales;", document_id: activeDocumentId, user_id: "sandbox" })
        }),
        fetch("/api/graph/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cypher: "SELECT * FROM users; DELETE FROM users;", document_id: activeDocumentId, user_id: "sandbox" })
        }),
        fetch("/api/graph/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cypher: "MATCH (n) DETACH DELETE n", document_id: activeDocumentId, user_id: "sandbox" })
        }),
        fetch("/api/auth/me"),
        fetch("/api/graph/entities?document_id=999999")
      ]);

      setSuiteRows([
        { id: "drop", input: "DROP TABLE sales", expected: "Reject", result: r1.status === 400 ? "PASS" : "FAIL" },
        { id: "sqli", input: "SELECT...; DELETE...", expected: "Reject", result: r2.status === 400 ? "PASS" : "FAIL" },
        { id: "detach", input: "MATCH (n) DETACH DELETE n", expected: "Reject", result: r3.status === 400 ? "PASS" : "FAIL" },
        { id: "auth", input: "Unauthenticated profile API", expected: "Deny", result: r4.status === 401 ? "PASS" : "FAIL" },
        { id: "tenant", input: "Cross-tenant doc #999999 read", expected: "Deny", result: r5.status === 404 ? "PASS" : "FAIL" }
      ]);
    } catch (err) {
      console.error("Sandbox suite failed:", err);
    } finally {
      setIsRunningSuite(false);
    }
  }, [activeDocumentId]);

  useEffect(() => {
    runLiveSuite();
  }, [runLiveSuite]);

  const handleRunTest = async (queryOverride?: string) => {
    const q = queryOverride || payload;
    if (queryOverride) setPayload(queryOverride);
    setIsTesting(true);
    try {
      const res = await fetch("/api/graph/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher: q, document_id: activeDocumentId })
      });
      const body = await res.json();
      setResult({ status: res.status, body });
    } catch (err: any) {
      setResult({ status: 500, body: { error: err?.message || "Sandbox request failed" } });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <p className="text-xs sm:text-sm text-slate-600">
        Interactive read-only guardrail sandbox for verifying SQL/Cypher sanitization and document isolation boundaries.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Card: Live Guardrail Verification Matrix */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1D63ED]" />
              <span>Security sandbox</span>
            </h3>
            <button
              type="button"
              onClick={runLiveSuite}
              disabled={isRunningSuite}
              className="bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              <Play className="w-3 h-3" />
              <span>{isRunningSuite ? "Running..." : "Re-run Suite"}</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold">Test input</th>
                  <th className="py-2.5 px-3 font-semibold">Expected</th>
                  <th className="py-2.5 pl-3 font-semibold text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suiteRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 pr-3 font-mono text-slate-800">{row.input}</td>
                    <td className="py-3 px-3 text-slate-600">{row.expected}</td>
                    <td className="py-3 pl-3 text-right">
                      <span
                        className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded ${
                          row.result === "PASS"
                            ? "bg-emerald-50 text-emerald-700"
                            : row.result === "FAIL"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {row.result}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="pt-2 border-t border-slate-100 text-xs text-slate-500">
            Strict <code className="font-mono text-slate-700">active_document_id</code> scoping and read-only Cypher parsing active on Doc #{activeDocumentId}.
          </p>
        </div>

        {/* Right Card: Custom Payload Tester */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#1D63ED]" />
              <span>Guardrail Execution Tester</span>
            </h3>
            <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded tabular-nums">
              Doc #{activeDocumentId}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => handleRunTest(p.query)}
                className="text-xs font-medium px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 hover:border-[#1D63ED] hover:text-[#1D63ED] text-slate-700 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          <textarea
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={4}
            className="w-full bg-[#0F172A] border border-slate-800 rounded-xl p-3.5 font-mono text-xs text-slate-100 focus:outline-none focus:border-[#1D63ED]"
          />

          <button
            type="button"
            disabled={isTesting}
            onClick={() => handleRunTest()}
            className="w-full bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-xs py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {isTesting ? "Running Sanitizer Check..." : "Run Guardrail Verification"}
          </button>

          {result && (
            <div
              className={`p-4 rounded-xl border font-mono text-xs ${
                result.status >= 400
                  ? "bg-amber-50/70 border-amber-200 text-amber-900"
                  : "bg-emerald-50/70 border-emerald-200 text-emerald-900"
              }`}
            >
              <div className="flex items-center gap-2 font-bold mb-1.5">
                {result.status >= 400 ? (
                  <ShieldAlert className="w-4 h-4 text-amber-700" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                )}
                <span>
                  HTTP {result.status} —{" "}
                  {result.status >= 400 ? "Mutating / Unsafe Query Blocked" : "Read-Only Query Allowed"}
                </span>
              </div>
              <pre className="text-[11px] whitespace-pre-wrap text-slate-700 max-h-48 overflow-y-auto">
                {JSON.stringify(result.body, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
