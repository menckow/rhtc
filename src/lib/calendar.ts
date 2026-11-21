import type { ChainRow, GameRow, SafeUser, UserRow } from "@/db/index";

function formatIcalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcalText(text: string): string {
  return (text || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

export interface IcalItem {
  game: GameRow;
  chain: ChainRow;
  partner?: SafeUser | UserRow | null;
}

export function generateIcalCalendar(
  items: IcalItem[],
  user?: SafeUser | UserRow | null
): string {
  const calName = user
    ? `RHTC Schiri – ${user.first_name} ${user.last_name}`
    : "RHTC Schiedsrichter-Einsätze";

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RHTC Hamburg//Schiedsrichter Portal//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcalText(calName)}`,
    "X-WR-TIMEZONE:Europe/Berlin",
  ];

  const nowStr = formatIcalDate(new Date());

  for (const item of items) {
    const { game, chain, partner } = item;
    const kickoff = new Date(game.kickoff_at);
    // 90 minutes duration
    const end = new Date(kickoff.getTime() + 90 * 60 * 1000);

    let partnerText = "Offen / noch nicht besetzt";
    if (partner) {
      partnerText = `${partner.first_name} ${partner.last_name}`;
      if (partner.mobile_number) {
        partnerText += ` (Mobil: ${partner.mobile_number})`;
      }
    }

    const descriptionParts = [
      `Schiedsrichter-Einsatz: Slot ${chain.slot_number}`,
      `Schiri-Code: ${chain.ref_code || "-"}`,
      `Status: ${chain.status === "CONFIRMED" ? "Bestätigt" : "Zuweisung erhalten / unbestätigt"}`,
      `Schiri-Partner: ${partnerText}`,
      `Ort/Halle: ${game.location || "RHTC"}`,
    ];
    if (chain.payout_pool_cents > 0) {
      descriptionParts.push(`Auszahlungstopf: ${(chain.payout_pool_cents / 100).toFixed(2)} €`);
    }

    const summary = `RHTC Schiri: ${game.title} (Slot ${chain.slot_number})`;
    const location = game.location || "RHTC Hamburg";

    lines.push(
      "BEGIN:VEVENT",
      `UID:rhtc-chain-${chain.id}@rhtc.de`,
      `DTSTAMP:${nowStr}`,
      `DTSTART:${formatIcalDate(kickoff)}`,
      `DTEND:${formatIcalDate(end)}`,
      `SUMMARY:${escapeIcalText(summary)}`,
      `LOCATION:${escapeIcalText(location)}`,
      `DESCRIPTION:${escapeIcalText(descriptionParts.join("\n"))}`,
      `STATUS:${chain.status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE"}`,
      // 24 hours reminder
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      "DESCRIPTION:Erinnerung: Schiri-Einsatz morgen",
      "END:VALARM",
      // 2 hours reminder
      "BEGIN:VALARM",
      "TRIGGER:-PT2H",
      "ACTION:DISPLAY",
      "DESCRIPTION:Erinnerung: Schiri-Einsatz in 2 Stunden",
      "END:VALARM",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
