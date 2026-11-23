import React, { useState, useEffect } from "react";
import { User } from "./types";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { OverviewPage } from "./pages/OverviewPage";
import { AIAnalystPage } from "./pages/AIAnalystPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GraphExplorerPage } from "./pages/GraphExplorerPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { ReportsPage } from "./pages/ReportsPage";
import { HistoryPage } from "./pages/HistoryPage";
import { SecuritySandboxPage } from "./pages/SecuritySandboxPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { UserPlus, LogIn, Lock, CheckCircle2 } from "lucide-react";

export default function App() {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = localStorage.getItem("decision_intel_user");
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn("Could not parse saved user session:", e);
    }
    return null;
  });

  const [activeTab, setActiveTab] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("decision_intel_user");
      if (saved) return "ai-analyst";
    } catch {}
    return "login";
  });

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sharedEmail, setSharedEmail] = useState<string>("");
  const [documents, setDocuments] = useState<any[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<number>(() => {
    const saved = localStorage.getItem("active_target_document_id");
    return saved && !Number.isNaN(Number(saved)) ? Number(saved) : 201;
  });
  const [uploadedOnly, setUploadedOnly] = useState<boolean>(() => {
    return localStorage.getItem("uploaded_only_mode") === "true";
  });

  const refreshDocuments = async (preferredDocId?: number, forceUploadedOnly?: boolean) => {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      const docs: any[] = data.documents || [];
      setDocuments(docs);

      if (docs.length === 0) return;

      const uploadedDocs = docs.filter((d) => d.is_uploaded);
      const nextUploadedOnly =
        forceUploadedOnly !== undefined
          ? forceUploadedOnly
          : uploadedDocs.length > 0 && localStorage.getItem("uploaded_only_mode") !== "false";

      if (
        uploadedDocs.length > 0 &&
        forceUploadedOnly === undefined &&
        localStorage.getItem("uploaded_only_mode") === null
      ) {
        setUploadedOnly(true);
        localStorage.setItem("uploaded_only_mode", "true");
      } else if (forceUploadedOnly !== undefined) {
        setUploadedOnly(forceUploadedOnly);
        localStorage.setItem("uploaded_only_mode", String(forceUploadedOnly));
      }

      const pool = nextUploadedOnly && uploadedDocs.length > 0 ? uploadedDocs : docs;
      if (preferredDocId !== undefined && docs.some((d) => d.id === preferredDocId)) {
        setActiveDocumentId(preferredDocId);
        localStorage.setItem("active_target_document_id", String(preferredDocId));
        return;
      }

      setActiveDocumentId((prev) => {
        if (pool.some((d) => d.id === prev)) return prev;
        const fallback =
          uploadedDocs[0]?.id ||
          docs.find((d) => d.id === 201)?.id ||
          docs[0].id;
        localStorage.setItem("active_target_document_id", String(fallback));
        return fallback;
      });
    } catch (err) {
      console.error("Failed to fetch documents:", err);
    }
  };

  useEffect(() => {
    refreshDocuments();
  }, []);

  const handleSelectDocument = (docId: number) => {
    setActiveDocumentId(docId);
    localStorage.setItem("active_target_document_id", String(docId));
  };

  const handleToggleUploadedOnly = (nextVal: boolean) => {
    setUploadedOnly(nextVal);
    localStorage.setItem("uploaded_only_mode", String(nextVal));
    if (nextVal) {
      const uploadedDocs = documents.filter((d) => d.is_uploaded);
      if (uploadedDocs.length > 0 && !uploadedDocs.some((d) => d.id === activeDocumentId)) {
        handleSelectDocument(uploadedDocs[0].id);
      }
    }
  };

  const handleDocumentUploaded = async (docId: number) => {
    localStorage.setItem("active_target_document_id", String(docId));
    localStorage.setItem("uploaded_only_mode", "true");
    setActiveDocumentId(docId);
    setUploadedOnly(true);
    await refreshDocuments(docId, true);
  };

  const hasUploadedDocs = documents.some((d) => d.is_uploaded);
  const scopedDocuments = uploadedOnly && hasUploadedDocs ? documents.filter((d) => d.is_uploaded) : documents;

  useEffect(() => {
    if (user) {
      localStorage.setItem("decision_intel_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("decision_intel_user");
    }
  }, [user]);

  const handleLoginSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setActiveTab("ai-analyst");
  };

  const handleRegisterSuccess = (registeredUser: User) => {
    setUser(registeredUser);
    setActiveTab("ai-analyst");
  };

  const handleNavigateToRegister = (prefillEmail?: string) => {
    if (prefillEmail) setSharedEmail(prefillEmail);
    setActiveTab("register");
  };

  const handleNavigateToLogin = (prefillEmail?: string) => {
    if (prefillEmail) setSharedEmail(prefillEmail);
    setActiveTab("login");
  };

  const handleLogout = async () => {
    if (user) {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: user.id })
        });
      } catch (err) {
        console.error("Logout notification error:", err);
      }
    }
    setUser(null);
    setActiveTab("login");
  };

  const isProtectedTab = activeTab !== "login" && activeTab !== "register";

  if (activeTab === "login") {
    return (
      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        onNavigateToRegister={handleNavigateToRegister}
        initialEmail={sharedEmail}
        onBackToWorkspace={user ? () => setActiveTab("ai-analyst") : undefined}
      />
    );
  }

  if (activeTab === "register") {
    return (
      <RegisterPage
        onRegisterSuccess={handleRegisterSuccess}
        onNavigateToLogin={handleNavigateToLogin}
        prefillEmail={sharedEmail}
        onBackToWorkspace={user ? () => setActiveTab("ai-analyst") : undefined}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7FA] text-slate-900 font-sans antialiased flex">
      {/* Dark Navy Left Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        onLogout={handleLogout}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Right Main Area: White TopBar + Light Workspace */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        <TopBar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          user={user}
          setUser={setUser}
          documents={scopedDocuments}
          activeDocumentId={activeDocumentId}
          onSelectDocument={handleSelectDocument}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8">

          {isProtectedTab && !user && (
            <div className="max-w-2xl mx-auto py-12 text-center">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-8 sm:p-10 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                <div className="w-14 h-14 rounded-xl bg-blue-50 border border-blue-200 text-[#1D63ED] flex items-center justify-center mx-auto mb-4">
                  <Lock className="w-7 h-7" />
                </div>

                <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-mono px-3 py-0.5 rounded font-semibold uppercase tracking-wider">
                  Registration Required · Access Restricted
                </span>

                <h2 className="text-2xl font-bold text-slate-900 mt-4">
                  Enterprise Authentication Required
                </h2>
                <p className="text-sm text-slate-600 max-w-lg mx-auto mt-2 leading-relaxed">
                  Register an enterprise identity profile or sign in with existing credentials to access the Decision Intelligence workspace.
                </p>

                <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab("register")}
                    className="w-full sm:w-auto bg-[#1D63ED] hover:bg-[#1554D1] text-white font-semibold text-sm px-6 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Register New Account</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab("login")}
                    className="w-full sm:w-auto bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 border border-slate-200"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Sign In</span>
                  </button>
                </div>

                <div className="mt-8 pt-5 border-t border-slate-100 text-xs text-slate-500 font-mono flex flex-wrap items-center justify-center gap-5">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Read-Only SQL Role</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>MATCH-Only Cypher</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Audit Trail Enforced</span>
                  </span>
                </div>
              </div>
            </div>
          )}

          {user && (
            <>
              {activeTab === "overview" && (
                <OverviewPage
                  documents={scopedDocuments}
                  activeDocumentId={activeDocumentId}
                  onSelectDocument={handleSelectDocument}
                  onNavigate={setActiveTab}
                />
              )}
              {activeTab === "ai-analyst" && (
                <AIAnalystPage
                  documents={scopedDocuments}
                  allDocuments={documents}
                  activeDocumentId={activeDocumentId}
                  onSelectDocument={handleSelectDocument}
                  uploadedOnly={uploadedOnly}
                  hasUploadedDocs={hasUploadedDocs}
                  onToggleUploadedOnly={handleToggleUploadedOnly}
                  onNavigateToDataSources={() => setActiveTab("data-sources")}
                />
              )}
              {activeTab === "dashboard" && (
                <DashboardPage
                  documents={scopedDocuments}
                  activeDocumentId={activeDocumentId}
                  onSelectDocument={handleSelectDocument}
                  uploadedOnly={uploadedOnly}
                  hasUploadedDocs={hasUploadedDocs}
                  onToggleUploadedOnly={handleToggleUploadedOnly}
                  onNavigateToDataSources={() => setActiveTab("data-sources")}
                />
              )}
              {activeTab === "graph-explorer" && (
                <GraphExplorerPage
                  documents={scopedDocuments}
                  activeDocumentId={activeDocumentId}
                  onSelectDocument={handleSelectDocument}
                  uploadedOnly={uploadedOnly}
                  hasUploadedDocs={hasUploadedDocs}
                  onToggleUploadedOnly={handleToggleUploadedOnly}
                />
              )}
              {activeTab === "data-sources" && (
                <DataSourcesPage
                  user={user}
                  activeDocumentId={activeDocumentId}
                  uploadedOnly={uploadedOnly}
                  hasUploadedDocs={hasUploadedDocs}
                  onToggleUploadedOnly={handleToggleUploadedOnly}
                  onSelectDocument={handleSelectDocument}
                  onDocumentUploaded={handleDocumentUploaded}
                  onNavigateToAnalyst={() => setActiveTab("ai-analyst")}
                  onNavigateToDashboard={() => setActiveTab("dashboard")}
                  onNavigateToGraph={() => setActiveTab("graph-explorer")}
                  onNavigateToReports={() => setActiveTab("reports")}
                />
              )}
              {activeTab === "reports" && (
                <ReportsPage
                  user={user}
                  documents={scopedDocuments}
                  activeDocumentId={activeDocumentId}
                  onSelectDocument={handleSelectDocument}
                  uploadedOnly={uploadedOnly}
                  hasUploadedDocs={hasUploadedDocs}
                  onToggleUploadedOnly={handleToggleUploadedOnly}
                  onNavigateToDataSources={() => setActiveTab("data-sources")}
                  onNavigateToAnalyst={() => setActiveTab("ai-analyst")}
                />
              )}
              {activeTab === "history" && <HistoryPage activeDocumentId={activeDocumentId} />}
              {activeTab === "security-sandbox" && <SecuritySandboxPage activeDocumentId={activeDocumentId} />}
              {activeTab === "users" && (
                <UserManagementPage
                  user={user}
                  setUser={setUser}
                  onNavigateToRegister={() => setActiveTab("register")}
                  onNavigateToLogin={() => setActiveTab("login")}
                  onLogout={handleLogout}
                />
              )}
              {activeTab === "settings" && <SettingsPage activeDocumentId={activeDocumentId} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
