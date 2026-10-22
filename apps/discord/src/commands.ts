import { SlashCommandBuilder } from "discord.js";

const chains = [{ name: "Solana", value: "sol" }, { name: "BSC", value: "bsc" }, { name: "Robinhood Chain", value: "robinhood" }];
const tokenCommand = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description)
  .addStringOption((o) => o.setName("ca").setDescription("Contract address token").setRequired(true).setMaxLength(100))
  .addStringOption((o) => o.setName("chain").setDescription("Wajib dipilih untuk alamat EVM").addChoices(...chains));

export const discordCommands = [
  tokenCommand("scan", "Scan token"), tokenCommand("runner", "Lihat histori pemantauan token"),
  tokenCommand("runner_remove", "Admin: hapus token dari pemantauan"),
  new SlashCommandBuilder().setName("status").setDescription("Status bot dan runner"),
  new SlashCommandBuilder().setName("runners").setDescription("Daftar token terpantau")
    .addIntegerOption((o) => o.setName("page").setDescription("Halaman").setMinValue(1)),
  new SlashCommandBuilder().setName("runner_on").setDescription("Admin: lanjutkan runner"),
  new SlashCommandBuilder().setName("runner_off").setDescription("Admin: jeda runner"),
  new SlashCommandBuilder().setName("getconfig").setDescription("Admin: lihat filter runner Discord")
    .addStringOption((o) => o.setName("section").setDescription("Bagian konfigurasi").addChoices(
      { name: "Solana", value: "tokenAlerts" }, { name: "BSC", value: "bscAlerts" }, { name: "RH", value: "robinhoodAlerts" })),
  new SlashCommandBuilder().setName("setconfig").setDescription("Admin: ubah filter runner Discord")
    .addStringOption((o) => o.setName("key").setDescription("Contoh: tokenAlerts.minVolume5mUsd").setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName("value").setDescription("Angka atau true/false").setRequired(true).setMaxLength(50))
].map((command) => command.toJSON());
