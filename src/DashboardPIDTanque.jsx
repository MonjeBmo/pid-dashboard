import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import SimuladorArduino from "./SimuladorArduino";

export default function DashboardPIDTanque() {
  // ---------- conexión ----------
  const [port, setPort] = useState(null);
  const [connected, setConnected] = useState(false);
  const readerRef = useRef(null);
  const writerRef = useRef(null);

  // ---------- buffers / estados ----------
  const [rows, setRows] = useState([]);
  const rowsRef = useRef([]);
  const pendingRef = useRef([]);
  const maxPoints = 3600;

  const [consoleLines, setConsoleLines] = useState([]);
  const consoleRef = useRef(null);
  const [autoscroll, setAutoscroll] = useState(
    () => (localStorage.getItem("autoscroll") ?? "1") === "1"
  );
  useEffect(() => localStorage.setItem("autoscroll", autoscroll ? "1" : "0"), [autoscroll]);

  // ---------- simulación ----------
  const [modoSimulacion, setModoSimulacion] = useState(false);

  // ---------- PID y SP (persistentes) ----------
  const [sp, setSp] = useState(() => Number(localStorage.getItem("sp") ?? 80));
  const [kp, setKp] = useState(() => Number(localStorage.getItem("kp") ?? 1.2));
  const [ki, setKi] = useState(() => Number(localStorage.getItem("ki") ?? 0.4));
  const [kd, setKd] = useState(() => Number(localStorage.getItem("kd") ?? 0.05));
  useEffect(() => localStorage.setItem("sp", String(sp)), [sp]);
  useEffect(() => localStorage.setItem("kp", String(kp)), [kp]);
  useEffect(() => localStorage.setItem("ki", String(ki)), [ki]);
  useEffect(() => localStorage.setItem("kd", String(kd)), [kd]);

  const lastRow = rows.length ? rows[rows.length - 1] : null;

  // ---------- util ----------
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  // ---------- batch UI updates (suave) ----------
  useEffect(() => {
    const tick = setInterval(() => {
      if (!pendingRef.current.length) return;
      rowsRef.current.push(...pendingRef.current);
      pendingRef.current = [];
      if (rowsRef.current.length > maxPoints) {
        rowsRef.current.splice(0, rowsRef.current.length - maxPoints);
      }
      setRows([...rowsRef.current]);
    }, 200); // Menos repintados
    return () => clearInterval(tick);
  }, []);

  // ---------- parse ----------
  const handleLine = (line) => {
    if (!line) return;

    if (line.startsWith("DATA,")) {
      const p = line.split(",");
      // Esperado: DATA,ms,nivel,flow,kPa,PWM,alarm,running,manual
      if (p.length >= 9) {
        const t = Number(p[1]) || 0;
        const nivel = Number(p[2]) ?? 0;
        const flow = Number(p[3]) ?? 0;
        const kpa = Number(p[4]) ?? 0;
        const pwm = Number(p[5]) || 0;
        const alarm = p[6] === "1";
        const running = p[7] === "1";
        const manual = p[8] === "1";
        pendingRef.current.push({ t, nivel, flow, kpa, pwm, alarm, running, manual });
      } else {
        queueConsole(`WARN DATA incompleta (${p.length}): ${line}`);
      }
    } else {
      queueConsole(line);
    }
  };

  const queueConsole = (msg) => {
    setConsoleLines((prev) => {
      const next = [...prev, `${new Date().toLocaleTimeString()}  ${msg}`];
      // Limita a 200 líneas máximo
      while (next.length > 200) next.shift();
      return next;
    });
  };

  // ---------- conexión Web Serial ----------
  const cleanupConnection = async () => {
    try {
      if (readerRef.current) {
        try { await readerRef.current.cancel(); } catch {}
        try { readerRef.current.releaseLock(); } catch {}
        readerRef.current = null;
      }
      if (writerRef.current) {
        try { writerRef.current.releaseLock(); } catch {}
        writerRef.current = null;
      }
      if (port) {
        try { await port.close(); } catch {}
      }
    } finally {
      setConnected(false);
      setPort(null);
    }
  };

  const connect = async () => {
    try {
      const p = await navigator.serial.requestPort();
      await openPort(p);
    } catch (err) {
      console.error(err);
      alert("No se pudo abrir el puerto.");
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const ports = await navigator.serial.getPorts();
        if (ports && ports.length === 1) {
          await openPort(ports[0]);
        }
      } catch {}
    })();
    const onDisc = async (e) => {
      if (e?.target === port) {
        queueConsole("🔌 Puerto desconectado");
        await cleanupConnection();
      }
    };
    navigator.serial.addEventListener("disconnect", onDisc);
    return () => {
      navigator.serial.removeEventListener("disconnect", onDisc);
    };
  }, [port]);

  const openPort = async (p) => {
    await p.open({ baudRate: 9600 });
    try { await p.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch {}

    const td = new TextDecoderStream();
    p.readable.pipeTo(td.writable);
    const reader = td.readable.getReader();
    readerRef.current = reader;

    const te = new TextEncoderStream();
    te.readable.pipeTo(p.writable);
    const writer = te.writable.getWriter();
    writerRef.current = writer;

    setPort(p);
    setConnected(true);
    queueConsole("✅ Conectado");

    (async () => {
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let idx;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).replace(/\r$/, "");
            buffer = buffer.slice(idx + 1);
            if (line) handleLine(line);
          }
        }
      } catch (e) {
        queueConsole("⚠️ Error de lectura, cerrando...");
      } finally {
        try { reader.releaseLock(); } catch {}
        await cleanupConnection();
      }
    })();
  };

  const disconnect = async () => {
    queueConsole("⛔ Desconectando...");
    await cleanupConnection();
  };

  // ---------- envío ----------
  const send = async (text) => {
    if (!writerRef.current) {
      queueConsole("ERROR: writer no disponible");
      return;
    }
    try {
      await writerRef.current.write(text + "\n");
      console.log(">>", text);
    } catch (err) {
      queueConsole(`ERROR enviando: ${text}`);
      await cleanupConnection();
    }
  };

  // ---------- atajos PID / SP ----------
  const sendSP = () => { send(`SP,${sp}`); queueConsole(`🎯 SP=${sp}%`); };
  const sendKP = () => { send(`KP,${kp}`); queueConsole(`⚙️ Kp=${kp}`); };
  const sendKI = () => { send(`KI,${ki}`); queueConsole(`⚙️ Ki=${ki}`); };
  const sendKD = () => { send(`KD,${kd}`); queueConsole(`⚙️ Kd=${kd}`); };

  // ---------- consola autoscroll ----------
  useEffect(() => {
    if (autoscroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLines, autoscroll]);

  // ---------- métricas de salud del stream ----------
  const streamHealth = useMemo(() => {
    if (rows.length < 5) return { stale: true, hz: 0 };
    const N = Math.min(30, rows.length - 1);
    const tail = rows.slice(-N);
    const dts = tail.slice(1).map((r, i) => r.t - tail[i].t);
    const avg = dts.reduce((a, b) => a + b, 0) / dts.length || 0;
    const hz = avg > 0 ? 1000 / avg : 0;
    const lastAge = Date.now() - window._lastDataTimeMs || 0;
    const stale = lastAge > 1500;
    return { stale, hz: Number(hz.toFixed(1)) };
  }, [rows]);

  useEffect(() => {
    if (!rows.length) return;
    window._lastDataTimeMs = Date.now();
  }, [rows]);

  // ---------- datos para charts (últimos 500) ----------
  const chartData = useMemo(() => {
    const recent = rows.slice(-300); // Menos puntos, menos SVG
    return recent.map((r) => ({
      time: fmtTime(r.t),
      nivel: Number(r.nivel.toFixed(2)),
      flow: Number(r.flow.toFixed(2)),
      kpa: Number(r.kpa.toFixed(2)),
      pwm: r.pwm,
    }));
  }, [rows]);

  // Actualiza el cache de filas para exportar
  useEffect(() => {
    window.__rowsCache = rows;
    window.__rowsLast = rows;
  }, [rows]);

  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#e6ebf2]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">

        {/* Header */}
        <header className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">PID Tanque Piloto · Panel</h1>
            <div className="flex items-center gap-3 mt-2 text-sm">
              <span className={`px-2 py-0.5 rounded-full ${connected ? "bg-emerald-600/30 text-emerald-300" : "bg-slate-600/30 text-slate-300"}`}>
                {connected ? "Conectado" : "Desconectado"}
              </span>
              <span className={`px-2 py-0.5 rounded-full ${streamHealth.stale ? "bg-rose-600/30 text-rose-300" : "bg-sky-600/30 text-sky-300"}`}>
                {streamHealth.stale ? "Sin datos recientes" : `~${streamHealth.hz} Hz`}
              </span>
              {lastRow && (
                <span className="px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-300">
                  t={fmtTime(lastRow.t)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!connected ? (
              <Button onClick={connect} className="rounded-2xl bg-emerald-600 hover:bg-emerald-700">
                🔌 Conectar
              </Button>
            ) : (
              <Button onClick={disconnect} variant="destructive" className="rounded-2xl">
                ❌ Desconectar
              </Button>
            )}
          </div>
        </header>

        {/* Simulador */}
        {modoSimulacion && <SimuladorArduino onData={(line) => handleLine(line)} />}
        <Card className="bg-[#11162a] border-none shadow mb-4">
          <CardContent className="p-3 flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">Modo Simulación</div>
              <div className="text-xs opacity-70">Prueba la UI sin Arduino, genera DATA sintética.</div>
            </div>
            <Switch checked={modoSimulacion} onCheckedChange={setModoSimulacion} />
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Kpi title="Nivel" value={lastRow ? `${lastRow.nivel.toFixed(1)}%` : "–"} aux={`Raw: ${lastRow ? lastRow.nivel.toFixed(1) : "N/A"}`} />
          <Kpi title="Flujo" value={lastRow ? `${lastRow.flow.toFixed(2)} L/min` : "–"} aux={`Raw: ${lastRow ? lastRow.flow : "N/A"}`} />
          <Kpi title="Presión" value={lastRow ? `${lastRow.kpa.toFixed(1)} kPa` : "–"} aux={`Raw: ${lastRow ? lastRow.kpa : "N/A"}`} />
          <Kpi title="PWM" value={lastRow ? `${lastRow.pwm}` : "–"} aux={`Raw: ${lastRow ? lastRow.pwm : "N/A"}`} />
        </div>

        {/* Estado */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <StateCard label="Estado" value={lastRow?.running ? "RUNNING" : "STOPPED"} emoji={lastRow?.running ? "▶️" : "⏹️"} active={!!lastRow?.running} />
          <StateCard label="Modo" value={lastRow?.manual ? "MANUAL (EXTRA)" : "PID (AUTO)"} emoji={lastRow?.manual ? "🛠️" : "🤖"} active={!!lastRow?.manual} />
          <StateCard label="Alarma" value={lastRow?.alarm ? "ACTIVA" : "OK"} emoji={lastRow?.alarm ? "🚨" : "✅"} active={!!lastRow?.alarm} danger />
        </div>

        {/* Controles */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* Proceso */}
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">Proceso</div>
              <div className="flex flex-col gap-3 md:flex-row md:gap-6">
                {/* Botones de proceso */}
                <div className="flex flex-col gap-2 min-w-[180px]">
                  <div className="flex gap-2">
                    <Button onClick={() => { send("START"); queueConsole("▶️ START"); }} disabled={!connected}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 hover:scale-105">▶️ START</Button>
                    <Button onClick={() => { send("STOP"); queueConsole("⏹️ STOP"); }} disabled={!connected}
                      variant="secondary" className="flex-1 hover:bg-red-600/80 hover:scale-105">⏹️ STOP</Button>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => { send("START-EXTRA"); queueConsole("🛠️ START-EXTRA"); }} disabled={!connected}
                      className="flex-1 bg-amber-600 hover:bg-amber-700 hover:scale-105">🛠️ START-EXTRA</Button>
                    <Button onClick={() => { send("STOP-EXTRA"); queueConsole("🔧 STOP-EXTRA"); }} disabled={!connected}
                      variant="secondary" className="flex-1 hover:bg-orange-600/80 hover:scale-105">🔧 STOP-EXTRA</Button>
                  </div>
                </div>
                
              </div>
            </CardContent>
          </Card>

         

          {/* SD / utilidades */}
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">💾 SD / Utilidades</div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => { send("SD-STATUS"); queueConsole("📋 SD-STATUS"); }}
                  disabled={!connected} className="hover:scale-105">📋 SD-STATUS</Button>
                <Button onClick={() => { send("SD-NEWFILE"); queueConsole("📝 SD-NEWFILE"); }}
                  disabled={!connected} className="hover:scale-105">📝 SD-NEWFILE</Button>
                <Button onClick={() => { send("LVL-RESET"); queueConsole("🔄 LVL-RESET"); }}
                  disabled={!connected} className="hover:scale-105">🔄 LVL-RESET</Button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-sm opacity-75">🔄 Autoscroll consola</div>
                <Switch checked={autoscroll} onCheckedChange={setAutoscroll} />
              </div>
            </CardContent>
          </Card>

          {/* Nuevas Opciones */}
          <Card className="bg-[#11162a] border-none shadow mb-4">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">Opciones</div>
              {/* Setpoint y utilidades */}
                <div className="flex-1 flex flex-col gap-2">
                  <Label>Setpoint nivel (%)</Label>
                  <div className="flex gap-2">
                    <Input type="number" min={0} max={100} value={sp}
                      onChange={(e)=>setSp(Math.max(0, Math.min(100, Number(e.target.value))))}
                      className="bg-black/30 w-24" />
                    <Button onClick={sendSP} disabled={!connected} className="whitespace-nowrap hover:scale-105">🎯 Enviar SP</Button>
                  </div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {[50,60,70,80,90].map(v => (
                      <Button key={v} variant="outline" className="h-8 px-2 text-xs"
                        disabled={!connected}
                        onClick={() => { setSp(v); send(`SP,${v}`); queueConsole(`🎯 SP=${v}%`); }}>
                        {v}%
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <Button onClick={() => {
                      if (rowsRef.current.length === 0 || window.confirm(`¿Limpiar ${rowsRef.current.length} registros?`)) {
                        rowsRef.current = []; setRows([]);
                        queueConsole("🗑️ Memoria limpiada");
                      }
                    }} variant="outline" className="flex-1 hover:bg-red-500/20 hover:scale-105">🗑️ Limpiar</Button>
                    <Button onClick={downloadCSV} variant="outline" className="flex-1 hover:bg-emerald-500/20 hover:scale-105"
                      disabled={rows.length===0}>📥 Exportar</Button>
                  </div>
                </div>
              <div className="text-xs opacity-70 mt-2">
                Aquí puedes agregar más opciones de configuración rápida para el panel.
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gráficos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Nivel (%)</div>
                <div className="text-sm opacity-70">
                  {chartData.length} puntos | {lastRow ? `${lastRow.nivel.toFixed(1)}%` : '---'}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <YAxis domain={[0, 100]} tickCount={6} stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value) => `${Number(value).toFixed(2)}%`}/>
                    <Legend />
                    <ReferenceLine y={sp} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `SP ${sp}%`, fill: "#ef4444", position: "left" }} />
                    <Line type="monotone" dataKey="nivel" name="Nivel (%)"
                      stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Flujo (L/min) y Presión (kPa)</div>
                <div className="text-sm opacity-70">
                  {chartData.length} puntos | F: {lastRow ? lastRow.flow.toFixed(2) : '---'} | P: {lastRow ? lastRow.kpa.toFixed(1) : '---'}
                </div>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <YAxis yAxisId="left" orientation="left" stroke="#3b82f6" tick={{ fill: '#3b82f6' }}
                      domain={['auto', 'auto']} label={{ value: 'L/min', angle: -90, position: 'insideLeft', fill: '#3b82f6' }}/>
                    <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" tick={{ fill: '#f59e0b' }}
                      domain={['auto', 'auto']} label={{ value: 'kPa', angle: 90, position: 'insideRight', fill: '#f59e0b' }}/>
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value, name) => (name === "Flujo (L/min)" ? `${Number(value).toFixed(2)} L/min` :
                                                          name === "Presión (kPa)" ? `${Number(value).toFixed(2)} kPa` : value)}/>
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="flow" name="Flujo (L/min)"
                      stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false}/>
                    <Line yAxisId="right" type="monotone" dataKey="kpa" name="Presión (kPa)"
                      stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={2} dot={false} isAnimationActive={false}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* PWM */}
        <div className="grid grid-cols-1 gap-4 mb-12">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">PWM (0-255)</div>
                <div className="text-sm opacity-70">{chartData.length} puntos | {lastRow ? lastRow.pwm : '---'}</div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <YAxis domain={[0, 255]} tickCount={6} stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#e5e7eb' }}/>
                    <Legend />
                    <Line type="monotone" dataKey="pwm" name="PWM"
                      stroke="#8b5cf6" strokeWidth={2} dot={false} isAnimationActive={false}/>
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Consola */}
        <Card className="bg-[#11162a] border-none shadow mb-8">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Consola</div>
              <Button variant="outline" onClick={() => setConsoleLines([])}>Limpiar</Button>
            </div>
            <div ref={consoleRef} className="h-48 overflow-auto bg-black/30 rounded-xl p-2 text-sm leading-6">
              {consoleLines.map((l, i) => (<div key={i} className="whitespace-pre">{l}</div>))}
            </div>
            <div className="text-xs opacity-70 mt-2">
              Formato esperado: <code>DATA,ms,level%,flow,kPa,PWM,alarm,running,manual</code>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ========= componentes pequeños reutilizables =========
function Kpi({ title, value, aux }) {
  return (
    <Card className="bg-[#11162a] border-none shadow">
      <CardContent className="p-4">
        <div className="text-sm opacity-70">{title}</div>
        <div className="text-3xl font-bold">{value}</div>
        <div className="text-xs opacity-50 mt-1">{aux}</div>
      </CardContent>
    </Card>
  );
}

function StateCard({ label, value, emoji, active, danger }) {
  const bg = danger
    ? active ? "bg-rose-900/40" : "bg-[#11162a]"
    : active ? "bg-emerald-900/40" : "bg-[#11162a]";
  return (
    <Card className={`border-none shadow ${bg}`}>
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <div className="text-sm opacity-70">{label}</div>
          <div className="text-xl font-semibold">{value}</div>
        </div>
        <div className="text-3xl">{emoji}</div>
      </CardContent>
    </Card>
  );
}

function PidField({ label, value, set, onSend, connected }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input type="number" step="0.01" value={value}
        onChange={(e)=>set(Number(e.target.value))} className="bg-black/30" />
      <Button className="mt-2 w-full hover:scale-105 transition-all" onClick={onSend} disabled={!connected}>
        ✓ Enviar
      </Button>
    </div>
  );
}

// ---------- export CSV ----------
function downloadCSV() {
  const win = window;
  const rows = win.__rowsCache ?? [];
  const stateRows = win.__rowsLast ?? [];
  const data = rows.length ? rows : stateRows;
  if (!data.length) { alert("No hay datos para exportar."); return; }
  // Genera CSV
  const header = "ms,nivel,flow,kPa,PWM,alarm,running,manual";
  const csv = [
    header,
    ...data.map(r =>
      [r.t, r.nivel, r.flow, r.kpa, r.pwm, r.alarm ? 1 : 0, r.running ? 1 : 0, r.manual ? 1 : 0].join(",")
    )
  ].join("\n");
  // Descarga
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pid_tanque_${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}
