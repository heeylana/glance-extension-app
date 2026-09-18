/**
 * Acting on a spoken command (spec §7.4). Every action presses the button a tap would press, so a
 * spoken buy runs the same code, guards and plain-language lines as a tapped one. A buy goes through
 * only when the user could already see which company it was for (a buy card, the choice chips, the
 * "is this about…" question, or a buy just made); otherwise Glance sets the card up and asks.
 */
import type { Bubble } from "./bubble";
import type { VoiceCommand, VoiceContext } from "../../lib/api-types";

export interface VoiceDeps {
  bubble: Bubble;
  /** Read the page and show the result, as ⌥G does. */
  glance: () => Promise<void>;
  saveNote: (journalId: number, note: string) => Promise<boolean>;
  /** Hold a note for the buy the user is about to make. */
  keepNote: (note: string) => void;
  /** Answer the question that was just heard, out loud, drawing on the page. */
  explain: () => Promise<void>;
  scroll: (direction: "up" | "down" | "top" | "bottom") => Promise<void>;
  /** Answer from the vault: cash, today's limit, or holdings (of one company, if named). */
  account: (kind: "balance" | "limit" | "holdings", companyId: string | null) => Promise<void>;
  /** Open the sell card for a position; the sale itself waits for "yes" or a tap. */
  sell: (companyId: string | null, amountUsd: number | null, all: boolean) => Promise<void>;
  /** Keep this page's facts in this browser for questions on other pages. */
  remember: () => Promise<void>;
}

const HINT = "Try “buy ten dollars”, “why did it move?” or “no”.";
const dollars = (n: number) => `$${Math.round(n)}`;

/** `before` is the card as it was when the user let go; `d.bubble` is the card now. */
export async function runCommand(cmd: VoiceCommand, before: VoiceContext, d: VoiceDeps): Promise<void> {
  const b = d.bubble;
  const offerBuy = (speakSummaryFirst: boolean) => {
    const e = b.entity;
    if (b.view !== "company" || !e) return;
    const line = `Buy ${dollars(b.amountUsd)} of ${e.name}? Say yes or tap Buy.`;
    b.reply(line, speakSummaryFirst && b.summary ? `${b.summary} ${line}` : undefined);
  };

  switch (cmd.kind) {
    case "glance":
      return d.glance();

    case "list":
      if (b.showChoices()) return;
      await d.glance();
      if (b.view === "company" && b.entity) b.reply(`${b.entity.name} is the only company I see here.`);
      return;

    case "cancel":
      if (!b.press("no")) b.close();
      return;

    case "confirm":
      if (before.view === "company" && b.press("buy")) return;
      if (before.view === "sell" && b.press("sell")) return;
      if (b.press("yes") || b.press("watch") || b.press("retry")) return;
      b.reply(b.view === "choice" ? "Which one? Say its name." : "There's nothing to say yes to yet.");
      return;

    case "amount":
      if (cmd.amountUsd === null) break;
      b.chooseAmount(cmd.amountUsd);
      if (b.view === "choice") b.reply(`${dollars(cmd.amountUsd)}. Which one?`);
      else if (b.view !== "company") b.reply(`Okay, ${dollars(cmd.amountUsd)} next time.`);
      return;

    case "pick":
      if (cmd.companyId && b.pickCompany(cmd.companyId)) return;
      b.reply("I don't see that one here.");
      return;

    case "buy": {
      if (cmd.amountUsd !== null) b.chooseAmount(cmd.amountUsd);
      const sawCompanies = before.view === "company" || before.view === "choice" || before.view === "ask" || before.view === "done";
      if (cmd.companyId) {
        // A company named out loud that was on the card: that is as explicit as tapping it.
        if (before.view === "company" && cmd.companyId === before.current?.companyId) {
          b.press("buy");
          return;
        }
        if (!b.pickCompany(cmd.companyId)) {
          b.reply("I don't see that one here.");
          return;
        }
        if (sawCompanies) b.press("buy");
        else offerBuy(false);
        return;
      }
      if (before.view === "company") {
        b.press("buy");
        return;
      }
      if (before.view === "done" && b.reopenEntity()) {
        b.press("buy");
        return;
      }
      if (before.view === "ask") {
        // The page was only probably about this company: open its card and let the user say yes.
        b.press("yes");
        offerBuy(false);
        return;
      }
      if (before.view === "choice") {
        b.reply("Which one? Say its name.");
        return;
      }
      if (before.view === "untokenized") {
        b.reply("That one isn't on-chain yet. Say “tell me when” and I'll let you know.");
        return;
      }
      // Nothing on screen yet: read the page, then ask before spending anything.
      await d.glance();
      offerBuy(true);
      return;
    }

    case "why":
      if (b.press("why")) return;
      if (before.view === "closed" || before.view === "error") {
        await d.glance();
        if (b.press("why")) return;
      }
      if (b.view === "choice") b.reply("Which company? Say its name first.");
      else if (b.view !== "none") b.reply("Glance a story about a company first.");
      return;

    case "watch":
      if (b.press("watch")) return;
      b.reply(b.view === "company" ? "You can already buy this one. Say “buy ten dollars”." : "Glance a story about a company first.");
      return;

    case "note": {
      const note = cmd.note?.trim();
      if (!note) break;
      const id = b.lastJournalId;
      if (id !== null) {
        b.reply((await d.saveNote(id, note)) ? "Saved your note." : "I couldn't save that note. Try again?");
        return;
      }
      if (b.view === "company") {
        d.keepNote(note);
        b.reply("Got it. I'll save that with this buy.");
        return;
      }
      b.reply("Buy something first, then tell me the note.");
      return;
    }

    case "explain":
      return d.explain();

    case "balance":
    case "limit":
    case "holdings":
      return d.account(cmd.kind, cmd.companyId);

    case "sell":
      return d.sell(cmd.companyId ?? (before.view === "sell" ? (before.current?.companyId ?? null) : null), cmd.amountUsd, cmd.all === true);

    case "scroll":
      if (!cmd.direction) break;
      return d.scroll(cmd.direction);

    case "remember":
      return d.remember();

    case "settings":
      // Limits, deposits, withdrawals and revoking need the owner's wallet, so voice only says where they are.
      b.reply("I can't change that by voice. Your limit, deposits and withdrawals are in Settings in the Glance panel, and they need your wallet's approval.");
      return;

    case "unknown":
      break;
  }
  b.reply(`Sorry, I didn't catch that. ${HINT}`);
}
