import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
import SimuladorArduino from "./SimuladorArduino";

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
  const [modoSimulacion, setModoSimulacion] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);

  // Buffers de datos (hasta ~10 minutos a 5 Hz => 3000 puntos aprox.)
  const [rows, setRows] = useState([]); // objetos con {t, nivel, flow, kpa, pwm, alarm, running, manual}
  const maxPoints = 3600; // limita memoria

  // Consola simple (logs Arduino)
  const [consoleLines, setConsoleLines] = useState([]);
  const consoleRef = useRef(null);

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

// Parseo de líneas emitidas por el sketch
const handleLine = (line) => {
  // Ejemplos de otras líneas informativas:
  // OK,START  | ALARM,HIGH_LEVEL | LOG,OK | ERROR,SD_NOT_AVAILABLE | SD,OK,LOG_0.csv
  if (!line) return;
  
  if (line.startsWith("DATA,")) {
    const parts = line.split(",");
    if (parts.length >= 9) {
      const t = Number(parts[1]) || 0;
      const nivel = parseFloat(parts[2]) || 0;
      const flow = parseFloat(parts[3]) || 0;
      const kpa = parseFloat(parts[4]) || 0;
      const pwm = parseInt(parts[5]) || 0;
      const alarm = parts[6] === "1";
      const running = parts[7] === "1";
      const manual = parts[8] === "1";

      // Log para debug (solo cada 50 muestras para no saturar)
      if (pendingRef.current.length % 50 === 0) {
        console.log("Datos recibidos:", { t, nivel, flow, kpa, pwm, alarm, running, manual });
      }

      pendingRef.current.push({ t, nivel, flow, kpa, pwm, alarm, running, manual });
    } else {
      console.warn("Línea DATA incompleta:", line, "partes:", parts.length);
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

// Función de limpieza unificada
const cleanupConnection = async () => {
  try {
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
      } catch {}
      try {
        readerRef.current.releaseLock();
      } catch {}
      readerRef.current = null;
    }
    if (writerRef.current) {
      try {
        writerRef.current.releaseLock();
      } catch {}
      writerRef.current = null;
    }
    if (port) {
      try {
        await port.close();
      } catch {}
    }
  } catch (err) {
    console.error("Error en limpieza:", err);
  } finally {
    setConnected(false);
    setPort(null);
  }
};

// Conectar: espera y configura señales
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

    // Listener para detectar desconexión física
    navigator.serial.addEventListener("disconnect", async (event) => {
      if (event.target === p) {
        console.log("Puerto desconectado físicamente");
        await cleanupConnection();
      }
    });

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
      } catch (readErr) {
        console.error("Error en lectura:", readErr);
        await cleanupConnection();
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

// Desconectar manual
const disconnect = async () => {
  await cleanupConnection();
};

  // Auto-scroll de consola
  useEffect(() => {
    if (autoscroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLines, autoscroll]);

  // Envío de comandos con manejo de errores
  const send = async (text) => {
    if (!writerRef.current) {
      console.warn("No hay writer disponible");
      return;
    }
    try {
      await writerRef.current.write(text + "\n");
      console.log(`Comando enviado: ${text}`);
    } catch (err) {
      console.error("Error al enviar comando:", err);
      setConsoleLines((prev) => {
        const next = [...prev, `${new Date().toLocaleTimeString()}  ERROR: No se pudo enviar comando ${text}`];
        while (next.length > 300) next.shift();
        return next;
      });
      // Si hay error al escribir, probablemente la conexión se perdió
      await cleanupConnection();
    }
  };

  const sendSP = () => {
    send(`SP,${sp}`);
    setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  🎯 Setpoint actualizado: ${sp}%`]);
  };
  
  const sendKP = () => {
    send(`KP,${kp}`);
    setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  ⚙️ Kp actualizado: ${kp}`]);
  };
  
  const sendKI = () => {
    send(`KI,${ki}`);
    setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  ⚙️ Ki actualizado: ${ki}`]);
  };
  
  const sendKD = () => {
    send(`KD,${kd}`);
    setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  ⚙️ Kd actualizado: ${kd}`]);
  };

  // Exportar CSV de la serie acumulada
  const downloadCSV = () => {
    if (rows.length === 0) {
      alert("No hay datos para exportar. Conecta el dispositivo y espera a recibir datos.");
      return;
    }
    
    try {
      const header = "time_ms,level_pct,flow_lpm,pressure_kpa,pwm,alarm,running,manual\n";
      const body = rows
        .map((r) => `${r.t},${r.nivel.toFixed(1)},${r.flow.toFixed(2)},${r.kpa.toFixed(1)},${r.pwm},${r.alarm?1:0},${r.running?1:0},${r.manual?1:0}`)
        .join("\n");
      const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      a.download = `telemetria_${timestamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Mostrar mensaje en consola
      setConsoleLines((prev) => {
        const next = [...prev, `${new Date().toLocaleTimeString()}  ✓ Exportado: ${rows.length} registros a CSV`];
        while (next.length > 300) next.shift();
        return next;
      });
    } catch (err) {
      console.error("Error al exportar CSV:", err);
      alert("Error al exportar CSV. Ver consola para detalles.");
    }
  };

  // Derivados para gráficos (convertimos ms-> etiqueta mm:ss)
  // Limitar puntos para mejor rendimiento en gráficos (últimos 500 puntos)
  const chartData = useMemo(
    () => {
      const recentRows = rows.slice(-500);
      return recentRows.map((r) => ({
        time: fmtTime(r.t),
        nivel: parseFloat(r.nivel.toFixed(2)),
        flow: parseFloat(r.flow.toFixed(2)),
        kpa: parseFloat(r.kpa.toFixed(2)),
        pwm: r.pwm,
      }));
    },
    [rows]
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-[#e6ebf2]">
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">
        <header className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">PID Tanque Piloto · Panel</h1>
            {connected && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-emerald-400">
                  Conectado - Recibiendo datos en tiempo real ({rows.length} registros)
                </span>
              </div>
            )}
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

        {/* Simulador para pruebas */}
        {modoSimulacion && (
          <SimuladorArduino onData={(line) => handleLine(line)} />
        )}
        
        {/* Toggle para activar simulador */}
        <Card className="bg-[#11162a] border-none shadow mb-4">
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">Modo Simulación (Pruebas sin Arduino)</div>
                <div className="text-xs opacity-70 mt-1">
                  Activa esto para probar las gráficas con datos sintéticos sin conectar el Arduino
                </div>
              </div>
              <Switch 
                checked={modoSimulacion} 
                onCheckedChange={setModoSimulacion}
              />
            </div>
          </CardContent>
        </Card>

        {/* Estado en vivo */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">Nivel</div>
              <div className="text-3xl font-bold">{lastRow ? `${lastRow.nivel.toFixed(1)}%` : "–"}</div>
              <div className="text-xs opacity-50 mt-1">Raw: {lastRow ? lastRow.nivel : "N/A"}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">Flujo</div>
              <div className="text-3xl font-bold">{lastRow ? `${lastRow.flow.toFixed(2)} L/min` : "–"}</div>
              <div className="text-xs opacity-50 mt-1">Raw: {lastRow ? lastRow.flow : "N/A"}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">Presión</div>
              <div className="text-3xl font-bold">{lastRow ? `${lastRow.kpa.toFixed(1)} kPa` : "–"}</div>
              <div className="text-xs opacity-50 mt-1">Raw: {lastRow ? lastRow.kpa : "N/A"}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="text-sm opacity-70">PWM</div>
              <div className="text-3xl font-bold">{lastRow ? lastRow.pwm : "–"}</div>
              <div className="text-xs opacity-50 mt-1">Raw: {lastRow ? lastRow.pwm : "N/A"}</div>
            </CardContent>
          </Card>
        </div>

        {/* Panel de Debug - solo visible si hay datos */}
        {connected && lastRow && (
          <Card className="bg-amber-950/20 border border-amber-700/30 shadow mb-4">
            <CardContent className="p-3">
              <div className="text-xs font-mono">
                <div className="font-semibold text-amber-400 mb-1">🔍 Debug - Último dato recibido:</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>⏱️ Tiempo: {lastRow.t}ms ({fmtTime(lastRow.t)})</div>
                  <div>📊 Nivel: {lastRow.nivel}%</div>
                  <div>💧 Flujo: {lastRow.flow} L/min</div>
                  <div>📈 Presión: {lastRow.kpa} kPa</div>
                  <div>⚡ PWM: {lastRow.pwm}</div>
                  <div>🚨 Alarma: {lastRow.alarm ? "SÍ" : "NO"}</div>
                  <div>▶️ Running: {lastRow.running ? "SÍ" : "NO"}</div>
                  <div>🛠️ Manual: {lastRow.manual ? "SÍ" : "NO"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

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
                    onClick={() => {
                      send("START");
                      setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  ▶️ Comando: START enviado`]);
                    }}
                    disabled={!connected}
                    className="transition-all duration-200 bg-emerald-600 hover:bg-emerald-700 hover:scale-105"
                >
                    ▶️ START
                </Button>
                <Button
                    onClick={() => {
                      send("STOP");
                      setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  ⏹️ Comando: STOP enviado`]);
                    }}
                    variant="secondary"
                    disabled={!connected}
                    className="transition-all duration-200 hover:bg-red-600/80 hover:scale-105"
                >
                    ⏹️ STOP
                </Button>
                <Button
                    onClick={() => {
                      send("START-EXTRA");
                      setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  🛠️ Comando: START-EXTRA enviado (Modo Manual)`]);
                    }}
                    disabled={!connected}
                    className="transition-all duration-200 bg-amber-600 hover:bg-amber-700 hover:scale-105"
                >
                    🛠️ START-EXTRA
                </Button>
                <Button
                    onClick={() => {
                      send("STOP-EXTRA");
                      setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  🔧 Comando: STOP-EXTRA enviado`]);
                    }}
                    variant="secondary"
                    disabled={!connected}
                    className="transition-all duration-200 hover:bg-orange-600/80 hover:scale-105"
                >
                    🔧 STOP-EXTRA
                </Button>
            </div>
              <div className="h-px bg-white/10 my-2" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Setpoint nivel (%)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input 
                      type="number" 
                      min="0" 
                      max="100" 
                      value={sp} 
                      onChange={(e)=>setSp(e.target.value)} 
                      className="bg-black/30" 
                    />
                    <Button onClick={sendSP} disabled={!connected} className="hover:scale-105 transition-all">
                      🎯 Enviar SP
                    </Button>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Button 
                    onClick={() => {
                      if (rows.length === 0 || window.confirm(`¿Deseas limpiar ${rows.length} registros de memoria?`)) {
                        rowsRef.current = [];
                        setRows([]);
                        setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  🗑️ Memoria limpiada`]);
                      }
                    }} 
                    variant="outline"
                    className="hover:bg-red-500/20 hover:scale-105 transition-all"
                  >
                    🗑️ Limpiar memoria
                  </Button>
                  <Button 
                    onClick={downloadCSV} 
                    variant="outline"
                    className="hover:bg-emerald-500/20 hover:scale-105 transition-all"
                    disabled={rows.length === 0}
                  >
                    📥 Exportar CSV
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">⚙️ PID (auto)</div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Kp (Proporcional)</Label>
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={kp} 
                    onChange={(e)=>setKp(e.target.value)} 
                    className="bg-black/30" 
                  />
                  <Button 
                    className="mt-2 w-full hover:scale-105 transition-all" 
                    onClick={sendKP} 
                    disabled={!connected}
                  >
                    ✓ Enviar
                  </Button>
                </div>
                <div>
                  <Label>Ki (Integral)</Label>
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={ki} 
                    onChange={(e)=>setKi(e.target.value)} 
                    className="bg-black/30" 
                  />
                  <Button 
                    className="mt-2 w-full hover:scale-105 transition-all" 
                    onClick={sendKI} 
                    disabled={!connected}
                  >
                    ✓ Enviar
                  </Button>
                </div>
                <div>
                  <Label>Kd (Derivativo)</Label>
                  <Input 
                    type="number" 
                    step="0.01" 
                    value={kd} 
                    onChange={(e)=>setKd(e.target.value)} 
                    className="bg-black/30" 
                  />
                  <Button 
                    className="mt-2 w-full hover:scale-105 transition-all" 
                    onClick={sendKD} 
                    disabled={!connected}
                  >
                    ✓ Enviar
                  </Button>
                </div>
              </div>
              <div className="text-xs opacity-70">💡 Los tunings aplican cuando el modo no es manual.</div>
            </CardContent>
          </Card>

          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold mb-1">💾 SD / Utilidades</div>
              <div className="flex gap-2 flex-wrap">
                <Button 
                  onClick={() => {
                    send("SD-STATUS");
                    setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  📋 Consultando estado de SD...`]);
                  }} 
                  disabled={!connected}
                  className="hover:scale-105 transition-all"
                >
                  📋 SD‑STATUS
                </Button>
                <Button 
                  onClick={() => {
                    send("SD-NEWFILE");
                    setConsoleLines((prev) => [...prev, `${new Date().toLocaleTimeString()}  📝 Creando nuevo archivo en SD...`]);
                  }} 
                  disabled={!connected}
                  className="hover:scale-105 transition-all"
                >
                  📝 SD‑NEWFILE
                </Button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="text-sm opacity-75">🔄 Autoscroll consola</div>
                <Switch checked={autoscroll} onCheckedChange={setAutoscroll} />
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
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value) => `${value.toFixed(2)}%`}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="nivel" 
                      name="Nivel (%)"
                      stroke="#10b981" 
                      strokeWidth={2} 
                      dot={false}
                      isAnimationActive={false}
                    />
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
                    <YAxis 
                      yAxisId="left" 
                      orientation="left" 
                      stroke="#3b82f6" 
                      tick={{ fill: '#3b82f6' }}
                      domain={['auto', 'auto']}
                      label={{ value: 'L/min', angle: -90, position: 'insideLeft', fill: '#3b82f6' }}
                    />
                    <YAxis 
                      yAxisId="right" 
                      orientation="right" 
                      stroke="#f59e0b" 
                      tick={{ fill: '#f59e0b' }}
                      domain={['auto', 'auto']}
                      label={{ value: 'kPa', angle: 90, position: 'insideRight', fill: '#f59e0b' }}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value, name) => {
                        if (name === "Flujo (L/min)") return `${value.toFixed(2)} L/min`;
                        if (name === "Presión (kPa)") return `${value.toFixed(2)} kPa`;
                        return value;
                      }}
                    />
                    <Legend />
                    <Line 
                      yAxisId="left" 
                      type="monotone" 
                      dataKey="flow" 
                      name="Flujo (L/min)" 
                      stroke="#3b82f6" 
                      strokeWidth={2} 
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line 
                      yAxisId="right" 
                      type="monotone" 
                      dataKey="kpa" 
                      name="Presión (kPa)" 
                      stroke="#f59e0b" 
                      strokeDasharray="4 4" 
                      strokeWidth={2} 
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 mb-12">
          <Card className="bg-[#11162a] border-none shadow">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">PWM (0-255)</div>
                <div className="text-sm opacity-70">
                  {chartData.length} puntos | {lastRow ? lastRow.pwm : '---'}
                </div>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                    <XAxis dataKey="time" stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <YAxis domain={[0, 255]} tickCount={6} stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }}
                      labelStyle={{ color: '#e5e7eb' }}
                      formatter={(value) => `${value}`}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="pwm" 
                      name="PWM"
                      stroke="#8b5cf6" 
                      strokeWidth={2} 
                      dot={false}
                      isAnimationActive={false}
                    />
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
