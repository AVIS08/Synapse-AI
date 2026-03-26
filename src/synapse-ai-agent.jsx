import React, { useState, useEffect, useCallback } from "react";
import { Mail, ShieldAlert, Zap, LayoutDashboard, CheckCircle2, AlertTriangle, AlertOctagon, ArrowRight, Activity, Inbox, Sun, Moon, X } from "lucide-react";

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
  const [connected, setConnected] = useState(false);
  const [risk, setRisk] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [analyzingTasks, setAnalyzingTasks] = useState(false);
  const [analyzingPhishing, setAnalyzingPhishing] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem("synapse-theme") || "dark");
  const [toasts, setToasts] = useState([]);

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

  async function loadEmails() {
    try {
      const res = await fetch("http://localhost:5000/emails");
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
    loadEmails();
  }, []);

  async function analyzeEmails() {
    setAnalyzingTasks(true);
    showToast("Extracting tasks from your inbox...", "info");
    try {
      const res = await fetch("http://localhost:5000/api/analyze-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
        body: JSON.stringify({ email: selectedEmail })
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
          
          <div style={{ position: "absolute", top: "24px", right: "24px", zIndex: 10 }}>
            <div className={`theme-toggle ${theme === "light" ? "light" : ""}`} onClick={toggleTheme}>
              <div className="theme-toggle-knob">
                {theme === "dark" ? <Moon size={10} color="white" /> : <Sun size={10} color="white" />}
              </div>
            </div>
          </div>

          <div style={{ position: "absolute", fontSize: "200px", fontWeight: 900, color: "rgba(255,255,255,0.02)", top: "15%" }}>SYNAPSE</div>
          <div style={{ position: "absolute", fontSize: "150px", fontWeight: 900, color: "rgba(255,255,255,0.01)", bottom: "5%" }}>AI</div>
          
          <h1 style={{ fontSize: "70px", fontWeight: 900, zIndex: 2, marginBottom: "20px", display: "flex", alignItems: "center", gap: "20px" }}>
            <Zap size={60} color="#6366f1" /> SynapseAI
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: "18px", marginBottom: "40px", zIndex: 2 }}>Intelligent Email Analysis & Task Extraction</p>
          
          <button onClick={connectGmail} className="button-gradient" style={{ padding: "16px 40px", fontSize: "16px" }}>
            Connect Workspace <ArrowRight size={20} />
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <div className="glow glow1"></div>
      <div className="glow glow2"></div>

      <div className="dashboard-layout glass-panel">
        
        {/* SIDEBAR: INBOX */}
        <div className="sidebar glass-panel">
          <div style={{ padding: "24px", borderBottom: "1px solid var(--border-color)", display: "flex", alignItems: "center", gap: "10px" }}>
            <Inbox size={24} color="var(--accent-primary)" />
            <h2 style={{ fontSize: "18px", fontWeight: "600" }}>Live Inbox</h2>
            <span className="badge badge-low" style={{ marginLeft: "auto" }}>{emails.length} Mails</span>
          </div>

          <div style={{ overflowY: "auto", flex: 1, padding: "12px" }}>
            {emails.map(email => (
              <div
                key={email.id}
                onClick={() => { setSelectedEmail(email); setRisk(null); setReasons([]); }}
                className="animate-in"
                style={{
                  padding: "16px",
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
                <div style={{ fontWeight: 600, fontSize: "14px", lineHeight: "1.4", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
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
                <div className={`theme-toggle ${theme === "light" ? "light" : ""}`} onClick={toggleTheme}>
                  <div className="theme-toggle-knob">
                    {theme === "dark" ? <Moon size={10} color="white" /> : <Sun size={10} color="white" />}
                  </div>
                </div>
                <button onClick={analyzeEmails} className="button-gradient" disabled={analyzingTasks}>
                  <Activity size={18} /> {analyzingTasks ? "Analyzing..." : "Extract Tasks"}
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
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
            
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
      </div>
    </>
  );
}