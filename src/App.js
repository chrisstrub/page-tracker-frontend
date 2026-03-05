import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const API_BASE = "https://page-tracker-backend-ay9p.onrender.com";

function shortPaper(paper) {
  return paper === "Watertown Daily Times" ? "WDT" : "MTG";
}

function allowedSectionsFor(paper, dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay(); // 0 Sun, 6 Sat
  const isSaturday = day === 6;
  if (!isSaturday) return ["A", "B"]; // Tue–Fri (and also Tue) → A+B
  // Saturday rules
  return paper === "Malone Telegram"
    ? ["A", "B", "C"]
    : ["A", "B", "C", "D", "E", "G"];
}

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [auth, setAuth] = useState(null); // {username,password}
  const [me, setMe] = useState(null); // {username, firstName, role}
  const [error, setError] = useState("");
  const [editions, setEditions] = useState([]); // each includes pages
  const [selectedEditionId, setSelectedEditionId] = useState("");
  const [status, setStatus] = useState("disconnected");

const [newEdition, setNewEdition] = useState({
  paper: "Watertown Daily Times",
  date: "2026-03-06",
  pageCounts: { A: 12, B: 10, C: 8, D: 8, E: 8, G: 8 },
});const [creatingEdition, setCreatingEdition] = useState(false);

  async function api(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-username": auth?.username || "",
        "x-password": auth?.password || "",
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch {}
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }



  async function login() {
    try {
      setError("");
      const creds = { username: username.trim(), password };
      // validate
      const r = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creds),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Login failed");
      setAuth(creds);

      // bootstrap (shared state)
      const boot = await fetch(`${API_BASE}/api/bootstrap`, {
        headers: { "x-username": creds.username, "x-password": creds.password },
      });
      const bootData = await boot.json();
      if (!boot.ok) throw new Error(bootData.error || "Bootstrap failed");

      setMe(bootData.user);
      setEditions(bootData.editions || []);
      if ((bootData.editions || []).length) setSelectedEditionId((bootData.editions || [])[0].id);
    } catch (e) {
      setError(e.message);
    }
  }

  // live socket updates
  useEffect(() => {
    if (!auth) return;
    const socket = io(API_BASE, { transports: ["websocket", "polling"] });

    socket.on("connect", () => setStatus("live"));
    socket.on("disconnect", () => setStatus("disconnected"));

    const upsert = (edition) => {
      setEditions((prev) => {
        const idx = prev.findIndex((x) => x.id === edition.id);
        if (idx === -1) return [edition, ...prev];
        const next = [...prev];
        next[idx] = edition;
        return next;
      });
    };

    socket.on("edition:created", ({ edition }) => upsert(edition));
    socket.on("edition:updated", ({ edition }) => upsert(edition));

    return () => socket.disconnect();
  }, [auth]);

  const selected = useMemo(
    () => editions.find((e) => e.id === selectedEditionId) || editions[0] || null,
    [editions, selectedEditionId]
  );

  const counts = useMemo(() => {
    const pages = selected?.pages || [];
    const total = pages.length;
    const sent = pages.filter((p) => p.sentAt).length;
    const received = pages.filter((p) => p.receivedAt).length;
    return { total, sent, received };
  }, [selected]);

const allowedLetters = useMemo(() => allowedSectionsFor(newEdition.paper, newEdition.date), [newEdition.paper, newEdition.date]);
const filteredPageCounts = useMemo(() => Object.fromEntries(Object.entries(newEdition.pageCounts).filter(([k]) => allowedLetters.includes(k))), [newEdition.pageCounts, allowedLetters]);

useEffect(() => {
  // Ensure pageCounts always has defaults for whatever sections are currently allowed
  setNewEdition((prev) => {
    const next = { ...prev.pageCounts };
    for (const l of allowedLetters) {
      if (next[l] == null) next[l] = l === "A" ? 12 : l === "B" ? 10 : 8;
    }
    return { ...prev, pageCounts: next };
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [newEdition.paper, newEdition.date, allowedLetters.join(",")]);

async function createEdition() {
  try {
    setError("");
    setCreatingEdition(true);

    const res = await fetch(`${API_BASE}/api/editions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-username": auth?.username || "",
        "x-password": auth?.password || "",
      },
      body: JSON.stringify({
        paper: newEdition.paper,
        date: newEdition.date,
pageCounts: filteredPageCounts,      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Create edition failed");

    // it will also show up via real-time socket events, but this keeps the UI snappy
    if (data.edition?.id) setSelectedEditionId(data.edition.id);
  } catch (e) {
    setError(e.message || "Create edition failed");
  } finally {
    setCreatingEdition(false);
  }
}

  async function mark(pageId, kind, action) {
    try {
      setError("");
      await api(`/api/pages/${encodeURIComponent(pageId)}/${kind}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      // server will emit real-time update; no manual refresh needed
    } catch (e) {
      setError(e.message);
    }
  }

  if (!me) {
    return (
      <div style={{ maxWidth: 520, margin: "40px auto", padding: 20 }}>
        <h2>Newsroom Page Tracker (Real-time)</h2>
        <p style={{ color: "#666" }}>Backend: {API_BASE}</p>

        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ChrisS" style={{ width: "100%", padding: 10, margin: "8px 0 12px" }} />

        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="design-demo / admin-demo / pressroom" style={{ width: "100%", padding: 10, margin: "8px 0 12px" }} />

        {error && <div style={{ color: "crimson", marginBottom: 12 }}>{error}</div>}

        <button onClick={login} style={{ padding: "10px 14px" }}>Log in</button>

        <div style={{ marginTop: 16, fontSize: 12, color: "#666" }}>
          Demo passwords: admin-demo / design-demo / pressroom
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "20px auto", padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Newsroom Page Tracker</h2>
          <div style={{ fontSize: 13, color: "#555" }}>
            Logged in: <b>{me.username}</b> ({me.role}) • Connection: <b>{status}</b>
          </div>
        </div>
        <button onClick={() => { setMe(null); setAuth(null); setEditions([]); setSelectedEditionId(""); setError(""); }}>Log out</button>
      </div>

      {error && <div style={{ color: "crimson", marginTop: 12 }}>{error}</div>}

      <hr style={{ margin: "16px 0" }} />

     <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
  {allowedLetters.map((letter) => (
    <div key={letter}>
      <label style={{ fontSize: 12, color: "#666" }}>
        Section {letter} pages
      </label>
      <select
        value={newEdition.pageCounts[letter]}
        onChange={(e) =>
          setNewEdition((p) => ({
            ...p,
            pageCounts: { ...p.pageCounts, [letter]: Number(e.target.value) },
          }))
        }
        style={{ padding: 8, width: "100%" }}
      >
        {[6, 8, 10, 12].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </div>
  ))}
</div>

<div style={{ fontSize: 12, color: "#555" }}>
  Will create sections: <b>{allowedLetters.join(", ")}</b> • Total pages:{" "}
  <b>{allowedLetters.reduce((sum, l) => sum + Number(newEdition.pageCounts[l] || 0), 0)}</b>
</div>

{me.role === "admin" && (
  <div style={{ marginBottom: 12, padding: 10, border: "1px solid #eee", borderRadius: 10, background: "#fff" }}>
    <div style={{ fontWeight: 700, marginBottom: 8 }}>Admin: Create Edition</div>

    <div style={{ display: "grid", gap: 8 }}>
      <label style={{ fontSize: 12, color: "#666" }}>Paper</label>
      <select
        value={newEdition.paper}
        onChange={(e) => setNewEdition((p) => ({ ...p, paper: e.target.value }))}
        style={{ padding: 8 }}
      >
        <option value="Watertown Daily Times">Watertown Daily Times</option>
        <option value="Malone Telegram">Malone Telegram</option>
      </select>

      <label style={{ fontSize: 12, color: "#666" }}>Production date</label>
      <input
        type="date"
        value={newEdition.date}
        onChange={(e) => setNewEdition((p) => ({ ...p, date: e.target.value }))}
        style={{ padding: 8 }}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 12, color: "#666" }}>Section A pages</label>
          <select
            value={newEdition.pageCounts.A}
            onChange={(e) => setNewEdition((p) => ({ ...p, pageCounts: { ...p.pageCounts, A: Number(e.target.value) } }))}
            style={{ padding: 8, width: "100%" }}
          >
            {[6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: 12, color: "#666" }}>Section B pages</label>
          <select
            value={newEdition.pageCounts.B}
            onChange={(e) => setNewEdition((p) => ({ ...p, pageCounts: { ...p.pageCounts, B: Number(e.target.value) } }))}
            style={{ padding: 8, width: "100%" }}
          >
            {[6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>

      <button onClick={createEdition} disabled={creatingEdition} style={{ padding: "10px 12px" }}>
        {creatingEdition ? "Creating..." : "Create edition"}
      </button>

      <div style={{ fontSize: 11, color: "#666" }}>
       (Weekdays auto-create A+B. Saturdays auto-create MTG: A+B+C, WDT: A+B+C+D+E+G.)
      </div>
    </div>
  </div>
)}
          {editions.length === 0 && <div style={{ color: "#666" }}>No editions yet. (Admin creates editions.)</div>}
          <div style={{ display: "grid", gap: 8, maxHeight: 560, overflow: "auto" }}>
            {editions.map((e) => {
              const total = (e.pages || []).length;
              const sent = (e.pages || []).filter((p) => p.sentAt).length;
              const received = (e.pages || []).filter((p) => p.receivedAt).length;
              const isSelected = e.id === selectedEditionId;
              return (
                <button
                  key={e.id}
                  onClick={() => setSelectedEditionId(e.id)}
                  style={{
                    textAlign: "left",
                    padding: 10,
                    borderRadius: 10,
                    border: isSelected ? "2px solid #111" : "1px solid #ddd",
                    background: isSelected ? "#fff" : "#fafafa",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{shortPaper(e.paper)} • {e.edition}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>{e.date}</div>
                  <div style={{ fontSize: 12, color: "#666" }}>Sent {sent}/{total} • Received {received}/{total}</div>
                </button>
              );
            })}
          </div>
       

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          {!selected ? (
            <div>Select an edition…</div>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>
                {selected.paper} • {selected.edition} <span style={{ color: "#666", fontWeight: 400 }}>({selected.date})</span>
              </h3>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, fontSize: 13 }}>
                <div>Total: <b>{counts.total}</b></div>
                <div>Sent: <b>{counts.sent}</b></div>
                <div>Received: <b>{counts.received}</b></div>
              </div>

              <div style={{ maxHeight: 600, overflow: "auto", border: "1px solid #eee", borderRadius: 10 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#f7f7f7" }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Page</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Sent</th>
                      <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Press Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.pages || []).map((p) => (
                      <tr key={p.id}>
                        <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                          <b>{p.label}</b>
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                          {!p.sentAt ? (
                            <button disabled={!(me.role === "admin" || me.role === "design")} onClick={() => mark(p.id, "sent", "mark")}>
                              Mark sent
                            </button>
                          ) : (
                            <>
                              <span>{new Date(p.sentAt).toLocaleTimeString()} {p.sentBy ? ` (by ${p.sentBy})` : ""}</span>
                              {" "}
                              <button disabled={!(me.role === "admin" || me.role === "design")} onClick={() => mark(p.id, "sent", "clear")}>
                                Clear
                              </button>
                            </>
                          )}
                        </td>
                        <td style={{ padding: 10, borderBottom: "1px solid #f0f0f0" }}>
                          {!p.receivedAt ? (
                            <button disabled={!(me.role === "admin" || me.role === "press")} onClick={() => mark(p.id, "received", "mark")}>
                              Received
                            </button>
                          ) : (
                            <>
                              <span>{new Date(p.receivedAt).toLocaleTimeString()}</span>
                              {" "}
                              <button disabled={!(me.role === "admin" || me.role === "press")} onClick={() => mark(p.id, "received", "clear")}>
                                Undo
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                Tip: open another browser window and log in as a different user (e.g. PressRoom). You should see updates live.
              </div>
            </>
          )}
        </div>
      </div>
  );
}
