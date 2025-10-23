import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Simulador de Arduino para probar el Dashboard sin hardware
 * Genera datos sintéticos que simulan el comportamiento del sistema PID
 */
export default function SimuladorArduino({ onData }) {
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);
  const timeRef = useRef(0);
  const nivelRef = useRef(50);
  const flowRef = useRef(0);
  const pwmRef = useRef(0);

  const simular = () => {
    timeRef.current += 200; // 200ms por ciclo
    
    // Simular nivel que varía suavemente
    if (running) {
      // El nivel sube lentamente con el flujo
      nivelRef.current += (flowRef.current * 0.01) - 0.05; // se vacía lentamente
      nivelRef.current = Math.max(0, Math.min(100, nivelRef.current));
      
      // PWM intenta mantener nivel en 75%
      const error = 75 - nivelRef.current;
      pwmRef.current = Math.max(0, Math.min(255, 128 + error * 5));
      
      // Flujo depende del PWM
      flowRef.current = (pwmRef.current / 255) * 3.5 + (Math.random() - 0.5) * 0.2;
    } else {
      pwmRef.current = 0;
      flowRef.current = 0;
      nivelRef.current -= 0.1; // se vacía lentamente
      nivelRef.current = Math.max(0, nivelRef.current);
    }

    const kpa = flowRef.current * 6.5 + (Math.random() - 0.5) * 0.5; // presión proporcional al flujo
    const alarm = nivelRef.current > 90 ? 1 : 0;

    // Generar línea DATA igual que Arduino
    const line = `DATA,${timeRef.current},${nivelRef.current.toFixed(1)},${flowRef.current.toFixed(2)},${kpa.toFixed(1)},${Math.round(pwmRef.current)},${alarm},${running ? 1 : 0},0`;
    
    if (onData) {
      onData(line);
    }
  };

  const iniciar = () => {
    setRunning(true);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(simular, 200);
  };

  const detener = () => {
    setRunning(false);
  };

  const resetear = () => {
    timeRef.current = 0;
    nivelRef.current = 50;
    flowRef.current = 0;
    pwmRef.current = 0;
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  const agregarAgua = () => {
    nivelRef.current = Math.min(100, nivelRef.current + 10);
  };

  const quitarAgua = () => {
    nivelRef.current = Math.max(0, nivelRef.current - 10);
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <Card className="bg-blue-950/20 border border-blue-700/30 shadow mb-4">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-blue-400">🧪 Simulador de Arduino (Pruebas)</div>
          <div className="text-xs opacity-70">
            Estado: {running ? "▶️ Simulando" : "⏹️ Detenido"}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={iniciar} size="sm" className="bg-emerald-600 hover:bg-emerald-700">
            ▶️ Iniciar Simulación
          </Button>
          <Button onClick={detener} size="sm" variant="secondary">
            ⏹️ Detener
          </Button>
          <Button onClick={resetear} size="sm" variant="outline">
            🔄 Resetear
          </Button>
          <Button onClick={agregarAgua} size="sm" className="bg-blue-600 hover:bg-blue-700">
            💧 +Agua
          </Button>
          <Button onClick={quitarAgua} size="sm" className="bg-orange-600 hover:bg-orange-700">
            💧 -Agua
          </Button>
        </div>
        <div className="text-xs mt-2 opacity-70">
          💡 Usa este simulador para probar las gráficas sin conectar el Arduino real
        </div>
      </CardContent>
    </Card>
  );
}
