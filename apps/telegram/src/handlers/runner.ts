import type { Bot } from "grammy";
import { assessRunner, formatRunnerRecord, type IntelligenceScanner, type RunnerMonitor } from "@sti/analysis";
import type { AppConfig } from "@sti/shared";

export function registerRunnerCommands(bot: Bot, monitor: RunnerMonitor, scanner: IntelligenceScanner, config: AppConfig): void {
  bot.command("runners", async (ctx) => {
    const page = ctx.match.trim() ? Number(ctx.match.trim()) : 1;
    if (!Number.isInteger(page) || page < 1) { await ctx.reply("Gunakan /runners atau /runners <nomor_halaman>."); return; }
    const state = monitor.snapshot();
    const records = [...state.records].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
    await ctx.reply([
      `TOKEN RUNNER | ${monitor.active ? "AKTIF" : "NONAKTIF"}`,
      `Siklus selesai terakhir: ${state.lastCycleAt ?? "belum ada"}`,
      state.lastError ?? "",
      `Tersimpan: ${records.length}/50. Data provider, bukan bank wallet sendiri.`,
      `Halaman ${page}/${Math.max(1, Math.ceil(records.length / 4))}; berikutnya: /runners ${page + 1}`,
      ...records.slice((page - 1) * 4, page * 4).map((entry) => formatRunnerRecord(entry)),
      records.length ? "Detail: /runner <CA>. Daftar ini bukan rekomendasi beli." : "Belum ada kandidat. Gunakan /runner <CA> atau tunggu siklus discovery."
    ].filter(Boolean).join("\n\n").slice(0, 4000));
  });

  bot.command("runner", async (ctx) => {
    const mint = ctx.match.trim();
    if (!mint) { await ctx.reply("Kirim /runner <CA_Solana> untuk cek kandidat dan histori deteksi."); return; }
    try {
      const { snapshot } = await scanner.scan(mint);
      const assessment = assessRunner(snapshot);
      await monitor.observe(snapshot);
      const tracked = monitor.snapshot().records.find((entry) => entry.mint === snapshot.mint);
      await ctx.reply([
        `${snapshot.symbol} | ${snapshot.mint}`,
        `Runner Score: ${assessment.score ?? "belum tersedia"}`,
        `Status saat query: ${assessment.candidate ? "KANDIDAT" : "BELUM MEMENUHI / DATA BELUM LENGKAP"}`,
        ...assessment.reasons,
        tracked ? formatRunnerRecord(tracked) : "Belum masuk histori deteksi.",
        monitor.active ? "Pemantauan aktif." : "Pemantauan nonaktif. Admin perlu mengaktifkan runner.",
        "Runner Score adalah rule eksperimen, bukan prediksi return."
      ].join("\n"));
    } catch { await ctx.reply("Runner gagal mengambil data. Periksa CA, GMGN, dan izin file state; tidak memakai data contoh sebagai fallback."); }
  });

  for (const command of ["runner_on", "runner_off", "runner_remove"] as const) {
    bot.command(command, async (ctx) => {
      if (!ctx.from || !config.telegramAdminIds.includes(String(ctx.from.id))) {
        await ctx.reply("Perintah ini khusus user ID yang terdaftar pada TELEGRAM_ADMIN_IDS.");
        return;
      }
      try {
        if (command === "runner_remove") {
          await monitor.remove(ctx.match.trim());
          await ctx.reply("CA dihapus dari histori runner. Discovery berikutnya dapat mendeteksinya lagi.");
        } else {
          await monitor.pause(command === "runner_off");
          await ctx.reply(command === "runner_on" ? "Runner aktif. Siklus berikutnya akan mengambil data live." : "Runner dijeda. Histori tetap tersimpan.");
        }
      } catch {
        await ctx.reply("Periksa RUNNER_ENABLED=true, GMGN_PROVIDER=cli, CA, dan izin file state. Restart setelah mengubah .env.");
      }
    });
  }
}
