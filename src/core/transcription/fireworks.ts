const FIREWORKS_TRANSCRIPTION_URL =
  "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions";

export async function transcribeWithFireworks(
  wavBuffer: Buffer,
  apiKey: string
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([wavBuffer as BlobPart], { type: "audio/wav" }), "audio.wav");
  form.append("model", "whisper-v3-turbo");
  form.append("temperature", "0");
  form.append("vad_model", "silero");

  const res = await fetch(FIREWORKS_TRANSCRIPTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Fireworks transcription failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as { text: string };
  return json.text;
}
