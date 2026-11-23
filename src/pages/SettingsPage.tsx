import React, { useState } from "react";
import { ShieldCheck, Terminal } from "lucide-react";

interface SettingsPageProps {
  activeDocumentId?: number;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ activeDocumentId = 201 }) => {
  const [testQuery, setTestQuery] = useState("DROP TABLE sales; SELECT * FROM users;");
  const [testResult, setTestResult] = useState<any>(null);

  const handleTestInjection = async () => {
    try {
      const res = await fetch("/api/graph/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cypher: testQuery, document_id: activeDocumentId })
      });
      const data = await res.json();
      setTestResult({ status: res.status, data });
    } catch (err: any) {
      setTestResult({ status: 500, error: err.message });
    }
  };

  const securityChecklist = [
    { rule: "Read-Only DB Roles", status: "ENFORCED", desc: "SQL Agent queries go through a read-only database role." },
    { rule: "Read-Only Cypher User", status: "ENFORCED", desc: "Neo4j driver restricts execution to MATCH read queries only." },
    { rule: "SQL & Cypher Guardrails", status: "ENFORCED", desc: "Rejects multi-statement chaining and mutating keywords." },
    {
      rule: "Computed Confidence",
      status: "ENFORCED",
      desc: "7-factor deterministic Critic formula (0.20R + 0.20C + 0.15P + 0.15N + 0.10E + 0.10V + 0.10A)."
    },
    { rule: "Prompt Injection Defense", status: "ENFORCED", desc: "Sanitizes instruction-like payloads inside uploaded files before indexing." },
    { rule: "Password Hashing & Registration Gate", status: "ENFORCED", desc: "Server-side account registration and verification enforced before access." },
    { rule: "RBAC Role Access", status: "ENFORCED", desc: "Admin, Analyst, and Viewer permissions enforced across workspace actions." }
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <p className="text-xs sm:text-sm text-slate-500">
        Read-only database policies, prompt-injection safeguards, and deterministic Critic scoring configuration.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Security Checklist */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
            <ShieldCheck className="w-4.5 h-4.5 text-emerald-600" />
            <span>Platform Security Checklist</span>
          </h3>

          <div className="space-y-2.5">
            {securityChecklist.map((item, idx) => (
              <div
                key={idx}
                className="bg-slate-50/70 p-3.5 rounded-xl border border-slate-200 flex justify-between items-center gap-3 text-xs"
              >
                <div>
                  <span className="font-bold text-slate-900 block">{item.rule}</span>
                  <span className="text-xs text-slate-500">{item.desc}</span>
                </div>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded font-mono shrink-0">
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Injection Defense Sandbox */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Terminal className="w-4.5 h-4.5 text-rose-600" />
              <span>Guardrail Sanitizer Tester</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Test destructive SQL or Cypher syntax against the backend sanitizer to confirm mutating statements are rejected before execution.
            </p>

            <textarea
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              rows={4}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 font-mono text-xs text-rose-700 focus:outline-none focus:bg-white focus:border-rose-400 mb-3"
            />

            <button
              type="button"
              onClick={handleTestInjection}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs py-2.5 rounded-lg transition-colors"
            >
              Test Guardrail Rejection
            </button>

            {testResult && (
              <div className="mt-4 p-3.5 bg-rose-50/70 border border-rose-200 rounded-xl font-mono text-xs">
                <span className="text-rose-800 font-bold block mb-1">
                  Guardrail Response (HTTP {testResult.status})
                </span>
                <pre className="text-[11px] text-slate-700 whitespace-pre-wrap">
                  {JSON.stringify(testResult.data, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-500 font-mono">
            Read-only execution enforced across SQLite/Postgres and Cypher query layers.
          </div>
        </div>
      </div>
    </div>
  );
};
