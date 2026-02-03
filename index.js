import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID;
const PORT = process.env.PORT || 3000;

/* ---------------------------
   Helpers
---------------------------- */
const sendMessage = async (chatId, text) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
};

const sendDMToChris = async (text) => {
  if (!CHRIS_TELEGRAM_ID) return;
  await sendMessage(Number(CHRIS_TELEGRAM_ID), text);
};

/* ---------------------------
   Light Conversation State
---------------------------- */
const pendingQuestion = new Map(); // chatId -> "ARC_ACCESS"

/* ---------------------------
   GATING
---------------------------- */
const shouldRespond = (text) => {
  if (!text) return false;
  const t = text.toLowerCase();

  if (t.includes("?")) return true;

  const triggers = [
    "how",
    "sign",
    "contract",
    "agreement",
    "arc",
    "stuck",
    "not sure",
    "can't",
    "blocked"
  ];

  return triggers.some(k => t.includes(k));
};

/* ---------------------------
   HIGH-RISK ESCALATION
---------------------------- */
const isHardEscalation = (text) => {
  const t = text.toLowerCase();
  return (
    t.includes("annuity") ||
    t.includes("replacement") ||
    t.includes("rollover") ||
    t.includes("commission") ||
    /\$\s?\d{2,}/.test(t)
  );
};

/* ---------------------------
   Health Check
---------------------------- */
app.get("/", (_, res) => {
  res.send("MFG Office Bot is running ✅");
});

/* ---------------------------
   Telegram Webhook
---------------------------- */
app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.message;
    if (!msg || !msg.text) return res.sendStatus(200);

    const chatId = msg.chat.id;
    const text = msg.text.trim();
    const user = msg.from;

    const agentName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const agentUsername = user.username ? `@${user.username}` : "no_username";
    const agentLabel = `${agentName} (${agentUsername})`;

    console.log("Incoming:", agentLabel, text);

    if (!shouldRespond(text)) return res.sendStatus(200);

    /* ---------------------------
       HARD ESCALATION (always first)
    ---------------------------- */
    if (isHardEscalation(text)) {
      await sendMessage(
        chatId,
        "This looks like a high-risk or high-value case. I’m escalating this to Chris for guidance."
      );

      await sendDMToChris(
        `🚨 HIGH-RISK CASE\nAgent: ${agentLabel}\nQuestion:\n"${text}"`
      );

      return res.sendStatus(200);
    }

    /* ---------------------------
       Handle pending ARC access reply
    ---------------------------- */
    const pending = pendingQuestion.get(chatId);
    if (pending === "ARC_ACCESS") {
      pendingQuestion.delete(chatId);
      const t = text.toLowerCase();

      if (t === "no" || t.includes("no")) {
        await sendMessage(
          chatId,
          "You’ll need ARC access first.\n\n" +
          "1. Go to https://arc.naaleads.com\n" +
          "2. Log in using your NAA credentials\n\n" +
          "If you did not receive access or can’t log in, contact contracting@naaleads.com."
        );

        await sendDMToChris(
          `🚨 ARC ACCESS ISSUE\nAgent: ${agentLabel}\nAgent reports NO ARC access.`
        );

        return res.sendStatus(200);
      }

      if (t === "yes" || t.includes("yes")) {
        await sendMessage(
          chatId,
          "Which part are you currently on?\n" +
          "• Haven’t started contracting\n" +
          "• Submitted contracting requests\n" +
          "• Waiting for carrier approval\n" +
          "• Not sure / stuck"
        );
        return res.sendStatus(200);
      }

      await sendMessage(
        chatId,
        "Just to confirm — do you have ARC access? Please reply yes or no."
      );
      pendingQuestion.set(chatId, "ARC_ACCESS");
      return res.sendStatus(200);
    }

    /* ---------------------------
       CONTRACT AGREEMENT FLOW
    ---------------------------- */
    if (
      text.toLowerCase().includes("sign") &&
      text.toLowerCase().includes("agreement")
    ) {
      await sendMessage(
        chatId,
        "Quick check first — do you already have access to the ARC website using your NAA credentials?"
      );
      pendingQuestion.set(chatId, "ARC_ACCESS");
      return res.sendStatus(200);
    }

    /* ---------------------------
       STAGE RESPONSES
    ---------------------------- */
    if (text.toLowerCase().includes("haven’t started")) {
      await sendMessage(
        chatId,
        "Next steps:\n" +
        "1. Log in to ARC\n" +
        "2. Go to My Business → Contracting\n" +
        "3. Select Contracting Request\n" +
        "4. Start with recommended carriers only."
      );
      return res.sendStatus(200);
    }

    if (text.toLowerCase().includes("submitted")) {
      await sendMessage(
        chatId,
        "To check your status:\n" +
        "1. Log in to ARC\n" +
        "2. Open Contracting → My Contracts\n" +
        "3. Review each carrier’s status."
      );
      return res.sendStatus(200);
    }

    if (
      text.toLowerCase().includes("stuck") ||
      text.toLowerCase().includes("not sure")
    ) {
      await sendMessage(
        chatId,
        "What issue are you seeing?\n" +
        "• Login issue\n" +
        "• Missing documents\n" +
        "• Contract rejected\n" +
        "• No status update"
      );

      await sendDMToChris(
        `⚠️ AGENT STUCK\nAgent: ${agentLabel}\nAgent reports being stuck during contracting.`
      );

      return res.sendStatus(200);
    }

    /* ---------------------------
       Fallback
    ---------------------------- */
    await sendMessage(
      chatId,
      "I don’t have enough information to proceed. I’m escalating this to Chris for guidance."
    );

    await sendDMToChris(
      `⚠️ UNRESOLVED CONTRACTING QUESTION\nAgent: ${agentLabel}\nQuestion:\n"${text}"`
    );

    return res.sendStatus(200);

  } catch (err) {
    console.error("Webhook error:", err);
    return res.sendStatus(200);
  }
});

/* ---------------------------
   Start Server
---------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
