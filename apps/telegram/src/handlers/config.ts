import type { Bot } from "grammy";
import type { RunnerMonitor } from "@sti/analysis";
import type { AppConfig } from "@sti/shared";

export function registerConfigCommands(bot: Bot, monitor: RunnerMonitor, config: AppConfig): void {
  for (const command of ["getconfig", "setconfig"] as const) {
    bot.command(command, async (ctx) => {
      if (!ctx.from || !config.telegramAdminIds.includes(String(ctx.from.id))) {
        await ctx.reply("Perintah ini khusus user ID yang terdaftar pada TELEGRAM_ADMIN_IDS.");
        return;
      }
      const args = ctx.match.trim().split(/\s+/).filter(Boolean);
      if (command === "getconfig") {
        const section = args[0];
        if (args.length > 1 || (section && section !== "tokenAlerts" && section !== "bscAlerts" && section !== "robinhoodAlerts")) {
          await ctx.reply("Gunakan /getconfig [tokenAlerts|bscAlerts|robinhoodAlerts].");
          return;
        }
        const settings = monitor.snapshot().alertConfig;
        await ctx.reply(["PENGATURAN RUNNER", ...Object.entries(settings)
          .filter(([key]) => !section || key === section)
          .flatMap(([key, fields]) => Object.entries(fields).map(([field, value]) => `${key}.${field}: ${value}`)),
          "Ubah: /setconfig <key> <value>. Tersimpan tanpa restart.",
          "Prasyarat: RUNNER_ENABLED=true, GMGN_PROVIDER=cli, ENABLED_CHAINS, dan TELEGRAM_RUNNER_CHAT_ID."].join("\n"));
        return;
      }
      if (args.length !== 2) {
        await ctx.reply("Gunakan /setconfig <key> <value>. Contoh: /setconfig tokenAlerts.enabled true");
        return;
      }
      try {
        const saved = await monitor.setConfig(args[0], args[1]);
        await ctx.reply(`Tersimpan: ${saved.key} = ${saved.value}\nBerlaku pada siklus berikutnya tanpa restart. Lihat /getconfig.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        await ctx.reply(message.startsWith("Key tidak dikenal") || /^(tokenAlerts|bscAlerts|robinhoodAlerts)\./.test(message)
          ? message : "Gagal menyimpan config. Periksa izin file state; config sebelumnya dipertahankan.");
      }
    });
  }
}
