"use client";

import { useEffect, useRef, useCallback } from "react";

interface Props {
  analyserNode: AnalyserNode | null;
  isRecording: boolean;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Renders a 32-bar audio waveform from a Web Audio AnalyserNode.
 * Cyan bars (#06b6d4) on transparent background.
 *
 * Used by /grabar and /analisis/nueva — both pass rec.analyserNode and
 * rec.recMode === "recording".
 */
export default function WaveformCanvas({
  analyserNode,
  isRecording,
  width = 280,
  height = 60,
  className = "ear-waveform",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyserNode) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);
      analyserNode.getByteFrequencyData(dataArray);
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const barCount = 32;
      const barWidth = Math.floor(w / barCount) - 2;
      const step = Math.floor(bufferLength / barCount);
      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const barHeight = Math.max(2, value * h * 0.85);
        const x = i * (barWidth + 2);
        const y = (h - barHeight) / 2;
        ctx.fillStyle = value > 0.4 ? "#06b6d4" : "rgba(6,182,212,0.3)";
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, 2);
        ctx.fill();
      }
    };
    draw();
  }, [analyserNode, isRecording]);

  useEffect(() => {
    if (isRecording && analyserNode && canvasRef.current) {
      drawWaveform();
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [analyserNode, isRecording, drawWaveform]);

  return <canvas ref={canvasRef} className={className} width={width} height={height} />;
}
