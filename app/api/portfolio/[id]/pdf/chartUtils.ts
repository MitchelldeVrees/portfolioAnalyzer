export async function chartToDataUri(config: any, width = 1000, height = 520): Promise<string> {
  const url = qcUrl(config, width, height);
  const resp = await fetch(url);
  if (!resp.ok) return "";
  const buf = Buffer.from(await resp.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export function qcUrl(config: any, width = 900, height = 380): string {
  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&format=png&backgroundColor=white&version=4&devicePixelRatio=2`;
}