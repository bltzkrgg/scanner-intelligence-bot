import type { IntelligenceResult, TokenSnapshot } from "@sti/shared";

export function classifyScore(score: number): IntelligenceResult["classification"] {
  if (score >= 82) return "SANGAT MENARIK";
  if (score >= 66) return "CUKUP MENARIK";
  if (score >= 48) return "NETRAL";
  if (score >= 32) return "KURANG MENARIK";
  return "RISIKO TINGGI";
}

export function buildWarnings(snapshot: TokenSnapshot): string[] {
  const warnings: string[] = [];
  if (snapshot.top10HolderPct > 35) warnings.push("Konsentrasi top holder tinggi.");
  if (snapshot.bundlerPct > 15) warnings.push("Bundler exposure di atas ambang MVP.");
  if (snapshot.insiderPct > 12) warnings.push("Insider exposure perlu diperiksa manual.");
  if (snapshot.sniperPct > 15) warnings.push("Sniper exposure tinggi untuk token seumur ini.");
  if (snapshot.liquidityUsd < 25_000) warnings.push("Likuiditas rendah, hasil bisa sangat volatil.");
  if (snapshot.liquidityLockedPct < 50) warnings.push("Kualitas/lock likuiditas rendah atau belum terverifikasi.");
  return warnings;
}
