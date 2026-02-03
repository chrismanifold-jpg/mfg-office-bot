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
   Memory (conversation state)
---------------------------- */
const pendingState = new Map();

/* ---------------------------
   Gating
---------------------------- */
const shouldRespond = (text) => {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes("?") ||
    ["how", "sign", "contract", "agreement", "arc", "stuck", "not sure"].some(k =>
      t.includes(k)
    )
  );
};

/* ---------------------------
   Hard Escalation
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
    const t = text.toLowerCase();
    const user = msg.from;

    const agentName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const agentUsername = user.username ? `@${user.username}` : "no_username";
    const agentLabel = `${agentName} (${agentUsername})`;

    console.log("Incoming:", agentLabel, text);

    if (!shouldRespond(text)) return res.sendStatus(200);

    /* ---------------------------
       HARD ESCALATION FIRST
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
       PENDING STATE HANDLER
    ---------------------------- */
    const pending = pendingState.get(chatId);

    // STEP 2: ARC ACCESS CONFIRMATION
    if (pending === "ARC_ACCESS") {
      const isYes = ["yes", "have", "already"].some(k => t.includes(k));
      const isNo = ["no", "none", "no access", "don't", "dont"].some(k =>
        t.includes(k)
      );

      if (isNo) {
        pendingState.delete(chatId);

        await sendMessage(
          chatId,
          "You’ll need ARC access first.\n\n" +
            "1. Go to https://arc.naaleads.com\n" +
            "2. Log in using your NAA credentials\n\n" +
            "If you didn’t receive access or can’t log in, email contracting@naaleads.com."
        );

        await sendDMToChris(
          `🚨 ARC ACCESS ISSUE\nAgent: ${agentLabel}\nAgent reports NO ARC access.`
        );

        return res.sendStatus(200);
      }

      if (isYes) {
        pendingState.delete(chatId);

        await sendMessage(
          chatId,
          "Which part are you currently on?\n" +
            "• Haven’t started contracting\n" +
            "• Submitted contracting requests\n" +
            "• Waiting for carrier approval\n" +
            "• Not sure / stuck"
        );

        pendingState.set(chatId, "CONTRACT_STAGE");
        return res.sendStatus(200);
      }

      await sendMessage(
        chatId,
        "Just to confirm — do you have ARC access? Please reply yes or no."
      );
      return res.sendStatus(200);
    }

    // STEP 3: CONTRACTING STAGE
    if (pending === "CONTRACT_STAGE") {
      pendingState.delete(chatId);

      if (t.includes("haven’t") || t.includes("not started")) {
        await sendMessage(
          chatId,
          "Next steps:\n" +
            "1. Log in to ARC\n" +
            "2. Click My Business → Contracting\n" +
            "3. Select Contracting Request\n" +
            "4. Start with recommended carriers only."
        );
        return res.sendStatus(200);
      }

      if (t.includes("submitted")) {
        await sendMessage(
          chatId,
          "To check your status:\n" +
            "1. Go to ARC\n" +
            "2. Open Contracting → My Contracts\n" +
            "3. Review carrier approval status."
        );
        return res.sendStatus(200);
      }

      await sendMessage(
        chatId,
        "Thanks. I’m escalating this to Chris so he can guide you on the next step."
      );

      await sendDMToChris(
        `⚠️ CONTRACTING STUCK\nAgent: ${agentLabel}\nStage:\n"${text}"`
      );

      return res.sendStatus(200);
    }

    /* ---------------------------
       STEP 1: CONTRACT QUESTION
    ---------------------------- */
    if (t.includes("sign") && t.includes("agreement")) {
      await sendMessage(
        chatId,
        "Quick check first — do you already have access to the ARC website using your NAA credentials?"
      );

      pendingState.set(chatId, "ARC_ACCESS");
      return res.sendStatus(200);
    }

    /* ---------------------------
       FALLBACK
    ---------------------------- */
    await sendMessage(
      chatId,
      "I don’t have enough information to proceed. I’m escalating this to Chris for guidance."
    );

    await sendDMToChris(
      `⚠️ UNRESOLVED QUESTION\nAgent: ${agentLabel}\nQuestion:\n"${text}"`
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
