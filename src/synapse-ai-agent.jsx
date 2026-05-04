import React, { useState, useEffect, useCallback } from "react";
import { Mail, ShieldAlert, Zap, LayoutDashboard, CheckCircle2, AlertTriangle, AlertOctagon, ArrowRight, Activity, Inbox, Sun, Moon, X, Search, Sparkles, Plus } from "lucide-react";

/* ---- Toast System ---- */
function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type} ${t.exiting ? "toast-exit" : ""}`}>
          {t.type === "success" && <CheckCircle2 size={18} />}
          {t.type === "error" && <AlertOctagon size={18} />}
          {t.type === "info" && <Activity size={18} />}
          <span style={{ flex: 1 }}>{t.message}</span>
          <X size={16} style={{ cursor: "pointer", opacity: 0.6 }} onClick={() => removeToast(t.id)} />
        </div>
      ))}
    </div>
  );
}

export default function SynapseAgent() {
  const [emails, setEmails] = useState([]);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [userProfile, setUserProfile] = useState(null);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [activePage, setActivePage] = useState("dashboard"); // dashboard, preferences, previews
  const [accountStats, setAccountStats] = useState({ vectorCount: 0 });
  const [settings, setSettings] = useState({ compactMode: false, deepScan: false });
  const [accounts, setAccounts] = useState(() => {
    const saved = localStorage.getItem("synapse_accounts");
    return saved ? JSON.parse(saved) : [];
  });
  const [connected, setConnected] = useState(false);
  const [risk, setRisk] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [analyzingTasks, setAnalyzingTasks] = useState(false);
  const [analyzingPhishing, setAnalyzingPhishing] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("synapse-theme") || "dark");
  const [toasts, setToasts] = useState([]);

  // Floating Chat State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState([
    { role: 'ai', content: "Hi! I'm Synapse AI, your smart inbox assistant. What can I help you find today?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // Theme effect
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("synapse-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === "dark" ? "light" : "dark");

  // Toast helper
  const showToast = useCallback((message, type = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, exiting: false }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
    }, 3500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
  }, []);

  const connectGmail = () => {
    window.location.href = "http://localhost:5000/auth/google";
  };

  async function handleLogout() {
    try {
      await fetch("http://localhost:5000/auth/logout", { method: "POST", credentials: "include" });
      setUserProfile(null);
      setConnected(false);
      setEmails([]);
      setTasks([]);
      showToast("Logged out successfully");
    } catch {
      showToast("Failed to logout", "error");
    }
  }

  async function checkProfile() {
    try {
      const res = await fetch("http://localhost:5000/api/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUserProfile(data);
        
        // Update local accounts list
        setAccounts(prev => {
          const exists = prev.find(acc => acc.email === data.email);
          if (exists) return prev;
          const newList = [...prev, { name: data.name, email: data.email }];
          localStorage.setItem("synapse_accounts", JSON.stringify(newList));
          return newList;
        });
        
        return true;
      }
    } catch (e) {
      console.error(e);
    }
    return false;
  }

  async function fetchStats() {
    try {
      const res = await fetch("http://localhost:5000/api/stats", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAccountStats(data);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function clearData() {
    if (!window.confirm("Are you sure? This will wipe all AI memory for your account.")) return;
    try {
      const res = await fetch("http://localhost:5000/api/clear-vectors", { method: "POST", credentials: "include" });
      if (res.ok) {
        showToast("AI Memory Wiped", "success");
        setAccountStats({ vectorCount: 0 });
      }
    } catch (e) {
      showToast("Failed to clear data", "error");
    }
  }

  function switchAccount(email) {
    if (email === userProfile?.email) return;
    showToast(`Switching to ${email}...`, "info");
    // Standard logout then auto-re-auth with hint
    fetch("http://localhost:5000/auth/logout", { method: "POST", credentials: "include" })
      .finally(() => {
        window.location.href = `http://localhost:5000/auth/google?hint=${encodeURIComponent(email)}`;
      });
  }

  async function loadEmails() {
    try {
      const res = await fetch("http://localhost:5000/emails", { credentials: "include" });
      if (res.status === 401) {
        setConnected(false);
        return;
      }
      const data = await res.json();
      setEmails(data);
      setConnected(true);
    } catch (err) {
      console.log(err);
    }
  }

  useEffect(() => {
    // Check if we are logged in, then load emails
    checkProfile().then(isLoggedIn => {
      if (isLoggedIn) loadEmails();
    });
  }, []);

  async function analyzeEmails() {
    setAnalyzingTasks(true);
    showToast("Extracting tasks from your inbox...", "info");
    try {
      const res = await fetch("http://localhost:5000/api/analyze-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ emails })
      });
      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();
      setTasks(data);
      const high = data.filter(t => t.priority === "HIGH").length;
      showToast(`Extracted ${data.length} tasks — ${high} high priority`, "success");
    } catch (err) {
      console.log(err);
      showToast("Task extraction failed. Check backend connection.", "error");
    } finally {
      setAnalyzingTasks(false);
    }
  }

  async function detectPhishing() {
    if (!selectedEmail) {
      showToast("Select an email from the inbox first!", "error");
      return;
    }
    setAnalyzingPhishing(true);
    setRisk(null);
    setReasons([]);
    showToast("Scanning email for threats...", "info");
    
    try {
      const res = await fetch("http://localhost:5000/api/detect-phishing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: selectedEmail, deepScan: settings.deepScan })
      });
      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();
      setRisk(data.riskLevel);
      setReasons(data.reasons || []);
      const toastType = data.riskLevel === "HIGH" ? "error" : (data.riskLevel === "MEDIUM" ? "info" : "success");
      showToast(`Security audit complete: ${data.riskLevel} risk`, toastType);
    } catch (err) {
      console.log(err);
      showToast("Phishing scan failed. Check backend.", "error");
    } finally {
      setAnalyzingPhishing(false);
    }
  }

  async function performRagChat(e) {
    if (e) e.preventDefault();
    if (!chatInput.trim()) return;

    const userQuery = chatInput.trim();
    setChatHistory(prev => [...prev, { role: 'user', content: userQuery }]);
    setChatInput("");
    setIsSearching(true);

    try {
      const res = await fetch("http://localhost:5000/api/rag-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: userQuery, emails })
      });
      if (!res.ok) throw new Error("Backend error");
      const data = await res.json();
      
      setChatHistory(prev => [
        ...prev, 
        { role: 'ai', content: data.answer, sources: data.sources || [] }
      ]);
    } catch (err) {
      console.log(err);
      setChatHistory(prev => [
        ...prev, 
        { role: 'ai', content: "Sorry, I couldn't connect to the server. Please make sure the backend is running.", isError: true }
      ]);
    } finally {
      setIsSearching(false);
    }
  }

  const highPriorityCount = tasks.filter(t => t.priority === "HIGH").length;
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const sortedTasks = [...tasks].sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  
  if (!connected) {
    return (
      <>
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        <div style={{ height: "100vh", display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column", position: "relative" }}>
          <div className="glow glow1"></div>
          <div className="glow glow2"></div>
          
          <div style={{ position: "absolute", top: "24px", right: "24px", zIndex: 10, display: "flex", gap: "10px", alignItems: "center" }}>
            <div className={`theme-toggle ${theme === "light" ? "light" : ""}`} onClick={toggleTheme}>
              <div className="theme-toggle-knob">
                {theme === "dark" ? <Moon size={10} color="white" /> : <Sun size={10} color="white" />}
              </div>
            </div>
            {userProfile && (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--card-bg)", padding: "6px 12px", borderRadius: "30px", border: "1px solid var(--border-color)", cursor: "pointer" }} onClick={handleLogout} title="Click to Logout">
                <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: "var(--accent-primary)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "12px" }}>
                  {userProfile.name?.charAt(0) || "U"}
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "13px", fontWeight: "600", lineHeight: "1" }}>{userProfile.name}</span>
                  <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>Logout</span>
                </div>
              </div>
            )}
          </div>

          <div style={{ position: "absolute", fontSize: "200px", fontWeight: 900, color: "rgba(255,255,255,0.02)", top: "15%" }}>SYNAPSE</div>
          <div style={{ position: "absolute", fontSize: "150px", fontWeight: 900, color: "rgba(255,255,255,0.01)", bottom: "5%" }}>AI</div>
          
          <h1 style={{ fontSize: "70px", fontWeight: 900, zIndex: 2, marginBottom: "20px", display: "flex", alignItems: "center", gap: "20px" }}>
            <Zap size={60} color="#6366f1" /> SynapseAI
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "18px", marginBottom: "40px", zIndex: 2 }}>Intelligent Email Analysis & Task Extraction</p>
          
          <button onClick={connectGmail} className="button-gradient" style={{ padding: "16px 40px", fontSize: "16px", display: "flex", alignItems: "center", gap: "12px" }}>
            <Mail size={20} /> Sign in with Google <ArrowRight size={20} />
          </button>
        </div>
      </>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg-color)", position: "relative", overflow: "hidden" }}>
        <ToastContainer toasts={toasts} removeToast={removeToast} />
        
        {/* SAAS SIDEBAR */}
        <div style={{ 
          width: isProfileOpen ? "280px" : "0", 
          opacity: isProfileOpen ? 1 : 0,
          borderRight: isProfileOpen ? "1px solid var(--border-color)" : "none",
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          background: "var(--panel-bg)",
          backdropFilter: "blur(20px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          zIndex: 100
        }}>
          {userProfile && (
            <>
              <div style={{ padding: "30px 24px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "linear-gradient(135deg, #6366f1, #a855f7)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: "18px" }}>
                    {userProfile.name?.charAt(0)}
                  </div>
                  <div style={{ overflow: "hidden" }}>
                    <div style={{ fontWeight: "700", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{userProfile.name}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{userProfile.email}</div>
                  </div>
                </div>
              </div>

              <div style={{ padding: "20px 10px", flex: 1, overflowY: "auto" }}>
                <div style={{ padding: "0 16px 10px 16px", fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>Main Menu</div>
                
                <div className="dropdown-item" onClick={() => { setActivePage("dashboard"); setIsProfileOpen(false); }} style={{ padding: "12px 16px", borderRadius: "10px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", color: activePage === "dashboard" ? "var(--accent-primary)" : "var(--text-color)", background: activePage === "dashboard" ? "rgba(99, 102, 241, 0.1)" : "transparent" }}>
                  <LayoutDashboard size={18} /> Dashboard
                </div>
                <div className="dropdown-item" onClick={() => { setActivePage("preferences"); setIsProfileOpen(false); fetchStats(); }} style={{ padding: "12px 16px", borderRadius: "10px", marginTop: "4px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", color: activePage === "preferences" ? "var(--accent-primary)" : "var(--text-color)", background: activePage === "preferences" ? "rgba(99, 102, 241, 0.1)" : "transparent" }}>
                  <Activity size={18} /> Account Preferences
                </div>
                <div className="dropdown-item" onClick={() => { setActivePage("previews"); setIsProfileOpen(false); }} style={{ padding: "12px 16px", borderRadius: "10px", marginTop: "4px", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", color: activePage === "previews" ? "var(--accent-primary)" : "var(--text-color)", background: activePage === "previews" ? "rgba(99, 102, 241, 0.1)" : "transparent" }}>
                  <Sparkles size={18} /> Feature Previews
                </div>

                <div style={{ margin: "24px 0 10px 16px", fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>Synced Accounts</div>
                
                {accounts.map(acc => (
                  <div 
                    key={acc.email} 
                    onClick={() => switchAccount(acc.email)}
                    style={{ 
                      padding: "10px 16px", 
                      borderRadius: "10px", 
                      marginBottom: "4px", 
                      cursor: "pointer", 
                      display: "flex", 
                      alignItems: "center", 
                      gap: "10px",
                      background: acc.email === userProfile?.email ? "rgba(255,255,255,0.03)" : "transparent",
                      border: acc.email === userProfile?.email ? "1px solid rgba(255,255,255,0.05)" : "1px solid transparent",
                      opacity: acc.email === userProfile?.email ? 1 : 0.7
                    }}
                    className="dropdown-item"
                  >
                    <div style={{ width: "24px", height: "24px", borderRadius: "8px", background: "rgba(99, 102, 241, 0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", color: "var(--accent-primary)", fontWeight: "bold" }}>
                      {acc.name?.charAt(0) || "U"}
                    </div>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{ fontSize: "12px", fontWeight: "600", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{acc.email}</div>
                      {acc.email === userProfile?.email && <div style={{ fontSize: "10px", color: "var(--accent-success)" }}>Active</div>}
                    </div>
                  </div>
                ))}

                <button 
                  onClick={() => window.location.href = "http://localhost:5000/auth/google"}
                  style={{ width: "100%", marginTop: "10px", background: "none", border: "1px dashed var(--border-color)", borderRadius: "10px", color: "var(--text-muted)", padding: "10px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", fontSize: "12px" }}
                >
                  <Plus size={14} /> Add Another Account
                </button>
              </div>

              <div style={{ padding: "20px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <div className="dropdown-item" onClick={toggleTheme} style={{ padding: "10px 16px", borderRadius: "8px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />} Theme
                  </div>
                  <span style={{ fontSize: "11px", opacity: 0.5 }}>{theme}</span>
                </div>
                <div className="dropdown-item" onClick={handleLogout} style={{ padding: "10px 16px", borderRadius: "8px", marginTop: "8px", cursor: "pointer", display: "flex", alignItems: "center", gap: "10px", color: "#ef4444" }}>
                  <ArrowRight size={16} /> Log out
                </div>
              </div>
            </>
          )}
        </div>

        {/* MAIN APPLICATION CONTENT */}
        <div style={{ 
          flex: 1, 
          position: "relative", 
          zIndex: 1, 
          transition: "all 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
          background: "var(--bg-color)"
        }}>
          <div className="glow glow1"></div>
          <div className="glow glow2"></div>

          {/* TOP-LEFT AVATAR TRIGGER */}
          <div 
            onClick={() => setIsProfileOpen(!isProfileOpen)}
            style={{ 
              position: "absolute", 
              top: "24px", 
              left: "24px", 
              zIndex: 150, 
              cursor: "pointer",
              transition: "transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)"
            }}
            className="profile-widget"
          >
            <div style={{ 
              width: "42px", 
              height: "42px", 
              borderRadius: "14px", 
              background: "linear-gradient(135deg, #6366f1, #a855f7)", 
              color: "white", 
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center", 
              fontWeight: "bold", 
              fontSize: "18px", 
              boxShadow: "0 4px 15px rgba(99, 102, 241, 0.4)",
              border: "2px solid rgba(255,255,255,0.1)",
              transform: isProfileOpen ? "rotate(90deg)" : "none"
            }}>
              {isProfileOpen ? <X size={20} /> : (userProfile?.name?.charAt(0) || "U")}
            </div>
          </div>

      <div className="dashboard-layout glass-panel" style={{ 
        padding: settings.compactMode ? "10px" : "24px", 
        gap: settings.compactMode ? "10px" : "24px" 
      }}>
        
        {activePage === "dashboard" ? (
          <>
            {/* SIDEBAR: INBOX */}
            <div className="sidebar glass-panel">
              <div style={{ padding: settings.compactMode ? "12px" : "24px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "10px" }}>
                <Inbox size={24} color="var(--accent-primary)" />
                <h2 style={{ fontSize: settings.compactMode ? "16px" : "18px", fontWeight: "600" }}>Live Inbox</h2>
                <span className="badge badge-low" style={{ marginLeft: "auto" }}>{emails.length} Mails</span>
              </div>

              <div style={{ overflowY: "auto", flex: 1, padding: "12px" }}>
                {emails.map(email => (
                  <div
                    key={email.id}
                    onClick={() => { setSelectedEmail(email); setRisk(null); setReasons([]); }}
                    className="animate-in"
                    style={{
                      padding: settings.compactMode ? "10px" : "16px",
                      borderRadius: "12px",
                      cursor: "pointer",
                      marginBottom: "8px",
                      background: selectedEmail?.id === email.id ? "rgba(99, 102, 241, 0.15)" : "var(--card-bg)",
                      border: `1px solid ${selectedEmail?.id === email.id ? "rgba(99, 102, 241, 0.4)" : "var(--border-color)"}`,
                      transition: "all 0.2s ease"
                    }}
                  >
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Mail size={14} /> {email.from.split("<")[0] || email.from}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: settings.compactMode ? "13px" : "14px", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                      {email.subject}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="main-content">
              {/* HEADER & METRICS */}
              <div style={{ padding: "30px", borderBottom: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "30px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <LayoutDashboard size={28} color="var(--accent-primary)" />
                    <h1 style={{ fontSize: "24px", fontWeight: "700" }}>Intelligence Dashboard</h1>
                  </div>
                  <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                    <button onClick={analyzeEmails} className="button-gradient" disabled={analyzingTasks} title="Fast Scan: Quickly extracts obvious tasks and deadlines from the inbox.">
                      <Activity size={18} /> {analyzingTasks ? "Analyzing..." : "Extract Tasks (Fast Scan)"}
                    </button>
                    <button onClick={detectPhishing} className="button-danger" disabled={!selectedEmail || analyzingPhishing}>
                      <ShieldAlert size={18} /> {analyzingPhishing ? "Scanning..." : "Audit Phishing"}
                    </button>
                  </div>
                </div>

                {/* METRICS CARDS */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
                  <div className="glass-card">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-muted)", marginBottom: "12px" }}>
                      <Mail size={18} /> Total Extracted Tasks
                    </div>
                    <div style={{ fontSize: "36px", fontWeight: "700" }}>{tasks.length}</div>
                  </div>
                  <div className="glass-card">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-muted)", marginBottom: "12px" }}>
                      <AlertTriangle size={18} color="var(--accent-danger)" /> High Priority
                    </div>
                    <div style={{ fontSize: "36px", fontWeight: "700", color: "var(--accent-danger)" }}>{highPriorityCount}</div>
                  </div>
                  <div className="glass-card">
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-muted)", marginBottom: "12px" }}>
                      <ShieldAlert size={18} color="var(--accent-warning)" /> Threat Level
                    </div>
                    <div style={{ fontSize: "36px", fontWeight: "700", color: risk === "HIGH" ? "var(--accent-danger)" : (risk === "MEDIUM" ? "var(--accent-warning)" : "var(--accent-success)") }}>
                      {risk || "N/A"}
                    </div>
                  </div>
                </div>
              </div>

              {/* LOWER CONTENT (Split Panes) */}
              <div style={{ display: "flex", flex: 1, minHeight: "600px", overflow: "hidden" }}>
                
                {/* VIEW PANE (Email + Phishing Results) */}
                <div style={{ flex: 1, padding: "30px", overflowY: "auto", borderRight: "1px solid var(--border-color)" }}>
                  <h3 style={{ fontSize: "16px", color: "var(--text-muted)", marginBottom: "20px", textTransform: "uppercase", letterSpacing: "1px" }}>Workspace Content</h3>
                  
                  {selectedEmail ? (
                    <div className="animate-in">
                      <div className="glass-card" style={{ marginBottom: "24px" }}>
                        <h2 style={{ fontSize: "20px", marginBottom: "10px" }}>{selectedEmail.subject}</h2>
                        <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "20px" }}>From: {selectedEmail.from}</p>
                        <div style={{ padding: "20px", background: "var(--email-body-bg)", borderRadius: "8px", fontSize: "15px", lineHeight: "1.6" }}>
                          {selectedEmail.preview}
                        </div>
                      </div>

                      {risk && (
                        <div className="glass-card animate-in" style={{ borderLeft: `4px solid ${risk === "HIGH" ? "var(--accent-danger)" : risk === "MEDIUM" ? "var(--accent-warning)" : "var(--accent-success)"}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                            {risk === "HIGH" ? <AlertOctagon color="var(--accent-danger)" size={24} /> : (risk === "MEDIUM" ? <AlertTriangle color="var(--accent-warning)" size={24} /> : <CheckCircle2 color="var(--accent-success)" size={24} />)}
                            <h3 style={{ fontSize: "18px", margin: 0 }}>Security Audit: {risk} RISK</h3>
                          </div>
                          {reasons.length > 0 ? (
                            <ul style={{ paddingLeft: "30px", color: "var(--text-muted)", lineHeight: "1.8" }}>
                              {reasons.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                          ) : (
                            <p style={{ color: "var(--text-muted)" }}>This communication appears fully secure and authentic.</p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="glass-card" style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                      <Mail size={48} style={{ opacity: 0.2, margin: "0 auto 20px auto" }} />
                      <p>Select an email from the live inbox to view intelligence details.</p>
                    </div>
                  )}
                </div>

                {/* EXTRACTED TASKS PANE */}
                <div style={{ width: "400px", padding: "30px", overflowY: "auto", background: "rgba(2, 6, 23, 0.4)" }}>
                  <h3 style={{ fontSize: "16px", color: "var(--text-muted)", marginBottom: "20px", textTransform: "uppercase", letterSpacing: "1px", display: "flex", alignItems: "center", gap: "10px" }}>
                    <CheckCircle2 size={16} /> Extracted Actionables
                  </h3>

                  {tasks.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                      {sortedTasks.map((task, i) => (
                        <div key={i} className="glass-card animate-in" style={{ padding: "20px", background: "var(--card-bg)" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                            <span className={`badge badge-${task.priority.toLowerCase()}`}>
                              {task.priority === "HIGH" && <AlertOctagon size={10} />}
                              {task.priority === "MEDIUM" && <AlertTriangle size={10} />}
                              {task.priority === "LOW" && <Zap size={10} />}
                              {task.priority}
                            </span>
                          </div>
                          <div style={{ fontSize: "15px", fontWeight: "500", lineHeight: "1.5", marginBottom: "16px" }}>
                            {task.title}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "6px" }}>
                            <ArrowRight size={12} /> Source: {task.from.split("<")[0]}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="glass-card" style={{ textAlign: "center", padding: "60px 20px", color: "var(--text-muted)" }}>
                      <CheckCircle2 size={48} style={{ opacity: 0.2, margin: "0 auto 20px auto" }} />
                      <p>Click "Extract Tasks" to process your inbox using Llama 3.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : activePage === "preferences" ? (
          <div style={{ flex: 1, padding: "40px", maxWidth: "800px", margin: "0 auto" }} className="animate-in">
            <button onClick={() => setActivePage("dashboard")} style={{ background: "none", border: "none", color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "30px", fontWeight: "600" }}>
              <ArrowRight size={20} style={{ transform: "rotate(180deg)" }} /> Back to Dashboard
            </button>
            <h1 style={{ fontSize: "32px", fontWeight: "800", marginBottom: "10px" }}>Account Preferences</h1>
            <p style={{ color: "var(--text-muted)", marginBottom: "40px" }}>Manage your profile and AI memory storage.</p>

            <div className="glass-panel" style={{ padding: "30px", marginBottom: "30px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: "linear-gradient(135deg, #6366f1, #a855f7)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "32px", fontWeight: "bold" }}>
                  {userProfile?.name?.charAt(0)}
                </div>
                <div>
                  <h2 style={{ fontSize: "24px", fontWeight: "700" }}>{userProfile?.name}</h2>
                  <p style={{ color: "var(--text-muted)" }}>{userProfile?.email}</p>
                </div>
              </div>
            </div>

            <div className="glass-panel" style={{ padding: "30px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "600", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}>
                <Activity size={20} color="var(--accent-primary)" /> AI Vector Memory
              </h3>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.03)", padding: "20px", borderRadius: "12px", border: "1px solid var(--border-color)" }}>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--accent-primary)" }}>{accountStats.vectorCount}</div>
                  <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>Emails currently embedded in Supabase</div>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                  <button onClick={() => showToast("Ask your first question in the floating chat to start embedding!", "info")} style={{ background: "rgba(99, 102, 241, 0.1)", color: "var(--accent-primary)", border: "1px solid rgba(99, 102, 241, 0.2)", padding: "10px 20px", borderRadius: "8px", fontWeight: "600", cursor: "pointer" }}>
                    ? Learn More
                  </button>
                  <button onClick={clearData} style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "10px 20px", borderRadius: "8px", fontWeight: "600", cursor: "pointer" }}>
                    Wipe AI Memory
                  </button>
                </div>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "15px" }}>Wiping memory will remove all your email embeddings from the cloud. Synapse will re-calculate them next time you search.</p>
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, padding: "40px", maxWidth: "800px", margin: "0 auto" }} className="animate-in">
            <button onClick={() => setActivePage("dashboard")} style={{ background: "none", border: "none", color: "var(--accent-primary)", display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", marginBottom: "30px", fontWeight: "600" }}>
              <ArrowRight size={20} style={{ transform: "rotate(180deg)" }} /> Back to Dashboard
            </button>
            <h1 style={{ fontSize: "32px", fontWeight: "800", marginBottom: "10px" }}>Feature Previews</h1>
            <p style={{ color: "var(--text-muted)", marginBottom: "40px" }}>Try out new experimental features before they go live.</p>

            <div className="glass-panel" style={{ padding: "0" }}>
              <div style={{ padding: "24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", gap: "16px" }}>
                  <LayoutDashboard size={24} color="var(--accent-primary)" />
                  <div>
                    <h4 style={{ fontWeight: "600" }}>Compact Inbox UI</h4>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Maximize screen real estate by shrinking margins and padding.</p>
                  </div>
                </div>
                <div className={`theme-toggle ${settings.compactMode ? "" : "light"}`} onClick={() => setSettings(s => ({ ...s, compactMode: !s.compactMode }))}>
                  <div className="theme-toggle-knob"></div>
                </div>
              </div>

              <div style={{ padding: "24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", gap: "16px" }}>
                  <ShieldAlert size={24} color="#ef4444" />
                  <div>
                    <h4 style={{ fontWeight: "600" }}>Hyper-Strict Phishing Scan</h4>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Use intensive LLM reasoning to detect sophisticated phishing attempts.</p>
                  </div>
                </div>
                <div className={`theme-toggle ${settings.deepScan ? "" : "light"}`} onClick={() => setSettings(s => ({ ...s, deepScan: !s.deepScan }))}>
                  <div className="theme-toggle-knob"></div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* FLOATING CHAT WIDGET */}
      <div className="floating-chat-container">
        {/* Chat Window */}
        {isChatOpen && (
          <div className="chat-window glass-panel animate-in">
            <div className="chat-header">
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Sparkles size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: "16px", fontWeight: "600", margin: 0 }}>Deep Search Intelligence</h3>
              </div>
              <button 
                onClick={() => setIsChatOpen(false)} 
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="chat-messages">
              {chatHistory.map((msg, idx) => (
                <div key={idx} className={`chat-bubble-wrapper ${msg.role === 'user' ? 'user' : 'ai'}`}>
                  {msg.role === 'ai' && <div className="chat-avatar"><Sparkles size={14} color="var(--accent-primary)" /></div>}
                  <div className={`chat-bubble ${msg.role === 'user' ? 'user-bubble' : 'ai-bubble'} ${msg.isError ? 'error-bubble' : ''}`}>
                    <div style={{ fontSize: "14px", lineHeight: "1.5" }}>{msg.content}</div>
                    
                    {/* Sources (only for AI messages) */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="chat-sources">
                        <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px", marginTop: "12px" }}>Sources</div>
                        {msg.sources.map((source, i) => (
                          <div key={i} className="chat-source-tag">
                            {source.from.split("<")[0]}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              
              {isSearching && (
                <div className="chat-bubble-wrapper ai">
                  <div className="chat-avatar"><Activity size={14} color="var(--accent-primary)" className="rotate-anim" /></div>
                  <div className="chat-bubble ai-bubble typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              )}
            </div>
            
            <form onSubmit={performRagChat} className="chat-input-area">
              <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about your emails (Full context search)..."
                className="chat-input"
              />
              <button type="submit" disabled={isSearching || !chatInput.trim()} className="chat-submit-btn">
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        )}

        {/* Floating Toggle Button */}
        <button 
          className="floating-chat-toggle" 
          onClick={() => setIsChatOpen(!isChatOpen)}
          style={{ transform: isChatOpen ? 'scale(0)' : 'scale(1)' }}
        >
          <Sparkles size={24} color="white" />
        </button>
      </div>
    </div>
  </div>
);
}