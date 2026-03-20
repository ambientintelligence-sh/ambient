export type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
};

export async function checkForUpdate(
  currentVersion: string,
  repo: string,
): Promise<UpdateInfo | null> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    { headers: { Accept: "application/vnd.github.v3+json" } },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as { tag_name: string; html_url: string };
  const latestVersion = data.tag_name.replace(/^v/, "");

  if (!isNewer(latestVersion, currentVersion)) return null;

  return {
    currentVersion,
    latestVersion,
    releaseUrl: data.html_url,
  };
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lv = l[i] ?? 0;
    const cv = c[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
