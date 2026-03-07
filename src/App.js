import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";

// ✅ Your live Render backend:
const API_BASE = "https://page-tracker-backend-ay9p.onrender.com";

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ALLOWED_PAPERS = ["Watertown Daily Times", "Malone Telegram"];
const PAGE_COUNT_OPTIONS = [6, 8, 10, 12];

const shortPaper = (paper) => (paper === "Watertown Daily Times" ? "WDT" : "MTG");

const formatDateLabel = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${WEEKDAY[d.getDay()]} ${d.toLocaleDateString()}`;
};

const toYMD = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);

const getNextPrintDateYMD = (fromDate = new Date()) => {
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 1) d.setDate(d.getDate() + 1);
  return toYMD(d);
};

const isPrintDay = (dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  return day >= 2 && day <= 6; // Tue–Sat
};

const daysFromToday = (dateStr) => {
  const today = new Date();
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(`${dateStr}T12:00:00`);
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((x - t) / (1000 * 60 * 60 * 24));
};

const allowedSectionsFor = (paper, dateStr) => {
  const d = new Date(`${dateStr}T12:00:00`);
  const isSaturday = d.getDay() === 6;
  if (!isSaturday) return ["A", "B"];
  return paper === "Malone Telegram" ? ["A", "B", "C"] : ["A", "B", "C", "D", "E", "G"];
};

const getDeadlineForPaper = (paper) =>
  paper === "Malone Telegram" ? { hour: 19, minute: 0, label: "7:00 PM" } : { hour: 23, minute: 30, label: "11:30 PM" };

const isPastPaperDeadlineNow = (paper) => {
  const now = new Date();
  const minsNow = now.getHours() * 60 + now.getMinutes();
  const dl = getDeadlineForPaper(paper);
  return minsNow >= dl.hour * 60 + dl.minute;
};

async function apiFetch(path, { method = "GET", body } = {}, auth = null) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { "x-username": auth.username, "x-password": auth.password } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function ProgressBar({ pct }) {
  const safe = Math.max(0, Math.min(100, pct || 0));
  const color = safe >= 100 ? "#16a34a" : safe >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ height: 10, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ height: 10, width: `${safe}%`, background: color }} />
    </div>
  );
}

export default function App() {
  // --- login ---
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState(null);
  const [me, setMe] = useState(null);
  const [role, setRole] = useState(null);

  // --- data ---
  const [editions, setEditions] = useState([]); // each has pages+sections
  const [users, setUsers] = useState([]); // admins only
  const [conn, setConn] = useState("offline");
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(null);

  // --- UI state ---
  const [tab, setTab] = useState("tracker");
  const [selectedDateFilter, setSelectedDateFilter] = useState("all");
  const [selectedEditionId, setSelectedEditionId] = useState("");
  const [showOnlyOutstanding, setShowOnlyOutstanding] = useState(false);

  // design: checkbox queue controls which editions show
  const [designCheckedEditionIds, setDesignCheckedEditionIds] = useState([]);
  const [didInitDesignChecks, setDidInitDesignChecks] = useState(false);

  // admin create edition
  const [newEd, setNewEd] = useState({
    paper: "Watertown Daily Times",
    date: getNextPrintDateYMD(),
    pageCounts: { A: 12, B: 10, C: 8, D: 8, E: 8, G: 8 },
  });
  const [creating, setCreating] = useState(false);

  // --- sockets ---
  useEffect(() => {
    if (!auth) return;
    const socket = io(API_BASE, { transports: ["websocket", "polling"] });

    socket.on("connect", () => setConn("live"));
    socket.on("disconnect", () => setConn("offline"));

    const upsertEdition = (edition) => {
      setEditions((prev) => {
        const idx = prev.findIndex((e) => e.id === edition.id);
        if (idx === -1) return [edition, ...prev];
        const next = [...prev];
        next[idx] = edition;
        return next;
      });
    };

    socket.on("edition:created", ({ edition }) => upsertEdition(edition));
    socket.on("edition:updated", ({ edition }) => upsertEdition(edition));
    socket.on("users:changed", ({ users }) => setUsers(users || []));

    return () => socket.disconnect();
  }, [auth]);

  // auto-dismiss banner
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  // default selection: next day’s paper
  useEffect(() => {
    if (!me || !editions.length) return;
    const nextDate = getNextPrintDateYMD();
    const candidates = editions.filter((e) => e.date === nextDate);
    const pref = candidates.find((e) => e.paper === "Watertown Daily Times") || candidates[0] || editions[0];
    if (!selectedEditionId && pref) setSelectedEditionId(pref.id);

    if (role === "admin") setSelectedDateFilter("all");
    else setSelectedDateFilter(nextDate);
  }, [me, editions, role, selectedEditionId]);

  // design: default checks = both next-day editions (if present)
  useEffect(() => {
    if (!me || role !== "design" || didInitDesignChecks || !editions.length) return;
    const nextDate = getNextPrintDateYMD();
    const ids = editions.filter((e) => e.date === nextDate).map((e) => e.id);
    setDesignCheckedEditionIds(ids);
    setDidInitDesignChecks(true);
  }, [me, role, didInitDesignChecks, editions]);

  // admin: ensure defaults exist for allowed letters
  const allowedLetters = useMemo(() => allowedSectionsFor(newEd.paper, newEd.date), [newEd.paper, newEd.date]);
  useEffect(() => {
    setNewEd((prev) => {
      const pc = { ...prev.pageCounts };
      for (const l of allowedLetters) {
        if (pc[l] == null) pc[l] = l === "A" ? 12 : l === "B" ? 10 : 8;
      }
      return { ...prev, pageCounts: pc };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newEd.paper, newEd.date, allowedLetters.join(",")]);

  // --- derived ---
  const allDates = useMemo(() => Array.from(new Set(editions.map((e) => e.date))).sort(), [editions]);

  const filteredEditions = useMemo(() => {
    let list = [...editions];
    if (selectedDateFilter !== "all") list = list.filter((e) => e.date === selectedDateFilter);
    return list.sort((a, b) => a.date.localeCompare(b.date) || a.paper.localeCompare(b.paper) || a.edition.localeCompare(b.edition));
  }, [editions, selectedDateFilter]);

  const activeEditions = useMemo(() => {
    if (role === "design") {
      const checked = editions.filter((e) => designCheckedEditionIds.includes(e.id));
      if (checked.length) return checked;
    }
    const selected = editions.find((e) => e.id === selectedEditionId);
    return selected ? [selected] : [];
  }, [role, editions, designCheckedEditionIds, selectedEditionId]);

  const mergedPages = useMemo(() => {
    const out = [];
    for (const e of activeEditions) {
      for (const p of e.pages || []) {
        out.push({
          ...p,
          boardPaper: e.paper,
          boardDate: e.date,
          boardEdition: e.edition,
        });
      }
    }
    out.sort((a, b) => a.section.localeCompare(b.section) || a.num - b.num);
    return out;
  }, [activeEditions]);

  const visiblePages = useMemo(() => {
    if (!showOnlyOutstanding) return mergedPages;
    return mergedPages.filter((p) => !p.receivedAt);
  }, [mergedPages, showOnlyOutstanding]);

  const counts = useMemo(() => {
    const total = mergedPages.length;
    const sent = mergedPages.filter((p) => p.sentAt).length;
    const received = mergedPages.filter((p) => p.receivedAt).length;
    return { total, sent, received, waiting: sent - received };
  }, [mergedPages]);

  const progressMetric = role === "design" ? counts.sent : counts.received;
  const progressPct = counts.total ? Math.round((progressMetric / counts.total) * 100) : 0;

  const dashboard = useMemo(() => {
    return ALLOWED_PAPERS.map((paper) => {
      const paperEds = filteredEditions.filter((e) => e.paper === paper);
      const total = paperEds.reduce((sum, e) => sum + (e.pages || []).length, 0);
      const sent = paperEds.reduce((sum, e) => sum + (e.pages || []).filter((p) => p.sentAt).length, 0);
      const received = paperEds.reduce((sum, e) => sum + (e.pages || []).filter((p) => p.receivedAt).length, 0);
      const pct = total ? Math.round(((role === "design" ? sent : received) / total) * 100) : 0;
      return { paper, total, sent, received, pct, editions: paperEds.length };
    });
  }, [filteredEditions, role]);

  // --- actions ---
  async function login() {
    try {
      setError("");
      const creds = { username: username.trim(), password };
      await apiFetch("/api/auth/login", { method: "POST", body: creds });
      const boot = await apiFetch("/api/bootstrap", {}, creds);
      setAuth(creds);
      setMe(boot.user);
      setRole(boot.user.role);
      setEditions(boot.editions || []);
      setUsers(boot.users || []);
      setTab("tracker");
    } catch (e) {
      setError(e.message || "Login failed");
    }
  }

  function logout() {
    setAuth(null);
    setMe(null);
    setRole(null);
    setEditions([]);
    setUsers([]);
    setSelectedEditionId("");
    setDesignCheckedEditionIds([]);
    setDidInitDesignChecks(false);
    setError("");
    setBanner(null);
    setConn("offline");
  }

  async function mark(pageId, kind, action) {
    try {
      setError("");
      const before = editions;
      await apiFetch(`/api/pages/${encodeURIComponent(pageId)}/${kind}`, { method: "PATCH", body: { action } }, auth);
      // banner: best effort (socket will update anyway)
      setTimeout(() => {
        const edId = pageId.split("-").slice(0, -1).join("-");
        const ed = (before || []).find((e) => e.id === edId);
        if (!ed) return;
        const total = (ed.pages || []).length;
        if (!total) return;
        const sentCount = (ed.pages || []).filter((p) => p.sentAt).length;
        const recCount = (ed.pages || []).filter((p) => p.receivedAt).length;

        if (kind === "sent" && action === "mark" && sentCount + 1 >= total) {
          setBanner({ title: "✅ All pages sent", msg: `${shortPaper(ed.paper)} ${ed.edition} (${ed.date}) is fully sent.` });
        }
        if (kind === "received" && action === "mark" && recCount + 1 >= total) {
          setBanner({ title: "🟢 All pages received", msg: `${shortPaper(ed.paper)} ${ed.edition} (${ed.date}) is fully received by press.` });
        }
      }, 300);
    } catch (e) {
      setError(e.message || "Update failed");
    }
  }

  async function createEdition() {
    try {
      setError("");
      if (role !== "admin") return;

      const diff = daysFromToday(newEd.date);
      if (diff < 0 || diff > 14) return setError("Admins can add editions only for today through 14 days ahead.");
      if (!isPrintDay(newEd.date)) return setError("Only Tuesday through Saturday editions are allowed.");

      const pageCounts = {};
      for (const l of allowedLetters) pageCounts[l] = Number(newEd.pageCounts[l] || 0);

      setCreating(true);
      await apiFetch("/api/editions", { method: "POST", body: { paper: newEd.paper, date: newEd.date, pageCounts } }, auth);
      setCreating(false);
      setTab("tracker");
    } catch (e) {
      setCreating(false);
      setError(e.message || "Create edition failed");
    }
  }

  async function createBothPapersForDate() {
    try {
      setError("");
      if (role !== "admin") return;
      const date = newEd.date;

      const doOne = async (paper) => {
        const letters = allowedSectionsFor(paper, date);
        const pageCounts = {};
        for (const l of letters) pageCounts[l] = Number(newEd.pageCounts[l] || (l === "A" ? 12 : l === "B" ? 10 : 8));
        await apiFetch("/api/editions", { method: "POST", body: { paper, date, pageCounts } }, auth);
      };

      setCreating(true);
      await doOne("Watertown Daily Times");
      await doOne("Malone Telegram");
      setCreating(false);
      setTab("tracker");
    } catch (e) {
      setCreating(false);
      setError(e.message || "Create both failed");
    }
  }

  // --- UI helpers ---
  const card = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 14 };
  const small = { fontSize: 12, color: "#6b7280" };
  const hRow = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" };

  if (!me) {
    return (
      <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
        <div style={{ width: "100%", maxWidth: 520, ...card }}>
          <h2 style={{ margin: 0 }}>Page Tracker (Live)</h2>
          <div style={{ ...small, marginTop: 6 }}>Backend: {API_BASE}</div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Username</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ChrisS" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #d1d5db" }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Password</div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="design-demo / admin-demo / pressroom" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #d1d5db" }} />
          </div>

          {error && <div style={{ marginTop: 12, color: "#dc2626", fontSize: 13 }}>{error}</div>}

          <button onClick={login} style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer" }}>
            Enter
          </button>

          <div style={{ marginTop: 10, ...small }}>Demo passwords: admin-demo / design-demo / pressroom</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", padding: 18 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 12 }}>
        {banner && (
          <div style={{ ...card, border: "2px solid #f59e0b", background: "#fffbeb" }}>
            <div style={{ fontWeight: 800 }}>{banner.title}</div>
            <div style={{ marginTop: 4, color: "#374151" }}>{banner.msg}</div>
          </div>
        )}

        <div style={{ ...card }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>Newspaper Page Tracker</div>
              <div style={{ ...hRow, marginTop: 4 }}>
                <div style={{ fontSize: 13, color: "#374151" }}>
                  Welcome, <b>{me.firstName}</b>
                </div>
                <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, border: "1px solid #d1d5db", background: "#fff" }}>
                  {me.username} • {role}
                </span>
                <span style={{ fontSize: 12, padding: "4px 8px", borderRadius: 999, border: "1px solid #d1d5db", background: conn === "live" ? "#dcfce7" : "#fff" }}>
                  {conn === "live" ? "Live" : "Offline"}
                </span>
              </div>
              <div style={{ ...small, marginTop: 6 }}>Deadlines: MTG 7:00 PM • WDT 11:30 PM (unsent pages turn red after deadline)</div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={logout} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}>
                Log out
              </button>
              <button
                onClick={async () => {
                  try {
                    setError("");
                    const boot = await apiFetch("/api/bootstrap", {}, auth);
                    setEditions(boot.editions || []);
                    if (boot.users) setUsers(boot.users || []);
                  } catch (e) {
                    setError(e.message || "Refresh failed");
                  }
                }}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {error && <div style={{ ...card, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c" }}>{error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 12 }}>
          {/* LEFT */}
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ ...card }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Dual-Paper Dashboard</div>
              <div style={{ ...small, marginBottom: 10 }}>{selectedDateFilter === "all" ? "All upcoming editions" : formatDateLabel(selectedDateFilter)}</div>

              <div style={{ display: "grid", gap: 10 }}>
                {dashboard.map((d) => (
                  <div key={d.paper} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div style={{ fontWeight: 800, fontSize: 12 }}>{d.paper}</div>
                      <div style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, border: "1px solid #d1d5db", background: "#fff" }}>
                        {role === "design" ? `${d.sent}/${d.total} sent` : `${d.received}/${d.total} received`}
                      </div>
                    </div>
                    <div style={{ ...small, marginTop: 4 }}>
                      {d.editions} editions • {role === "design" ? `Sent ${d.sent}` : `Sent ${d.sent} • Received ${d.received}`}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <ProgressBar pct={d.pct} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ ...card }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Edition Picker</div>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "#374151", marginBottom: 10 }}>
                <input type="checkbox" checked={showOnlyOutstanding} onChange={(e) => setShowOnlyOutstanding(e.target.checked)} />
                Show only outstanding pages
              </label>

              {role !== "design" && (
                <select
                  value={selectedDateFilter}
                  onChange={(e) => setSelectedDateFilter(e.target.value)}
                  style={{ width: "100%", padding: 8, borderRadius: 10, border: "1px solid #d1d5db", marginBottom: 10 }}
                >
                  <option value="all">All upcoming dates</option>
                  {allDates.map((d) => (
                    <option key={d} value={d}>
                      {formatDateLabel(d)}
                    </option>
                  ))}
                </select>
              )}

              <div style={{ display: "grid", gap: 8, maxHeight: 360, overflow: "auto" }}>
                {(role === "design" ? [...editions].sort((a, b) => a.date.localeCompare(b.date) || a.paper.localeCompare(b.paper)) : filteredEditions).map((e) => {
                  const total = (e.pages || []).length;
                  const sent = (e.pages || []).filter((p) => p.sentAt).length;
                  const received = (e.pages || []).filter((p) => p.receivedAt).length;

                  const checked = role === "design" ? designCheckedEditionIds.includes(e.id) : selectedEditionId === e.id;

                  return (
                    <div
                      key={e.id}
                      style={{
                        border: checked ? "2px solid #111" : "1px solid #e5e7eb",
                        borderRadius: 12,
                        padding: 10,
                        background: checked ? "#fff" : "#fafafa",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => {
                            if (role === "design") {
                              const on = ev.target.checked;
                              setDesignCheckedEditionIds((prev) =>
                                on ? Array.from(new Set([...prev, e.id])) : prev.filter((id) => id !== e.id)
                              );
                            } else {
                              setSelectedEditionId(e.id);
                            }
                          }}
                          style={{ marginTop: 2 }}
                        />
                        <button
                          onClick={() => setSelectedEditionId(e.id)}
                          style={{ textAlign: "left", background: "transparent", border: "none", padding: 0, cursor: "pointer", flex: 1 }}
                        >
                          <div style={{ fontWeight: 800, fontSize: 12 }}>
                            {shortPaper(e.paper)} • {e.edition}
                          </div>
                          <div style={{ ...small }}>{formatDateLabel(e.date)}</div>
                          <div style={{ ...small }}>{role === "design" ? `${sent}/${total} sent` : `${received}/${total} received`}</div>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT */}
          <div style={{ ...card }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  {role === "design" && activeEditions.length > 1 ? `Design Queue View • ${activeEditions.length} editions selected` : "Tracker"}
                </div>
                <div style={{ ...small }}>
                  {role === "design" && activeEditions.length > 1
                    ? activeEditions.map((e) => `${shortPaper(e.paper)} ${e.date}`).join(" • ")
                    : "Select an edition (left) or check multiple (design) to view."}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setTab("tracker")}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: tab === "tracker" ? "2px solid #111" : "1px solid #d1d5db",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Tracker
                </button>
                {role === "admin" && (
                  <button
                    onClick={() => setTab("setup")}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 10,
                      border: tab === "setup" ? "2px solid #111" : "1px solid #d1d5db",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    Add Edition
                  </button>
                )}
              </div>
            </div>

            {tab === "setup" && role === "admin" ? (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Admin: Add Edition</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Paper</div>
                    <select
                      value={newEd.paper}
                      onChange={(e) => setNewEd((p) => ({ ...p, paper: e.target.value }))}
                      style={{ width: "100%", padding: 8, borderRadius: 10, border: "1px solid #d1d5db" }}
                    >
                      {ALLOWED_PAPERS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Production date</div>
                    <input
                      type="date"
                      value={newEd.date}
                      onChange={(e) => setNewEd((p) => ({ ...p, date: e.target.value }))}
                      style={{ width: "100%", padding: 8, borderRadius: 10, border: "1px solid #d1d5db" }}
                    />
                    <div style={{ ...small, marginTop: 4 }}>{formatDateLabel(newEd.date)} • Tue–Sat only</div>
                  </div>
                </div>

                <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "#fff" }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Page Counts</div>

                  <div style={{ ...small, marginBottom: 8 }}>
                    Will create sections: <b>{allowedLetters.join(", ")}</b>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {allowedLetters.map((letter) => (
                      <div key={letter} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Section {letter}</div>
                        <select
                          value={newEd.pageCounts[letter]}
                          onChange={(e) =>
                            setNewEd((p) => ({ ...p, pageCounts: { ...p.pageCounts, [letter]: Number(e.target.value) } }))
                          }
                          style={{ width: "100%", padding: 8, borderRadius: 10, border: "1px solid #d1d5db" }}
                        >
                          {PAGE_COUNT_OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {n} pages
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 10, ...small }}>
                    Total pages:{" "}
                    <b>{allowedLetters.reduce((sum, l) => sum + Number(newEd.pageCounts[l] || 0), 0)}</b>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                  <button
                    onClick={createEdition}
                    disabled={creating}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #111",
                      background: "#111",
                      color: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {creating ? "Creating..." : "Create edition"}
                  </button>

                  <button
                    onClick={createBothPapersForDate}
                    disabled={creating}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {creating ? "Creating..." : "Create BOTH papers for this date"}
                  </button>

                  <div style={{ ...small, alignSelf: "center" }}>
                    (Weekdays: A+B • Sat MTG: A+B+C • Sat WDT: A+B+C+D+E+G)
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                    Total <b>{counts.total}</b>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                    Sent <b>{counts.sent}</b>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                    Waiting <b>{counts.waiting}</b>
                  </div>
                  <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, background: "#fafafa" }}>
                    Received <b>{counts.received}</b>
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", ...small, marginBottom: 6 }}>
                    <span>{role === "design" ? "Sent progress" : "Received progress"}</span>
                    <span>
                      <b>{progressPct}%</b>
                    </span>
                  </div>
                  <ProgressBar pct={progressPct} />
                </div>

                <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "auto", maxHeight: 560, background: "#fff" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead style={{ position: "sticky", top: 0, background: "#f8fafc", borderBottom: "1px solid #e5e7eb" }}>
                      <tr>
                        <th style={{ textAlign: "left", padding: 10 }}>Page</th>
                        <th style={{ textAlign: "left", padding: 10 }}>Status</th>
                        <th style={{ textAlign: "left", padding: 10 }}>Sent</th>
                        <th style={{ textAlign: "left", padding: 10 }}>Press Received</th>
                      </tr>
                    </thead>

                    <tbody>
                      {visiblePages.map((p) => {
                        const status = p.receivedAt ? "received" : p.sentAt ? "sent" : "pending";
                        const late = status === "pending" && isPastPaperDeadlineNow(p.boardPaper);
                        const bg =
                          late ? "#fef2f2" : status === "received" ? "#ecfdf5" : status === "sent" ? "#fffbeb" : "transparent";

                        return (
                          <tr key={p.id} style={{ borderBottom: "1px solid #f1f5f9", background: bg }}>
                            <td style={{ padding: 10, fontWeight: 800 }}>
                              {activeEditions.length > 1 ? `${shortPaper(p.boardPaper)} • ${p.label}` : p.label}
                            </td>

                            <td style={{ padding: 10 }}>
                              {status === "received" && <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#22c55e", color: "#fff" }}>Received</span>}
                              {status === "sent" && <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#eab308", color: "#111" }}>Sent / waiting</span>}
                              {status === "pending" && !late && <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, border: "1px solid #d1d5db" }}>Pending</span>}
                              {status === "pending" && late && <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#ef4444", color: "#fff" }}>Late</span>}
                            </td>

                            <td style={{ padding: 10 }}>
                              {!p.sentAt ? (
                                <button
                                  disabled={!(role === "admin" || role === "design")}
                                  onClick={() => mark(p.id, "sent", "mark")}
                                  style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid #111", background: "#111", color: "#fff", cursor: "pointer" }}
                                >
                                  Mark sent
                                </button>
                              ) : (
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, border: "1px solid #d1d5db" }}>
                                    {new Date(p.sentAt).toLocaleTimeString?.() ? p.sentAt : p.sentAt}
                                  </span>
                                  {p.sentBy && (
                                    <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#e5e7eb" }}>
                                      by {p.sentBy}
                                    </span>
                                  )}
                                  <button
                                    disabled={!(role === "admin" || role === "design")}
                                    onClick={() => mark(p.id, "sent", "clear")}
                                    style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
                                  >
                                    Clear
                                  </button>
                                </div>
                              )}
                            </td>

                            <td style={{ padding: 10 }}>
                              {!p.receivedAt ? (
                                <button
                                  disabled={!(role === "admin" || role === "press")}
                                  onClick={() => mark(p.id, "received", "mark")}
                                  style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
                                >
                                  Received
                                </button>
                              ) : (
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                  <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "#22c55e", color: "#fff" }}>
                                    {p.receivedAt}
                                  </span>
                                  <button
                                    disabled={!(role === "admin" || role === "press")}
                                    onClick={() => mark(p.id, "received", "clear")}
                                    style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer" }}
                                  >
                                    Undo
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
