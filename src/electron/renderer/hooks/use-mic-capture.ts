import { useRef } from "react";

/**
 * Captures mic audio via Web Audio API and streams PCM to main process via IPC.
 * This bypasses the macOS TCC permission issue where ffmpeg subprocess gets silenced.
 * Output: 16kHz mono signed 16-bit little-endian PCM (matches the existing VAD pipeline).
 */
export function useMicCapture() {
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });

    // Request 16kHz — Chromium will resample internally from the device's native rate
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);

    // ScriptProcessorNode is deprecated but reliable in Electron and avoids needing a separate worklet file
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      window.electronAPI.sendMicAudio(int16.buffer);
    };

    source.connect(processor);
    // ScriptProcessorNode requires connection to destination to fire onaudioprocess
    processor.connect(ctx.destination);

    streamRef.current = stream;
    contextRef.current = ctx;
  };

  const stop = () => {
    contextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    contextRef.current = null;
    streamRef.current = null;
  };

  return { start, stop };
}
