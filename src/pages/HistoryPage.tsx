import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Search, Play, ShieldCheck } from "lucide-react";

interface SandboxCheckItem {
  id: string;
  input: string;
  expected: string;
  status: "PENDING" | "PASS" | "FAIL";
  httpStatus?: number;
}

export const HistoryPage: React.FC<{ activeDocumentId?: number }> = ({ activeDocumentId = 201 }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [filterAction, setFilterAction] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const [sandboxChecks, setSandboxChecks] = useState<SandboxCheckItem[]>([
    { id: "drop", input: "DROP TABLE sales", expected: "Reject", status: "PENDING" },
    { id: "sqli", input: "SELECT...; DELETE...", expected: "Reject", status: "PENDING" },
    { id: "cypher-mut", input: "CREATE (n:Fake) RETURN n", expected: "Reject", status: "PENDING" },
    { id: "auth-deny", input: "Unauth admin / profile API", expected: "Deny", status: "PENDING" },
    { id: "cross-doc", input: "Cross-tenant doc read", expected: "Deny", status: "PENDING" }
  ]);
  const [isRunningSandbox, setIsRunningSandbox] = useState(false);

  const fetchLogs = useCallback(async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch("/api/audit-logs");
      const data = await res.json();
      setLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch audit logs:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  }, []);

  const runLiveSandboxVerification = useCallback(async () => {
    setIsRunningSandbox(true);
    try {
      const [dropRes, sqliRes, createRes, unauthRes, crossDocRes] = await Promise.all([
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
          body: JSON.stringify({ cypher: "CREATE (n:Fake {name: 'x'}) RETURN n", document_id: activeDocumentId, user_id: "sandbox" })
        }),
        fetch("/api/auth/me"),
        fetch("/api/graph/entities?document_id=999999")
      ]);

      setSandboxChecks([
        {
          id: "drop",
          input: "DROP TABLE sales",
          expected: "Reject",
          status: dropRes.status === 400 ? "PASS" : "FAIL",
          httpStatus: dropRes.status
        },
        {
          id: "sqli",
          input: "SELECT...; DELETE...",
          expected: "Reject",
          status: sqliRes.status === 400 ? "PASS" : "FAIL",
          httpStatus: sqliRes.status
        },
        {
          id: "cypher-mut",
          input: "CREATE (n:Fake) RETURN n",
          expected: "Reject",
          status: createRes.status === 400 ? "PASS" : "FAIL",
          httpStatus: createRes.status
        },
        {
          id: "auth-deny",
          input: "Unauth admin / profile API",
          expected: "Deny",
          status: unauthRes.status === 401 ? "PASS" : "FAIL",
          httpStatus: unauthRes.status
        },
        {
          id: "cross-doc",
          input: "Cross-tenant doc read",
          expected: "Deny",
          status: crossDocRes.status === 404 ? "PASS" : "FAIL",
          httpStatus: crossDocRes.status
        }
      ]);
      await fetchLogs();
    } catch (err) {
      console.error("Sandbox verification error:", err);
    } finally {
      setIsRunningSandbox(false);
    }
  }, [activeDocumentId, fetchLogs]);

  useEffect(() => {
    fetchLogs();
    runLiveSandboxVerification();
  }, [fetchLogs, runLiveSandboxVerification]);

  const filteredLogs = logs.filter((log) => {
    const matchesFilter = filterAction === "ALL" || log.action === filterAction;
    const matchesSearch =
      !searchQuery ||
      log.user_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.entity_id?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.action?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.correlation_id?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const formatShortTime = (ts?: string) => {
    if (!ts) return "—";
    const timePart = ts.includes(" ") ? ts.split(" ")[1] : ts;
    return (timePart || ts).slice(0, 8);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs sm:text-sm text-slate-600">
          Real-time audit log trace with correlation IDs paired with live backend guardrail verification.
        </p>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchLogs}
            disabled={isLoadingLogs}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? "animate-spin" : ""}`} />
            <span>Refresh Events</span>
          </button>
          <button
            type="button"
            onClick={runLiveSandboxVerification}
            disabled={isRunningSandbox}
            className="bg-[#1D63ED] hover:bg-[#1554D1] text-white text-xs font-semibold px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{isRunningSandbox ? "Verifying..." : "Run Sandbox Checks"}</span>
          </button>
        </div>
      </div>

      {/* Dual Card Layout Matching Reference Fig A.8 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Left Card: Audit Events */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">Audit events</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter user or action..."
                  className="bg-slate-50 border border-slate-200 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-[#1D63ED] w-40"
                />
              </div>
              <select
                value={filterAction}
                onChange={(e) => setFilterAction(e.target.value)}
                aria-label="Filter action type"
                className="bg-white border border-slate-200 text-slate-700 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-[#1D63ED]"
              >
                <option value="ALL">All actions</option>
                <option value="USER_LOGIN">USER_LOGIN</option>
                <option value="USER_REGISTERED">USER_REGISTERED</option>
                <option value="AUTH_LOGIN_FAILED">AUTH_LOGIN_FAILED</option>
                <option value="DOCUMENT_INGESTED">DOCUMENT_INGESTED</option>
                <option value="GRAPHRAG_QUERY">GRAPHRAG_QUERY</option>
                <option value="CYPHER_EXPLORATION">CYPHER_EXPLORATION</option>
                <option value="CYPHER_GUARDRAIL_BLOCKED">CYPHER_GUARDRAIL_BLOCKED</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 bg-white sticky top-0">
                <tr>
                  <th className="py-2.5 pr-3 font-semibold">Time</th>
                  <th className="py-2.5 px-3 font-semibold">User</th>
                  <th className="py-2.5 px-3 font-semibold">Action</th>
                  <th className="py-2.5 pl-3 font-semibold text-right">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.length > 0 ? (
                  filteredLogs.slice(0, 25).map((log) => {
                    const outcome =
                      log.outcome ||
                      (/FAILED|BLOCKED|DENIED|REJECTED/i.test(log.action) ? "denied" : "success");
                    return (
                      <tr
                        key={log.id}
                        title={`Correlation ID: ${log.correlation_id || log.id} · Target: ${log.entity_id} · Timestamp: ${log.created_at}`}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="py-3 pr-3 font-mono text-slate-600 tabular-nums whitespace-nowrap">
                          {formatShortTime(log.created_at)}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-800 whitespace-nowrap">
                          {log.user_id}
                        </td>
                        <td className="py-3 px-3 text-slate-900 font-medium">
                          <div className="truncate max-w-[200px]">{log.action}</div>
                        </td>
                        <td className="py-3 pl-3 text-right">
                          <span
                            className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded ${
                              outcome === "denied"
                                ? "bg-rose-50 text-rose-700"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {outcome}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500">
                      No audit events match the active filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="pt-2 border-t border-slate-100 text-xs text-slate-500">
            Each event carries a correlation ID. Passwords and tokens are never logged.
          </p>
        </div>

        {/* Right Card: Security Sandbox (Live Guardrail Verification) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1D63ED]" />
              <span>Security sandbox</span>
            </h2>
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              Doc #{activeDocumentId}
            </span>
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
                {sandboxChecks.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 pr-3 font-mono text-slate-800">{item.input}</td>
                    <td className="py-3 px-3 text-slate-600">{item.expected}</td>
                    <td className="py-3 pl-3 text-right">
                      {item.status === "PENDING" ? (
                        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-500">
                          RUNNING
                        </span>
                      ) : item.status === "PASS" ? (
                        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                          PASS
                        </span>
                      ) : (
                        <span className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded bg-rose-50 text-rose-700">
                          FAIL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="pt-2 border-t border-slate-100 text-xs text-slate-500">
            Executes live API probes against Cypher sanitization, auth enforcement, and document isolation boundaries.
          </p>
        </div>
      </div>
    </div>
  );
};
