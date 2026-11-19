export function chromeMajor(chromeVersion: string): string {
  return chromeVersion.split('.')[0] ?? chromeVersion;
}

export function userAgent(major: string): string {
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

export function secChUa(major: string): string {
  return `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not_A Brand";v="24"`;
}

export function rewriteClientHints(headers: Record<string, string>, major: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = name.toLowerCase() === 'sec-ch-ua' ? secChUa(major) : value;
  }
  return out;
}
