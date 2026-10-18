// Operational enrichment failures belong in diagnostics, not token-risk messages.
export function isEnrichmentDiagnostic(warning: string): boolean {
  return /^(?:MadeOnSol(?: RH)?|FOMO):\s*(?:enrichment\b|HTTP\b|cooldown\b|timeout\b|koneksi\/query\b|query gagal\b|respons\b|format respons\b|timestamp leaderboard\b|daftar holder\b|hanya snapshot\b|provider belum mempunyai\b|alamat deployer\b|total_tokens_deployed\b|total bonded\b|identitas deployer\b|histori token parsial\b|jumlah token\/graduated\b)/i.test(warning.trim());
}
