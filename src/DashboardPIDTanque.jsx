import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

/**
 * Dashboard Web Serial – PID Tanque Piloto
 * -----------------------------------------------------
 * Visualiza y controla tu rutina de Arduino (sketch del usuario).
 * - Requiere Chrome/Edge (Web Serial) y servir en https:// o http://localhost
 * - Baud: 9600
 * - El sketch emite líneas como:
 *   DATA,<ms>,<nivel%>,<flow L/min>,<kPa>,<PWM>,<alarm>,<running>,<manual>\n
 *   Además responde a comandos: START, STOP, START-EXTRA, STOP-EXTRA, RESET,
 *   SD-STATUS, SD-NEWFILE, y ajustes SP,KP,KI,KD con el formato: "SP,80" etc.
 */

export default function DashboardPIDTanque() {
  const [port, setPort] = useState(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);

  // Buffers de datos (hasta ~10 minutos a 5 Hz => 3000 puntos aprox.)
  const [rows, setRows] = useState([]); // objetos con {t, nivel, flow, kpa, pwm, alarm, running, manual}
  const maxPoints = 3600; // limita memoria

  // Estados de proceso/alarma
  const lastRow = rows.length ? rows[rows.length - 1] : null;

  // Setpoint y PID tunings (UI -> comandos)
  const [sp, setSp] = useState(80);
  const [kp, setKp] = useState(1.2);
  const [ki, setKi] = useState(0.4);
  const [kd, setKd] = useState(0.05);

  // Util para mostrar minutos:segundos desde ms
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${m}:${ss.toString().padStart(2, "0")}`;
  };

  // --- Web Serial: conectar ---
// 1) Suscríbete a eventos globales UNA vez (por ejemplo en useEffect):
const rowsRef = useRef([]);
const pendingRef = useRef([]);

useEffect(() => {
  const tick = setInterval(() => {
    if (pendingRef.current.length === 0) return;

    rowsRef.current.push(...pendingRef.current);
    pendingRef.current = [];

    if (rowsRef.current.length > maxPoints) {
      rowsRef.current.splice(0, rowsRef.current.length - maxPoints);
    }

    setRows([...rowsRef.current]);
  }, 200);
  
  return () => clearInterval(tick);
}, []);


async function cleanCloseFromDisconnect() {
  try {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current.releaseLock();
    }
    if (writerRef.current) {
      writerRef.current.releaseLock();
    }
    if (port) await port.close();
  } catch {}
  setConnected(false);
  setPort(null);
}

// 2) Conectar: espera y configura señales
const connect = async () => {
  try {
    const p = await navigator.serial.requestPort(/* { filters: [...] } opcional */);
    await p.open({ baudRate: 9600 });

    // (Opcional pero recomendable) fija DTR/RTS para evitar auto-reset en algunas placas
    try { await p.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch {}

    const textDecoder = new TextDecoderStream();
    const readableClosed = p.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();
    readerRef.current = reader;

    const textEncoder = new TextEncoderStream();
    const writableClosed = textEncoder.readable.pipeTo(p.writable);
    const writer = textEncoder.writable.getWriter();
    writerRef.current = writer;

    setPort(p);
    setConnected(true);

    (async () => {
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let idx;
          while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (line) handleLine(line);
          }
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }
    })();

    // Guarda para cerrar bien luego
    p._readableClosed = readableClosed;
    p._writableClosed = writableClosed;

  } catch (err) {
    console.error(err);
    alert("No se pudo abrir el puerto.");
  }
};

// 3) Desconectar manual
const disconnect = async () => {
  try {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current.releaseLock();
    }
    if (writerRef.current) {
      writerRef.current.releaseLock();
    }
    if (port?._readableClosed) { try { await port._readableClosed; } catch {} }
    if (port?._writableClosed) { try { await port._writableClosed; } catch {} }
    if (port) await port.close();
  } catch (e) {
    console.warn(e);
  } finally {
    setConnected(false);
    setPort(null);
  }
};

  // Parseo de líneas emitidas por el sketch
  const handleLine = (line) => {
    // Ejemplos de otras líneas informativas:
    // OK,START  | ALARM,HIGH_LEVEL | LOG,OK | ERROR,SD_NOT_AVAILABLE | SD,OK,LOG_0.csv
    if (!line) return;
    if (line.startsWith("DATA,")) {
      const parts = line.split(",");
      if (parts.length >= 9) {
        const t = Number(parts[1]);
        const nivel = Number(parts[2]);
        const flow = Number(parts[3]);
        const kpa = Number(parts[4]);
        const pwm = Number(parts[5]);
        const alarm = parts[6] === "1";
        const running = parts[7] === "1";
        const manual = parts[8] === "1";

        pendingRef.current.push({ t, nivel, flow, kpa, pwm, alarm, running, manual });
      }
    } else {
      // Mensajes no-telemetría: los apilamos en consola simple
      setConsoleLines((prev) => {
        const next = [...prev, `${new Date().toLocaleTimeString()}  ${line}`];
        while (next.length > 300) next.shift();
        return next;
      });
    }
  };

  // Consola simple (logs Arduino)
  const [consoleLines, setConsoleLines] = useState([]);
  const consoleRef = useRef(null);
  useEffect(() => {
    if (autoscroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLines, autoscroll]);

  // Envío de comandos
  const send = async (text) => {
    if (!writerRef.current) return;
    await writerRef.current.write(text + "\n");
  };

  const sendSP = () => send(`SP,${sp}`);
  const sendKP = () => send(`KP,${kp}`);
  const sendKI = () => send(`KI,${ki}`);
  const sendKD = () => send(`KD,${kd}`);

  // Exportar CSV de la serie acumulada
  const downloadCSV = () => {
    const header = "time_ms,level_pct,flow_lpm,pressure_kpa,pwm,alarm,running,manual\n";
    const body = rows
      .map((r) => `${r.t},${r.nivel.toFixed(1)},${r.flow.toFixed(2)},${r.kpa.toFixed(1)},${r.pwm},${r.alarm?1:0},${r.running?1:0},${r.manual?1:0}`)
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `telemetria_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Derivados para gráficos (convertimos ms-> etiqueta mm:ss)
  const chartData = useMemo(
    () => rows.map((r) => ({
      time: fmtTime(r.t),
      nivel: r.nivel,
      flow: r.flow,
      kpa: r.kpa,
      pwm: r.pwm,
    })),
    [rows]
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#e6ebf2]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">
        <header className="flex items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl md:text-3xl font-semibold">PID Tanque Piloto · Panel</h1>
          <div className="flex items-center gap-2">
            {!connected ? (
              <Button onClick={connect} className="rounded-2xl">Conectar</Button>
            ) : (
              <Button onClick={disconnect} variant="destructive" className="rounded-2xl">Desconectar</Button>
            )}
          </div>
        </header>

        {/* Estado en vivo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">Nivel</div>
              <div className="text-3xl font-bold">{lastRow ? `${lastRow.nivel.toFixed(1)}%` : "–"}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">Flujo</div>
              <div className="text-3xl font-bold">{lastRow ? `${lastRow.flow.toFixed(2)} L/min` : "–"}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">Presión</div>
              <div className="text-3xl font-bold">{lastRow ? `${lastRow.kpa.toFixed(1)} kPa` : "–"}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">PWM</div>
              <div className="text-3xl font-bold">{lastRow ? lastRow.pwm : "–"}</div>
            </CardContent>
          </Card>
        </div>

        {/* Indicadores */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
          <Card className={`border-none shadow ${lastRow?.running ? "bg-emerald-900/40" : "bg-[#11162a]"}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm opacity-70">Estado</div>
                <div className="text-xl font-semibold">{lastRow?.running ? "RUNNING" : "STOPPED"}</div>
              </div>
              <div className="text-3xl">{lastRow?.running ? "▶️" : "⏹️"}</div>
            </CardContent>
          </Card>
          <Card className={`border-none shadow ${lastRow?.manual ? "bg-amber-900/40" : "bg-[#11162a]"}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm opacity-70">Modo</div>
                <div className="text-xl font-semibold">{lastRow?.manual ? "MANUAL (EXTRA)" : "PID (AUTO)"}</div>
              </div>
              <div className="text-3xl">{lastRow?.manual ? "🛠️" : "🤖"}</div>
            </CardContent>
          </Card>
          <Card className={`border-none shadow ${lastRow?.alarm ? "bg-rose-900/40" : "bg-[#11162a]"}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <div className="text-sm opacity-70">Alarma</div>
                <div className="text-xl font-semibold">{lastRow?.alarm ? "ACTIVA" : "OK"}</div>
              </div>
              <div className="text-3xl">{lastRow?.alarm ? "🚨" : "✅"}</div>
            </CardContent>
          </Card>
        </div>

        {/* Controles */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">Proceso</div>
              <div className="flex gap-2 flex-wrap">
                <Button
                    onClick={() => send("START")}
                    disabled={!connected}
                    className="transition-all duration-200 hover:bg-emerald-600/80"
                >
                    START
                </Button>
                <Button
                    onClick={() => send("STOP")}
                    variant="secondary"
                    disabled={!connected}
                    className="transition-all duration-200 hover:bg-red-600/70"
                >
                    STOP
                </Button>
                <Button
                    onClick={() => send("START-EXTRA")}
                    disabled={!connected}
                    className="transition-all duration-200 hover:bg-emerald-500/70"
                >
                    START-EXTRA
                </Button>
                <Button
                    onClick={() => send("STOP-EXTRA")}
                    variant="secondary"
                    disabled={!connected}
                    className="transition-all duration-200 hover:bg-amber-600/70"
                >
                    STOP-EXTRA
                </Button>
            </div>
              <div className="h-px bg-white/10 my-2" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Setpoint nivel (%)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input type="number" value={sp} onChange={(e)=>setSp(e.target.value)} className="bg-black/30" />
                    <Button onClick={sendSP} disabled={!connected}>Enviar SP</Button>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button onClick={() => setRows([])} variant="outline">Limpiar memoria</Button>
                  <Button onClick={downloadCSV} variant="outline">Exportar CSV</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">PID (auto)</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Kp</Label>
                  <Input type="number" step="0.01" value={kp} onChange={(e)=>setKp(e.target.value)} className="bg-black/30" />
                  <Button className="mt-2 w-full" onClick={sendKP} disabled={!connected}>Enviar</Button>
                </div>
                <div>
                  <Label>Ki</Label>
                  <Input type="number" step="0.01" value={ki} onChange={(e)=>setKi(e.target.value)} className="bg-black/30" />
                  <Button className="mt-2 w-full" onClick={sendKI} disabled={!connected}>Enviar</Button>
                </div>
                <div>
                  <Label>Kd</Label>
                  <Input type="number" step="0.01" value={kd} onChange={(e)=>setKd(e.target.value)} className="bg-black/30" />
                  <Button className="mt-2 w-full" onClick={sendKD} disabled={!connected}>Enviar</Button>
                </div>
              </div>
              <div className="text-xs opacity-70">* Los tunings aplican cuando el modo no es manual.</div>
            </CardContent>
          </Card>

          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">SD / Utilidades</div>
              <div className="flex gap-2 flex-wrap">
                <Button onClick={() => send("SD-STATUS")} disabled={!connected}>SD‑STATUS</Button>
                <Button onClick={() => send("SD-NEWFILE")} disabled={!connected}>SD‑NEWFILE</Button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-sm opacity-75">Autoscroll consola</div>
                <Switch checked={autoscroll} onCheckedChange={setAutoscroll} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gráficos */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="font-semibold mb-2">Nivel (%)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 100]} tickCount={6} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="nivel" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="font-semibold mb-2">Flujo (L/min) y Presión (kPa)</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" hide />
                    <YAxis yAxisId="left" orientation="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="flow" name="Flujo" dot={false} strokeWidth={2} />
                    <Line yAxisId="right" type="monotone" dataKey="kpa" name="kPa" dot={false} strokeDasharray="4 4" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-12">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="font-semibold mb-2">PWM</div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 255]} tickCount={6} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="pwm" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Consola de mensajes */}
        <Card className="bg-[#11162a] border-none shadow mb-8">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Consola</div>
              <Button variant="outline" onClick={() => setConsoleLines([])}>Limpiar</Button>
            </div>
            <div ref={consoleRef} className="h-48 overflow-auto bg-black/30 rounded-xl p-2 text-sm leading-6">
              {consoleLines.map((l, i) => (
                <div key={i} className="whitespace-pre">{l}</div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Ayuda rápida */}
        <Card className="bg-[#11162a] border-none shadow">
          <CardContent className="p-4 text-sm opacity-80 space-y-1">
            <div>• Abrí en <b>Chrome/Edge</b>. Esta página debe estar en <b>https://</b> o en <b>http://localhost</b> por seguridad del Web Serial API.</div>
            <div>• Baud: <b>9600</b>. El sketch ya usa ese valor (Serial.begin(9600)).</div>
            <div>• Formato de datos esperado: <code>DATA,ms,level%,flow,kPa,PWM,alarm,running,manual</code></div>
            <div>• Comandos disponibles: <code>START</code>, <code>STOP</code>, <code>START-EXTRA</code>, <code>STOP-EXTRA</code>, <code>RESET</code>, <code>SD-STATUS</code>, <code>SD-NEWFILE</code>, <code>SP,x</code>, <code>KP,x</code>, <code>KI,x</code>, <code>KD,x</code>.</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
