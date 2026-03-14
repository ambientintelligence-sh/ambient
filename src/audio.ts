import { spawn, type ChildProcess } from "node:child_process";
import { AudioTee } from "audiotee";
import { release } from "node:os";
import type { Device } from "./types";

// ============================================================================
// ScreenCaptureKit-based Audio Capture (macOS 14.2+)
// ============================================================================

const MIN_DARWIN_VERSION = 23; // macOS 14 Sonoma = Darwin 23.x

export function checkMacOSVersion(): { supported: boolean; version: string } {
  const darwinVersion = parseInt(release().split(".")[0]);
  const supported = darwinVersion >= MIN_DARWIN_VERSION;
  // Map Darwin version to macOS version (approximate)
  const macOSVersion =
    darwinVersion >= 25
      ? "15+"
      : darwinVersion >= 24
        ? "15"
        : darwinVersion >= 23
          ? "14"
          : darwinVersion >= 22
            ? "13"
            : "12 or earlier";
  return { supported, version: macOSVersion };
}

export type AudioRecorder = {
  start: () => Promise<void>;
  stop: () => void;
  on: (event: "data" | "error", handler: (data: Buffer | Error) => void) => void;
};

export function createAudioRecorder(sampleRate = 16000): AudioRecorder {
  const audiotee = new AudioTee({
    sampleRate,
    chunkDurationMs: 100, // 100ms chunks for low latency
  });

  return {
    start: () => audiotee.start(),
    stop: () => audiotee.stop(),
    on: (event, handler) => {
      if (event === "data") {
        audiotee.on("data", ({ data }) => handler(data));
      } else if (event === "error") {
        audiotee.on("error", (err) => handler(err));
      }
    },
  };
}

// ============================================================================
// Legacy AVFoundation/ffmpeg Audio Capture (deprecated)
// Optional ffmpeg-based fallback for audio capture.
// ============================================================================

// ============================================================================
// Microphone Capture via ffmpeg (AVFoundation input devices)
// ============================================================================

export async function listMicDevices(): Promise<Device[]> {
  const allDevices = await listAvfoundationDevices();
  // AVFoundation audio input devices are microphones
  // Filter out known loopback/virtual devices
  const virtualPatterns = ["blackhole", "loopback", "soundflower", "vb-cable", "ishowu"];
  return allDevices.filter(
    (d) => !virtualPatterns.some((p) => d.name.toLowerCase().includes(p))
  );
}

export function spawnMicFfmpeg(deviceIdentifier: string | number): ChildProcess {
  const deviceArg = `none:${deviceIdentifier}`;

  const args = [
    "-loglevel", "info",
    "-f", "avfoundation",
    "-thread_queue_size", "1024",
    "-i", deviceArg,
    "-ac", "1",
    "-ar", "16000",
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "-nostdin",
    "-",
  ];
  return spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// ============================================================================
// Legacy AVFoundation/ffmpeg Audio Capture (deprecated)
// Optional ffmpeg-based fallback for audio capture.
// ============================================================================

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export async function listAvfoundationDevices(): Promise<Device[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "ffmpeg",
      ["-f", "avfoundation", "-list_devices", "true", "-i", ""],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let output = "";
    proc.stdout?.on("data", (data) => {
      output += data.toString();
    });
    proc.stderr?.on("data", (data) => {
      output += data.toString();
    });
    proc.on("error", (error) => {
      reject(error);
    });
    proc.on("close", () => {
      resolve(parseAvfoundationOutput(output));
    });
  });
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function parseAvfoundationOutput(output: string): Device[] {
  const lines = output.split("\n");
  const devices: Device[] = [];
  let inAudioSection = false;

  for (const line of lines) {
    if (line.includes("AVFoundation audio devices")) {
      inAudioSection = true;
      continue;
    }
    if (line.includes("AVFoundation video devices")) {
      inAudioSection = false;
      continue;
    }
    if (!inAudioSection) {
      continue;
    }

    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match) {
      devices.push({ index: Number(match[1]), name: match[2].trim() });
    }
  }

  return devices;
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function selectAudioDevice(
  devices: Device[],
  override?: string
): Device | null {
  if (override) {
    if (/^\d+$/.test(override)) {
      const index = Number(override);
      return devices.find((device) => device.index === index) ?? null;
    }

    const lowered = override.toLowerCase();
    return (
      devices.find((device) => device.name.toLowerCase().includes(lowered)) ??
      null
    );
  }

  const matchers = [
    "blackhole",
    "loopback",
    "soundflower",
    "vb-cable",
    "ishowu",
  ];

  return (
    devices.find((device) =>
      matchers.some((matcher) => device.name.toLowerCase().includes(matcher))
    ) ?? null
  );
}

/** @deprecated Use createAudioRecorder() with ScreenCaptureKit instead */
export function spawnFfmpeg(deviceIndex: number): ChildProcess {
  const args = [
    "-f",
    "avfoundation",
    "-i",
    `:${deviceIndex}`,
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "s16le",
    "-loglevel",
    "error",
    "-nostdin",
    "-",
  ];
  return spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}
