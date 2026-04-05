// timecard-app.jsx
// Dependencies: firebase (npm install firebase)
// Companion file: firebase.js (drop in your config there)

import { useState, useEffect, useRef } from "react";
import {
  collection, doc, addDoc, updateDoc, getDocs,
  onSnapshot, query, orderBy, where, Timestamp, writeBatch
} from "firebase/firestore";
import { db } from "./firebase";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCATIONS    = ["Gibraltar", "Lorimar"];
const DEVICE_CODES = ["GIBRALTAR01", "LORIMAR01", "ADMIN2024"]; // secret setup codes
let ADMIN_PIN    = "0000"; // overwritten on load from Firestore _meta/adminPin

async function loadAdminPin() {
  try {
    const snap = await getDocs(collection(db, "_meta"));
    snap.forEach(d => { if (d.id === "adminPin" && d.data().pin) ADMIN_PIN = d.data().pin; });
  } catch {}
}

async function saveAdminPin(newPin) {
  await updateDoc(doc(db, "_meta", "adminPin"), { pin: newPin }).catch(async () => {
    await addDoc(collection(db, "_meta"), { pin: newPin });
  });
  ADMIN_PIN = newPin;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function now()          { return new Date(); }
function tsToDate(ts)   { return ts?.toDate ? ts.toDate() : ts instanceof Date ? ts : null; }
function fmt(ts)        { const d = tsToDate(ts); return d ? d.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" }) : "—"; }
function fmtDate(ts)    { const d = tsToDate(ts); return d ? d.toLocaleDateString("en-CA") : "—"; }
function fmtDuration(ms){ if (!ms || ms < 0) return "—"; const h = Math.floor(ms/3600000); const m = Math.floor((ms%3600000)/60000); return `${h}h ${m.toString().padStart(2,"0")}m`; }
function durMs(r)       { const i = tsToDate(r.clockIn); const o = tsToDate(r.clockOut) || now(); return i ? o - i : 0; }

function exportPDF(records, periodLabel) {
  const grouped = {};
  records.forEach(r => {
    if (!grouped[r.employee]) grouped[r.employee] = [];
    grouped[r.employee].push(r);
  });

  let html = `
    <html><head><style>
      body { font-family: Arial, sans-serif; font-size: 12px; color: #222; margin: 0; padding: 20px; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
      th { background: #f5f5f5; text-align: left; padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #ddd; }
      td { padding: 6px 8px; border-bottom: 1px solid #eee; }
      .total { font-weight: bold; background: #f9f9f9; }
      .header { display: flex; justify-content: space-between; margin-bottom: 16px; }
      .subtitle { color: #666; font-size: 12px; }
    </style></head><body>
    <div class="header">
      <div><h1>TimeCard Report</h1><div class="subtitle">Gibraltar &amp; Lorimar · ${periodLabel}</div></div>
      <div class="subtitle">Generated: ${new Date().toLocaleDateString("en-CA")}</div>
    </div>`;

  let grandTotal = 0;
  Object.entries(grouped).forEach(([name, recs]) => {
    const totalMs = recs.reduce((a, r) => a + durMs(r), 0);
    grandTotal += totalMs;
    html += `<h2>${name}</h2>
      <table>
        <thead><tr><th>Date</th><th>Location</th><th>In</th><th>Out</th><th>Duration</th><th>Status</th></tr></thead>
        <tbody>`;
    recs.forEach(r => {
      html += `<tr>
        <td>${fmtDate(r.clockIn)}</td>
        <td>${r.location}</td>
        <td>${fmt(r.clockIn)}</td>
        <td>${fmt(r.clockOut)}</td>
        <td>${fmtDuration(durMs(r))}</td>
        <td>${r.clockOut ? "Complete" : "Active"}</td>
      </tr>`;
    });
    html += `<tr class="total"><td colspan="4">Total</td><td>${fmtDuration(totalMs)}</td><td></td></tr>
        </tbody></table>`;
  });

  html += `<div style="margin-top:16px;padding-top:8px;border-top:2px solid #ddd;font-weight:bold;">
    Grand total: ${fmtDuration(grandTotal)} across ${records.length} entries
  </div></body></html>`;

  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.print();
}

function exportCSV(records) {
  const header = "ID,Employee,Location,Date,Clock In,Clock Out,Duration\n";
  const rows = records.map(r => {
    const dur = r.clockOut ? fmtDuration(durMs(r)) : "Active";
    return `"${r.id}","${r.employee}","${r.location}","${fmtDate(r.clockIn)}","${fmt(r.clockIn)}","${fmt(r.clockOut)}","${dur}"`;
  }).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `timecards-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
}

// ─── Firebase helpers ─────────────────────────────────────────────────────────





async function clockIn(employee, location, photoBase64) {
  await addDoc(collection(db, "timecards"), {
    employeeId: employee.id,
    employee:   employee.name,
    location,
    clockIn:    Timestamp.now(),
    clockOut:   null,
    photoIn:    photoBase64 || null,
    photoOut:   null,
  });
}

async function clockOut(recordId, photoBase64) {
  await updateDoc(doc(db, "timecards", recordId), {
    clockOut: Timestamp.now(),
    photoOut: photoBase64 || null,
  });
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  app: { minHeight: "100vh", minHeight: "100dvh", background: "var(--color-background-tertiary)", fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column" },
  header: { background: "var(--color-background-primary)", borderBottom: "0.5px solid var(--color-border-tertiary)", padding: "0 1rem", height: "52px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
  logo: { fontSize: "15px", fontWeight: "500", color: "var(--color-text-primary)" },
  logoSub: { fontSize: "12px", color: "var(--color-text-secondary)", marginLeft: "8px" },
  offlinePill: { fontSize: "11px", padding: "3px 10px", borderRadius: "99px", background: "var(--color-background-warning)", color: "var(--color-text-warning)" },
  main: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "1rem", overflowY: "auto" },
  clockCard: { background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1.25rem", width: "100%", maxWidth: "420px" },
  label: { fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "6px" },
  select: { width: "100%", padding: "10px 12px", fontSize: "15px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", marginBottom: "1rem" },
  pinRow: { display: "flex", gap: "12px", justifyContent: "center", marginBottom: "1.5rem" },
  pinDot: (f) => ({ width: "14px", height: "14px", borderRadius: "50%", background: f ? "var(--color-text-primary)" : "var(--color-border-secondary)", transition: "background 0.15s" }),
  numpad: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "8px", marginBottom: "1rem" },
  numBtn: { padding: "18px 14px", fontSize: "20px", fontWeight: "500", background: "var(--color-background-secondary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", color: "var(--color-text-primary)", cursor: "pointer", touchAction: "manipulation" },
  clearBtn: { padding: "18px 14px", fontSize: "14px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)", cursor: "pointer", touchAction: "manipulation" },
  actionBtn: (c) => ({ width: "100%", padding: "12px", fontSize: "15px", fontWeight: "500", background: c==="green"?"#639922":c==="red"?"#E24B4A":c==="blue"?"#378ADD":"var(--color-background-secondary)", color: ["green","red","blue"].includes(c)?"#fff":"var(--color-text-primary)", border: "none", borderRadius: "var(--border-radius-md)", cursor: "pointer", marginBottom: "8px" }),
  banner: (t) => ({ padding: "10px 16px", borderRadius: "var(--border-radius-md)", marginBottom: "1rem", fontSize: "14px", background: t==="success"?"var(--color-background-success)":t==="error"?"var(--color-background-danger)":"var(--color-background-info)", color: t==="success"?"var(--color-text-success)":t==="error"?"var(--color-text-danger)":"var(--color-text-info)" }),
  adminWrap: { width: "100%", maxWidth: "820px", padding: "0 0.5rem" },
  tabRow: { display: "flex", gap: "4px", marginBottom: "1.5rem" },
  tab: (a) => ({ padding: "8px 16px", fontSize: "14px", background: a?"var(--color-background-primary)":"transparent", border: a?"0.5px solid var(--color-border-secondary)":"none", borderRadius: "var(--border-radius-md)", color: a?"var(--color-text-primary)":"var(--color-text-secondary)", cursor: "pointer" }),
  statGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "1.5rem" },
  statCard: { background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", padding: "1rem" },
  statLabel: { fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" },
  statValue: { fontSize: "22px", fontWeight: "500", color: "var(--color-text-primary)" },
  table: { width: "100%", fontSize: "13px", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "8px 12px", fontSize: "12px", color: "var(--color-text-secondary)", borderBottom: "0.5px solid var(--color-border-tertiary)", fontWeight: "500" },
  td: { padding: "10px 12px", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-primary)" },
  badge: (c) => ({ display: "inline-block", padding: "2px 8px", fontSize: "11px", borderRadius: "99px", background: c==="green"?"#EAF3DE":c==="amber"?"#FAEEDA":"#E6F1FB", color: c==="green"?"#3B6D11":c==="amber"?"#854F0B":"#185FA5" }),
};

// ─── Numpad ───────────────────────────────────────────────────────────────────
function Numpad({ pin, setPin }) {
  const keys = ["1","2","3","4","5","6","7","8","9","","0","⌫"];
  return (
    <div style={S.numpad}>
      {keys.map((k, i) => (
        k === "" ? <div key={i} /> :
        k === "⌫"
          ? <button key={i} style={S.clearBtn} onClick={() => setPin(p => p.slice(0,-1))}>⌫</button>
          : <button type="button" key={i} style={S.numBtn} onClick={() => setPin(p => p.length < 4 ? p+k : p)}>{k}</button>
      ))}
    </div>
  );
}

// ─── Live clock ───────────────────────────────────────────────────────────────
function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return <>{t.toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</>;
}

// ─── Live Duration ────────────────────────────────────────────────────────────
function LiveDuration({ clockIn }) {
  const [ms, setMs] = useState(() => {
    const d = clockIn?.toDate ? clockIn.toDate() : clockIn;
    return d ? new Date() - d : 0;
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = clockIn?.toDate ? clockIn.toDate() : clockIn;
      setMs(d ? new Date() - d : 0);
    }, 1000);
    return () => clearInterval(id);
  }, [clockIn]);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--color-text-secondary)", paddingLeft: "12px" }}>
      {h > 0 ? `${h}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}` : `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`}
    </div>
  );
}

// ─── Clock Screen ─────────────────────────────────────────────────────────────
function ClockScreen({ onAdmin, employees }) {
  const [pin, setPin]               = useState("");
  const [message, setMessage]       = useState(null);
  const [busy, setBusy]             = useState(false);
  const [activeRecords, setActiveRecords] = useState([]);
  const [identified, setIdentified] = useState(null); // { emp, activeRecord }
  const [location, setLocation]     = useState(LOCATIONS[0]);
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const cameraReady = useRef(false);
  const [stream, setStream]         = useState(null);
  const [cameraError, setCameraError] = useState(null);

  // Live listener for active records
  useEffect(() => {
    const q = query(collection(db, "timecards"), where("clockOut", "==", null), orderBy("clockIn", "desc"));
    const unsub = onSnapshot(q, snap => setActiveRecords(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, []);

  // Auto-start camera
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      .then(s => {
        streamRef.current = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current.play()
              .then(() => { cameraReady.current = true; })
              .catch(() => { cameraReady.current = true; });
          };
        }
      })
      .catch(err => { console.error("Camera error:", err); setCameraError(err.message); });
    return () => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); };
  }, []);

  // Step 1: PIN entered — identify employee
  useEffect(() => {
    if (pin.length === 4) {
      const p = pin;
      setPin("");
      if (p === ADMIN_PIN) { onAdmin(); return; }
      const emp = employees.find(e => (e.pin || e.PIN) === p);
      if (!emp) {
        setMessage({ type: "error", text: "PIN not recognised. Try again." });
        setTimeout(() => setMessage(null), 3000);
        return;
      }
      const activeRecord = activeRecords.find(r => r.employeeId === emp.id);
      setIdentified({ emp, activeRecord: activeRecord || null });
      setLocation(activeRecord ? activeRecord.location : LOCATIONS[0]);
    }
  }, [pin]);

  function capturePhoto() {
    if (!videoRef.current || !streamRef.current || !cameraReady.current) return null;
    const w = videoRef.current.videoWidth;
    const h = videoRef.current.videoHeight;
    if (!w || !h) return null;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(videoRef.current, 0, 0, w, h);
    return cv.toDataURL("image/jpeg", 0.7);
  }

  // Step 2: Clock in or out confirmed
  async function handleAction(action) {
    if (!identified || busy) return;
    setBusy(true);
    const { emp, activeRecord } = identified;
    const photo = capturePhoto();

    try {
      if (action === "out" && activeRecord) {
        setActiveRecords(prev => prev.filter(r => r.id !== activeRecord.id));
        await clockOut(activeRecord.id, photo);
        setMessage({ type: "success", text: `Clocked out: ${emp.name}` });
      } else if (action === "in") {
        const optimistic = { id: "_opt_" + emp.id, employeeId: emp.id, employee: emp.name, location, clockIn: { toDate: () => new Date() } };
        setActiveRecords(prev => [optimistic, ...prev]);
        await clockIn(emp, location, photo);
        setMessage({ type: "success", text: `Clocked in: ${emp.name} at ${location}` });
      }
    } catch (err) {
      const wasOnline = navigator.onLine;
      setMessage({ type: wasOnline ? "error" : "info", text: wasOnline ? `Error: ${err.message}` : "Offline — punch saved locally, will sync when connected." });
    }

    setTimeout(() => setMessage(null), 4000);
    setIdentified(null);
    setBusy(false);
  }

  const isClockedIn = identified && !!identified.activeRecord;

  return (
    <div style={S.main}>
      <div style={S.clockCard}>

        {/* Date & time */}
        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "2px" }}>
            {new Date().toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </div>
          <div style={{ fontSize: "28px", fontWeight: "500", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>
            <Clock />
          </div>
        </div>

        {message && <div style={S.banner(message.type)}>{message.text}</div>}

        {/* Camera preview */}
        <video ref={videoRef} autoPlay playsInline muted
          style={{ width: "100%", borderRadius: "var(--border-radius-md)", marginBottom: "1.25rem", aspectRatio: "4/3", objectFit: "cover", display: stream ? "block" : "none" }} />
        {cameraError && (
          <div style={{ ...S.banner("error"), marginBottom: "1rem", fontSize: "12px" }}>
            Camera error: {cameraError}
          </div>
        )}

        {!identified ? (
          <>
            {/* Step 1: Enter PIN */}
            <div style={S.label}>Enter PIN</div>
            <div style={S.pinRow}>
              {[0,1,2,3].map(i => <div key={i} style={S.pinDot(i < pin.length)} />)}
            </div>
            <Numpad pin={pin} setPin={setPin} />
          </>
        ) : (
          <>
            {/* Step 2: Confirm action */}
            <div style={{ marginBottom: "1.25rem", padding: "12px 16px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
              <div style={{ fontSize: "16px", fontWeight: "500", color: "var(--color-text-primary)" }}>{identified.emp.name}</div>
              <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
                {isClockedIn ? `Clocked in at ${identified.activeRecord.location} since ${fmt(identified.activeRecord.clockIn)}` : "Not currently clocked in"}
              </div>
            </div>

            {/* Location toggle — only relevant for clock in */}
            <div style={{ marginBottom: "1.25rem" }}>
              <div style={S.label}>Location</div>
              <div style={{ display: "flex", gap: "8px" }}>
                {LOCATIONS.map(l => (
                  <button key={l} type="button"
                    onClick={() => !isClockedIn && setLocation(l)}
                    style={{
                      flex: 1, padding: "10px", fontSize: "14px", fontWeight: "500",
                      borderRadius: "var(--border-radius-md)",
                      border: location === l ? "2px solid #378ADD" : "0.5px solid var(--color-border-tertiary)",
                      background: location === l ? "#E6F1FB" : "var(--color-background-secondary)",
                      color: location === l ? "#185FA5" : isClockedIn ? "var(--color-text-secondary)" : "var(--color-text-primary)",
                      cursor: isClockedIn ? "not-allowed" : "pointer",
                      opacity: isClockedIn ? 0.5 : 1,
                    }}>{l}</button>
                ))}
              </div>
              {isClockedIn && <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "4px" }}>Location locked to original clock-in location</div>}
            </div>

            {/* Clock In / Clock Out buttons */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "1rem" }}>
              <button type="button"
                disabled={isClockedIn || busy}
                onClick={() => handleAction("in")}
                style={{
                  flex: 1, padding: "14px", fontSize: "15px", fontWeight: "500",
                  borderRadius: "var(--border-radius-md)", border: "none",
                  background: !isClockedIn ? "#639922" : "var(--color-background-secondary)",
                  color: !isClockedIn ? "#fff" : "var(--color-text-secondary)",
                  cursor: !isClockedIn ? "pointer" : "not-allowed",
                  opacity: isClockedIn ? 0.4 : 1,
                }}>Clock In</button>
              <button type="button"
                disabled={!isClockedIn || busy}
                onClick={() => handleAction("out")}
                style={{
                  flex: 1, padding: "14px", fontSize: "15px", fontWeight: "500",
                  borderRadius: "var(--border-radius-md)", border: "none",
                  background: isClockedIn ? "#E24B4A" : "var(--color-background-secondary)",
                  color: isClockedIn ? "#fff" : "var(--color-text-secondary)",
                  cursor: isClockedIn ? "pointer" : "not-allowed",
                  opacity: !isClockedIn ? 0.4 : 1,
                }}>Clock Out</button>
            </div>

            <button type="button"
              style={{ width: "100%", padding: "10px", fontSize: "13px", background: "transparent", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-md)", color: "var(--color-text-secondary)", cursor: "pointer" }}
              onClick={() => setIdentified(null)}>← Back</button>
          </>
        )}

        {/* Forgot clock-out warnings — anyone over 12 hours */}
        {activeRecords.filter(r => { const d = tsToDate(r.clockIn); return d && (new Date() - d) > 12 * 3600000; }).map(r => (
          <div key={"warn-"+r.id} style={{ ...S.banner("error"), marginTop: "0.75rem", fontSize: "13px" }}>
            ⚠ {r.employee} has been clocked in for over 12 hours — did they forget to clock out?
          </div>
        ))}

        {/* Currently clocked in — two column layout */}
        {activeRecords.length > 0 && (
          <div style={{ marginTop: "1.25rem" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "8px", fontWeight: "500" }}>
              Currently clocked in ({activeRecords.length})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              {LOCATIONS.map(loc => {
                const locRecords = activeRecords.filter(r => r.location === loc);
                return (
                  <div key={loc} style={{ background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)", overflow: "hidden", minHeight: "60px" }}>
                    <div style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", fontSize: "11px", fontWeight: "500", color: "var(--color-text-secondary)" }}>
                      {loc} · {locRecords.length}
                    </div>
                    {locRecords.length === 0 ? (
                      <div style={{ padding: "10px", fontSize: "12px", color: "var(--color-text-secondary)", fontStyle: "italic" }}>—</div>
                    ) : (
                      locRecords.map(r => (
                        <div key={r.id} style={{ padding: "8px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#639922", flexShrink: 0 }} />
                            <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.employee}</div>
                          </div>
                          <LiveDuration clockIn={r.clockIn} />
                        </div>
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
          <button style={{ background: "none", border: "none", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer" }}
            onClick={onAdmin}>Admin →</button>
        </div>
      </div>
    </div>
  );
}


// ─── Employee Manager ─────────────────────────────────────────────────────────
function EmployeeManager({ employees }) {
  const [adding, setAdding]       = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newName, setNewName]     = useState("");
  const [newPin, setNewPin]       = useState("");
  const [editName, setEditName]   = useState("");
  const [editPin, setEditPin]     = useState("");
  const [msg, setMsg]             = useState(null);

  const inputStyle = { padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", width: "100%" };

  function flash(type, text) { setMsg({ type, text }); setTimeout(() => setMsg(null), 3000); }

  async function addEmployee() {
    if (!newName.trim()) return flash("error", "Name is required.");
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) return flash("error", "PIN must be exactly 4 digits.");
    const pinTaken = employees.find(e => (e.pin || e.PIN) === newPin);
    if (pinTaken) return flash("error", `PIN ${newPin} is already used by ${pinTaken.name}.`);
    await addDoc(collection(db, "employees"), { name: newName.trim(), pin: newPin, active: true });
    setNewName(""); setNewPin(""); setAdding(false);
    flash("success", `${newName.trim()} added.`);
  }

  async function saveEdit(emp) {
    if (!editName.trim()) return flash("error", "Name is required.");
    if (editPin.length !== 4 || !/^\d{4}$/.test(editPin)) return flash("error", "PIN must be 4 digits.");
    const pinTaken = employees.find(e => (e.pin || e.PIN) === editPin && e.id !== emp.id);
    if (pinTaken) return flash("error", `PIN ${editPin} is already used by ${pinTaken.name}.`);
    await updateDoc(doc(db, "employees", emp.id), { name: editName.trim(), pin: editPin });
    setEditingId(null);
    flash("success", "Employee updated.");
  }

  async function toggleActive(emp) {
    await updateDoc(doc(db, "employees", emp.id), { active: !emp.active });
  }

  async function deleteEmployee(emp) {
    if (!window.confirm(`Delete ${emp.name}? This cannot be undone.`)) return;
    await updateDoc(doc(db, "employees", emp.id), { active: false });
    flash("success", `${emp.name} deactivated.`);
  }

  return (
    <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", marginTop: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-primary)" }}>Employees</div>
        <button style={{ ...S.actionBtn("blue"), width: "auto", padding: "6px 14px", marginBottom: 0, fontSize: "13px" }}
          onClick={() => { setAdding(!adding); setNewName(""); setNewPin(""); }}>
          {adding ? "Cancel" : "+ Add employee"}
        </button>
      </div>

      {msg && <div style={{ ...S.banner(msg.type), marginBottom: "12px" }}>{msg.text}</div>}

      {adding && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: "8px", alignItems: "end", marginBottom: "12px", padding: "12px", background: "var(--color-background-secondary)", borderRadius: "var(--border-radius-md)" }}>
          <div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Full name</div>
            <input style={inputStyle} placeholder="e.g. John Smith" value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>4-digit PIN</div>
            <input style={inputStyle} placeholder="e.g. 5678" maxLength={4} value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g,""))} />
          </div>
          <button style={{ ...S.actionBtn("green"), width: "auto", padding: "8px 16px", marginBottom: 0, fontSize: "13px" }}
            onClick={addEmployee}>Add</button>
        </div>
      )}

      <table style={S.table}>
        <thead>
          <tr>{["Name","PIN","Status",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {employees.map(e => (
            <>
              <tr key={e.id}>
                <td style={S.td}>{e.name}</td>
                <td style={{ ...S.td, fontFamily: "var(--font-mono)", fontSize: "12px" }}>••••</td>
                <td style={S.td}><span style={S.badge(e.active ? "green" : "amber")}>{e.active ? "Active" : "Inactive"}</span></td>
                <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                  <button style={{ background: "none", border: "none", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer", textDecoration: "underline", marginRight: "12px" }}
                    onClick={() => { setEditingId(editingId === e.id ? null : e.id); setEditName(e.name); setEditPin(e.pin || e.PIN || ""); }}>
                    {editingId === e.id ? "Cancel" : "Edit"}
                  </button>
                  <button style={{ background: "none", border: "none", fontSize: "12px", color: e.active ? "var(--color-text-danger)" : "var(--color-text-success)", cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => toggleActive(e)}>
                    {e.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
              {editingId === e.id && (
                <tr key={e.id + "-edit"}>
                  <td colSpan={4} style={{ ...S.td, background: "var(--color-background-secondary)", padding: "12px 16px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: "8px", alignItems: "end" }}>
                      <div>
                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Full name</div>
                        <input style={inputStyle} value={editName} onChange={e => setEditName(e.target.value)} />
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>New PIN</div>
                        <input style={inputStyle} maxLength={4} placeholder="4 digits" value={editPin} onChange={e => setEditPin(e.target.value.replace(/\D/g,""))} />
                      </div>
                      <button style={{ ...S.actionBtn("green"), width: "auto", padding: "8px 16px", marginBottom: 0, fontSize: "13px" }}
                        onClick={() => saveEdit(e)}>Save</button>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Admin Screen ─────────────────────────────────────────────────────────────
function AdminScreen({ onBack, employees }) {
  const [pin, setPin]     = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab]     = useState("today");
  const [msg, setMsg]     = useState(null);
  const [records, setRecords] = useState([]);
  const [editing, setEditing]           = useState(null);
  const [editOut, setEditOut]           = useState("");
  const [viewingPhoto, setViewingPhoto] = useState(null);
  const [changingPin, setChangingPin]   = useState(false);
  const [newAdminPin, setNewAdminPin]   = useState("");
  const [confirmAdminPin, setConfirmAdminPin] = useState("");
  const [pinMsg, setPinMsg]             = useState(null);
  const [dateFrom, setDateFrom]         = useState("");
  const [dateTo, setDateTo]             = useState("");
  const [filterEmp, setFilterEmp]       = useState("all");
  const [addingEntry, setAddingEntry]   = useState(false);
  const [manualEmp, setManualEmp]       = useState("");
  const [manualLoc, setManualLoc]       = useState(LOCATIONS[0]);
  const [manualDate, setManualDate]     = useState("");
  const [manualIn, setManualIn]         = useState("");
  const [manualOut, setManualOut]       = useState("");
  const [manualMsg, setManualMsg]       = useState(null);

  useEffect(() => {
    if (pin.length === 4) {
      if (pin === ADMIN_PIN) { setAuthed(true); setPin(""); }
      else { setMsg({ type: "error", text: "Wrong admin PIN" }); setPin(""); setTimeout(() => setMsg(null), 3000); }
    }
  }, [pin]);

  // Live listener for all timecards
  useEffect(() => {
    if (!authed) return;
    const q = query(collection(db, "timecards"), orderBy("clockIn", "desc"));
    const unsub = onSnapshot(q, snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [authed]);

  async function changeAdminPin() {
    if (newAdminPin.length !== 4 || !/^\d{4}$/.test(newAdminPin)) {
      setPinMsg({ type: "error", text: "PIN must be exactly 4 digits." }); return;
    }
    if (newAdminPin !== confirmAdminPin) {
      setPinMsg({ type: "error", text: "PINs don't match." }); return;
    }
    await saveAdminPin(newAdminPin);
    setNewAdminPin(""); setConfirmAdminPin(""); setChangingPin(false);
    setPinMsg({ type: "success", text: "Admin PIN updated successfully." });
    setTimeout(() => setPinMsg(null), 3000);
  }

  async function saveManualEntry() {
    if (!manualEmp) return setManualMsg({ type: "error", text: "Select an employee." });
    if (!manualDate) return setManualMsg({ type: "error", text: "Enter a date." });
    if (!manualIn) return setManualMsg({ type: "error", text: "Enter a clock-in time." });
    const [ih, im] = manualIn.split(":").map(Number);
    const clockInDate = new Date(manualDate); clockInDate.setHours(ih, im, 0, 0);
    let clockOutDate = null;
    if (manualOut) {
      const [oh, om] = manualOut.split(":").map(Number);
      clockOutDate = new Date(manualDate); clockOutDate.setHours(oh, om, 0, 0);
      if (clockOutDate <= clockInDate) return setManualMsg({ type: "error", text: "Clock-out must be after clock-in." });
    }
    const emp = employees.find(e => e.name === manualEmp);
    await addDoc(collection(db, "timecards"), {
      employeeId: emp?.id || "manual",
      employee:   manualEmp,
      location:   manualLoc,
      clockIn:    Timestamp.fromDate(clockInDate),
      clockOut:   clockOutDate ? Timestamp.fromDate(clockOutDate) : null,
      photoIn:    null, photoOut: null,
      manual:     true,
    });
    setManualMsg({ type: "success", text: `Entry added for ${manualEmp}.` });
    setManualEmp(""); setManualDate(""); setManualIn(""); setManualOut("");
    setTimeout(() => { setManualMsg(null); setAddingEntry(false); }, 2000);
  }

  async function saveEdit(record) {
    if (!editOut) return;
    const [h, m] = editOut.split(":").map(Number);
    const base = tsToDate(record.clockIn) || new Date();
    const corrected = new Date(base);
    corrected.setHours(h, m, 0, 0);
    await updateDoc(doc(db, "timecards", record.id), { clockOut: Timestamp.fromDate(corrected) });
    setEditing(null);
    setEditOut("");
  }

  if (!authed) return (
    <div style={S.main}>
      <div style={S.clockCard}>
        <div style={{ fontSize: "15px", fontWeight: "500", marginBottom: "1.5rem", color: "var(--color-text-primary)" }}>Admin login</div>
        {msg && <div style={S.banner(msg.type)}>{msg.text}</div>}
        <div style={S.label}>Admin PIN</div>
        <div style={S.pinRow}>{[0,1,2,3].map(i => <div key={i} style={S.pinDot(i < pin.length)} />)}</div>
        <Numpad pin={pin} setPin={setPin} />
        <button style={{ ...S.actionBtn(""), marginTop: "8px" }} onClick={onBack}>← Back</button>
      </div>
    </div>
  );

  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const weekStart  = new Date(todayStart); weekStart.setDate(weekStart.getDate()-7);

  const filtered = records.filter(r => {
    const d = tsToDate(r.clockIn);
    if (!d) return false;
    if (tab === "today") { if (d < todayStart) return false; }
    else if (tab === "week") { if (d < weekStart) return false; }
    else if (tab === "range") {
      if (dateFrom) { const from = new Date(dateFrom); from.setHours(0,0,0,0); if (d < from) return false; }
      if (dateTo)   { const to   = new Date(dateTo);   to.setHours(23,59,59,999); if (d > to) return false; }
    }
    if (filterEmp !== "all" && r.employee !== filterEmp) return false;
    return true;
  });

  const activeCount   = records.filter(r => !r.clockOut).length;
  const todayRecords  = records.filter(r => { const d = tsToDate(r.clockIn); return d && d >= todayStart; });
  const totalTodayMs  = todayRecords.reduce((a, r) => a + durMs(r), 0);

  return (
    <div style={S.main}>
      <div style={S.adminWrap}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ fontSize: "16px", fontWeight: "500", color: "var(--color-text-primary)" }}>Admin dashboard</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button style={{ ...S.actionBtn("blue"), width: "auto", padding: "8px 16px", marginBottom: 0 }} onClick={() => exportCSV(filtered)}>CSV</button>
            <button style={{ ...S.actionBtn("green"), width: "auto", padding: "8px 16px", marginBottom: 0 }} onClick={() => exportPDF(filtered, tab === "today" ? "Today" : tab === "week" ? "This week" : "All records")}>PDF</button>
            <button style={{ ...S.actionBtn(""), width: "auto", padding: "8px 16px", marginBottom: 0 }} onClick={() => setChangingPin(!changingPin)}>Change PIN</button>
            <button style={{ ...S.actionBtn(""), width: "auto", padding: "8px 16px", marginBottom: 0 }} onClick={onBack}>← Back</button>
          </div>
        </div>

        <div style={S.statGrid}>
          <div style={S.statCard}><div style={S.statLabel}>Clocked in now</div><div style={S.statValue}>{activeCount}</div></div>
          <div style={S.statCard}><div style={S.statLabel}>Entries today</div><div style={S.statValue}>{todayRecords.length}</div></div>
          <div style={S.statCard}><div style={S.statLabel}>Hours today</div><div style={S.statValue}>{fmtDuration(totalTodayMs)}</div></div>
        </div>

        {changingPin && (
          <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
            <div style={{ fontSize: "13px", fontWeight: "500", marginBottom: "12px", color: "var(--color-text-primary)" }}>Change admin PIN</div>
            {pinMsg && <div style={{ ...S.banner(pinMsg.type), marginBottom: "12px" }}>{pinMsg.text}</div>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", alignItems: "end" }}>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>New PIN</div>
                <input type="password" maxLength={4} value={newAdminPin} onChange={e => setNewAdminPin(e.target.value.replace(/\D/g,""))}
                  placeholder="4 digits"
                  style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
              </div>
              <div>
                <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Confirm PIN</div>
                <input type="password" maxLength={4} value={confirmAdminPin} onChange={e => setConfirmAdminPin(e.target.value.replace(/\D/g,""))}
                  placeholder="4 digits"
                  style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
              </div>
              <button style={{ ...S.actionBtn("green"), width: "auto", padding: "8px 16px", marginBottom: 0, fontSize: "13px" }}
                onClick={changeAdminPin}>Save</button>
            </div>
          </div>
        )}

        <div style={{ marginBottom: "1.5rem" }}>
          <div style={S.tabRow}>
            {["today","week","all","range"].map(t => (
              <button key={t} style={S.tab(tab===t)} onClick={() => setTab(t)}>
                {t==="today"?"Today":t==="week"?"This week":t==="all"?"All":"Date range"}
              </button>
            ))}
          </div>

          {tab === "range" && (
            <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>From</span>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  style={{ padding: "6px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>To</span>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  style={{ padding: "6px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Employee</span>
            <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)}
              style={{ padding: "6px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
              <option value="all">All employees</option>
              {[...new Set(records.map(r => r.employee))].sort().map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginLeft: "auto" }}>
              {filtered.length} record{filtered.length !== 1 ? "s" : ""} · {fmtDuration(filtered.reduce((a,r) => a + durMs(r), 0))} total
            </span>
          </div>
        </div>

        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", overflow: "hidden", marginBottom: "1.5rem" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-secondary)", fontSize: "14px" }}>
              No records for this period.
            </div>
          ) : (
            <table style={S.table}>
              <thead>
                <tr>{["Employee","Location","Date","In","Out","Duration","Status",""].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <>
                    <tr key={r.id}>
                      <td style={S.td}>{r.employee}</td>
                      <td style={S.td}>{r.location}</td>
                      <td style={S.td}>{fmtDate(r.clockIn)}</td>
                      <td style={S.td}>{fmt(r.clockIn)}</td>
                      <td style={S.td}>{fmt(r.clockOut)}</td>
                      <td style={S.td}>{fmtDuration(durMs(r))}</td>
                      <td style={S.td}><span style={S.badge(r.clockOut?"green":"amber")}>{r.clockOut?"Complete":"Active"}</span></td>
                      <td style={{ ...S.td, whiteSpace: "nowrap" }}>
                        <button
                          style={{ background: "none", border: "none", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer", textDecoration: "underline", marginRight: "10px" }}
                          onClick={() => { setEditing(editing===r.id?null:r.id); setEditOut(""); }}>
                          {editing===r.id ? "Cancel" : "Edit"}
                        </button>
                        {(r.photoIn || r.photoOut) && (
                          <button
                            style={{ background: "none", border: "none", fontSize: "12px", color: "var(--color-text-info)", cursor: "pointer", textDecoration: "underline" }}
                            onClick={() => setViewingPhoto({ photoIn: r.photoIn, photoOut: r.photoOut, employee: r.employee, clockIn: r.clockIn, clockOut: r.clockOut })}>
                            Photos
                          </button>
                        )}
                      </td>
                    </tr>
                    {editing === r.id && (
                      <tr key={r.id+"-edit"}>
                        <td colSpan={8} style={{ ...S.td, background: "var(--color-background-secondary)", padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px" }}>
                            <span style={{ color: "var(--color-text-secondary)" }}>Correct clock-out time:</span>
                            <input type="time" value={editOut} onChange={e => setEditOut(e.target.value)}
                              style={{ padding: "6px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }} />
                            <button style={{ ...S.actionBtn("green"), width: "auto", padding: "6px 16px", marginBottom: 0, fontSize: "13px" }}
                              onClick={() => saveEdit(r)}>Save</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Manual entry */}
        <div style={{ background: "var(--color-background-primary)", border: "0.5px solid var(--color-border-tertiary)", borderRadius: "var(--border-radius-lg)", padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: addingEntry ? "12px" : "0" }}>
            <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--color-text-primary)" }}>Add missed entry</div>
            <button style={{ ...S.actionBtn("amber"), width: "auto", padding: "6px 14px", marginBottom: 0, fontSize: "13px" }}
              onClick={() => { setAddingEntry(!addingEntry); setManualMsg(null); }}>
              {addingEntry ? "Cancel" : "+ Add entry"}
            </button>
          </div>
          {addingEntry && (
            <div>
              {manualMsg && <div style={{ ...S.banner(manualMsg.type), marginBottom: "12px" }}>{manualMsg.text}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Employee</div>
                  <select value={manualEmp} onChange={e => setManualEmp(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
                    <option value="">Select employee</option>
                    {employees.filter(e => e.active).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Location</div>
                  <select value={manualLoc} onChange={e => setManualLoc(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)" }}>
                    {LOCATIONS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Date</div>
                  <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Clock in</div>
                    <input type="time" value={manualIn} onChange={e => setManualIn(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "4px" }}>Clock out</div>
                    <input type="time" value={manualOut} onChange={e => setManualOut(e.target.value)}
                      style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", boxSizing: "border-box" }} />
                  </div>
                </div>
              </div>
              <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "8px" }}>Clock-out is optional — leave blank if still unknown.</div>
              <button style={{ ...S.actionBtn("green"), marginBottom: 0 }} onClick={saveManualEntry}>Save entry</button>
            </div>
          )}
        </div>

        {/* Employee management */}
        <EmployeeManager employees={employees} />
      </div>

      {/* Photo lightbox */}
      {viewingPhoto && (
        <div onClick={() => setViewingPhoto(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: "1rem" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", padding: "1.5rem", maxWidth: "560px", width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div style={{ fontSize: "14px", fontWeight: "500", color: "var(--color-text-primary)" }}>{viewingPhoto.employee}</div>
              <button onClick={() => setViewingPhoto(null)} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer", color: "var(--color-text-secondary)" }}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: viewingPhoto.photoOut ? "1fr 1fr" : "1fr", gap: "12px" }}>
              {viewingPhoto.photoIn && (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>Clock in · {fmt(viewingPhoto.clockIn)}</div>
                  <img src={viewingPhoto.photoIn} alt="Clock in" style={{ width: "100%", borderRadius: "var(--border-radius-md)", display: "block" }} />
                </div>
              )}
              {viewingPhoto.photoOut && (
                <div>
                  <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>Clock out · {fmt(viewingPhoto.clockOut)}</div>
                  <img src={viewingPhoto.photoOut} alt="Clock out" style={{ width: "100%", borderRadius: "var(--border-radius-md)", display: "block" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Device Setup ─────────────────────────────────────────────────────────────
function DeviceSetup({ onAuth }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(null);

  function tryCode() {
    if (DEVICE_CODES.includes(code.trim().toUpperCase())) {
      onAuth();
    } else {
      setError("Invalid code. Contact your manager.");
      setTimeout(() => setError(null), 3000);
      setCode("");
    }
  }

  return (
    <div style={{ ...S.app, alignItems: "center", justifyContent: "center", background: "var(--color-background-tertiary)" }}>
      <div style={{ ...S.clockCard, maxWidth: "360px", textAlign: "center" }}>
        <div style={{ fontSize: "22px", fontWeight: "500", color: "var(--color-text-primary)", marginBottom: "8px" }}>TimeCard</div>
        <div style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginBottom: "2rem" }}>
          This device needs to be authorized before use. Enter the setup code provided by your manager.
        </div>
        {error && <div style={{ ...S.banner("error"), marginBottom: "1rem" }}>{error}</div>}
        <input
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          placeholder="Enter setup code"
          style={{ width: "100%", padding: "12px", fontSize: "16px", textAlign: "center", letterSpacing: "3px", border: "0.5px solid var(--color-border-secondary)", borderRadius: "var(--border-radius-md)", background: "var(--color-background-primary)", color: "var(--color-text-primary)", marginBottom: "12px", boxSizing: "border-box" }}
        />
        <button
          onClick={tryCode}
          style={{ ...S.actionBtn("blue"), marginBottom: 0 }}>
          Authorize device
        </button>
      </div>
    </div>
  );
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen]       = useState("clock");
  const [employees, setEmployees] = useState([]);
  const [online, setOnline]       = useState(navigator.onLine);
  const [loading, setLoading]     = useState(true);
  const [deviceAuth, setDeviceAuth] = useState(() => localStorage.getItem("tc_device_auth") === "true");


  // Online/offline detection
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Load admin PIN + employees
  useEffect(() => {
    loadAdminPin();
    const q = query(collection(db, "employees"), orderBy("name"));
    const unsub = onSnapshot(q, snap => {
      setEmployees(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return unsub;
  }, []);

  if (!deviceAuth) return (
    <DeviceSetup onAuth={() => { localStorage.setItem("tc_device_auth", "true"); setDeviceAuth(true); }} />
  );

  if (loading) return (
    <div style={{ ...S.app, alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>Connecting…</div>
    </div>
  );

  return (
    <div style={S.app}>
      <header style={S.header}>
        <div>
          <span style={S.logo}>TimeCard</span>
          <span style={S.logoSub}>Gibraltar · Lorimar</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {!online && <span style={S.offlinePill}>Offline — syncs when connected</span>}
          <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {screen === "admin" ? "Admin" : "Clock in / out"}
          </span>
        </div>
      </header>

      {screen === "clock"
        ? <ClockScreen onAdmin={() => setScreen("admin")} employees={employees} />
        : <AdminScreen onBack={() => setScreen("clock")} employees={employees} />}
    </div>
  );
}