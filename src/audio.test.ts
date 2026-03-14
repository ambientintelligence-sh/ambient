import { describe, it, expect } from "vitest";
import {
  parseAvfoundationOutput,
  selectAudioDevice,
} from "./audio";
import type { Device } from "./types";

describe("parseAvfoundationOutput", () => {
  it("parses audio devices from ffmpeg output", () => {
    const output = `
[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera
[AVFoundation indev @ 0x7f8] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8] [0] MacBook Pro Microphone
[AVFoundation indev @ 0x7f8] [1] BlackHole 2ch
[AVFoundation indev @ 0x7f8] [2] External Microphone
`;
    const devices = parseAvfoundationOutput(output);
    expect(devices).toHaveLength(3);
    expect(devices[0]).toEqual({ index: 0, name: "MacBook Pro Microphone" });
    expect(devices[1]).toEqual({ index: 1, name: "BlackHole 2ch" });
    expect(devices[2]).toEqual({ index: 2, name: "External Microphone" });
  });

  it("returns empty array when no audio devices found", () => {
    const output = `
[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera
`;
    const devices = parseAvfoundationOutput(output);
    expect(devices).toHaveLength(0);
  });

  it("handles empty output", () => {
    const devices = parseAvfoundationOutput("");
    expect(devices).toHaveLength(0);
  });

  it("stops parsing audio devices when video section starts after", () => {
    const output = `
[AVFoundation indev @ 0x7f8] AVFoundation audio devices:
[AVFoundation indev @ 0x7f8] [0] Microphone
[AVFoundation indev @ 0x7f8] AVFoundation video devices:
[AVFoundation indev @ 0x7f8] [0] Camera
`;
    const devices = parseAvfoundationOutput(output);
    expect(devices).toHaveLength(1);
    expect(devices[0].name).toBe("Microphone");
  });
});

describe("selectAudioDevice", () => {
  const devices: Device[] = [
    { index: 0, name: "MacBook Pro Microphone" },
    { index: 1, name: "BlackHole 2ch" },
    { index: 2, name: "External Microphone" },
    { index: 3, name: "Loopback Audio" },
  ];

  it("selects device by index string", () => {
    const result = selectAudioDevice(devices, "1");
    expect(result).toEqual({ index: 1, name: "BlackHole 2ch" });
  });

  it("selects device by name substring (case-insensitive)", () => {
    const result = selectAudioDevice(devices, "blackhole");
    expect(result).toEqual({ index: 1, name: "BlackHole 2ch" });
  });

  it("returns null for non-existent index", () => {
    const result = selectAudioDevice(devices, "99");
    expect(result).toBeNull();
  });

  it("returns null for non-matching name", () => {
    const result = selectAudioDevice(devices, "nonexistent");
    expect(result).toBeNull();
  });

  it("auto-detects BlackHole when no override", () => {
    const result = selectAudioDevice(devices);
    expect(result).toEqual({ index: 1, name: "BlackHole 2ch" });
  });

  it("auto-detects Loopback when no BlackHole", () => {
    const devicesWithoutBlackhole: Device[] = [
      { index: 0, name: "MacBook Pro Microphone" },
      { index: 1, name: "Loopback Audio" },
    ];
    const result = selectAudioDevice(devicesWithoutBlackhole);
    expect(result).toEqual({ index: 1, name: "Loopback Audio" });
  });

  it("returns null when no loopback device found", () => {
    const basicDevices: Device[] = [
      { index: 0, name: "MacBook Pro Microphone" },
      { index: 1, name: "External Microphone" },
    ];
    const result = selectAudioDevice(basicDevices);
    expect(result).toBeNull();
  });

  it("detects soundflower", () => {
    const devicesWithSoundflower: Device[] = [
      { index: 0, name: "Soundflower (2ch)" },
    ];
    const result = selectAudioDevice(devicesWithSoundflower);
    expect(result).toEqual({ index: 0, name: "Soundflower (2ch)" });
  });

  it("detects VB-Cable", () => {
    const devicesWithVBCable: Device[] = [{ index: 0, name: "VB-Cable Input" }];
    const result = selectAudioDevice(devicesWithVBCable);
    expect(result).toEqual({ index: 0, name: "VB-Cable Input" });
  });

  it("detects iShowU", () => {
    const devicesWithIShowU: Device[] = [{ index: 0, name: "iShowU Audio" }];
    const result = selectAudioDevice(devicesWithIShowU);
    expect(result).toEqual({ index: 0, name: "iShowU Audio" });
  });
});

