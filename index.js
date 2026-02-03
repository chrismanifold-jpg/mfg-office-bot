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
   Conversation State
   chatId -> { intent, step }
---------------------------- */
const pendingState = new Map();

/* ---------------------------
   SOP Intent Detection
---------------------------- */
const getSOPIntent = (text) => {
  const t = text.toLowerCase();
  if (t.includes("contract") || t.includes("agreement") || t.includes("arc")) {
    return "CONTRACTING";
  }
  return null;
};

const clearStateIfIntentChanged = (chatId, intent) => {
  const current = pendingState.get(chatId);
  if (current && current.intent !== intent) {
    pendingState.delete(chatId);
  }
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
    const rawText = msg.text;
    const text = rawText.trim().toLowerCase();
    const user = msg.from;

    const agentName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const agentUsername = user.username ? `@${user.username}` : "no_username";
    const agentLabel = `${agentName} (${agentUsername})`;

    console.log("Incoming:", agentLabel, rawText);

    /* 1️⃣ HARD ESCALATION */
    if (isHardEscalation(text)) {
      await sendMessage(
        chatId,
        "This looks like a high-risk or high-value case. I’m escalating this to Chris for guidance."
      );

      await sendDMToChris(
        `🚨 HIGH-RISK CASE\nAgent: ${agentLabel}\nQuestion:\n"${rawText}"`
      );

      return res.sendStatus(200);
    }

    /* 2️⃣ SOP INTENT CHECK */
    const intent = getSOPIntent(text);
    clearStateIfIntentChanged(chatId, intent);

    if (!intent) {
      await sendMessage(
        chatId,
        "This question isn’t in my approved knowledge base yet. I’ll escalate this to Chris for review."
      );

      await sendDMToChris(
        `📚 KB GAP\nAgent: ${agentLabel}\nQuestion:\n"${rawText}"`
      );

      return res.sendStatus(200);
    }

    /* ============================
       CONTRACTING SOP FLOW
       ============================ */

    const state = pendingState.get(chatId);

    /* STEP 1 — Ask ARC access */
    if (!state) {
      pendingState.set(chatId, { intent: "CONTRACTING", step: "ARC_ACCESS" });

      await sendMessage(
        chatId,
        "Quick check first — do you already have access to the ARC website using your NAA credentials? (yes / no)"
      );

      return res.sendStatus(200);
    }

    /* STEP 2 — ARC ACCESS */
    if (state.step === "ARC_ACCESS") {
      const yesAnswers = ["yes", "yep", "yeah", "have", "i do"];
      const noAnswers = ["no", "no access", "none", "dont", "don't"];

      if (noAnswers.some(a => text.includes(a))) {
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

      if (yesAnswers.some(a => text.includes(a))) {
        pendingState.set(chatId, { intent: "CONTRACTING", step: "STAGE" });

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

      return res.sendStatus(200);
    }

    /* STEP 3 — CONTRACTING STAGE */
    if (state.step === "STAGE") {
      pendingState.delete(chatId);

      // NOT STARTED / STEPS
      if (
        text.includes("haven’t started") ||
        text.includes("havent started") ||
        text.includes("not started") ||
        text.includes("start contracting") ||
        text.includes("steps")
      ) {
        await sendMessage(
          chatId,
          "Here’s how to start your contracting:\n\n" +
          "1. Log in to ARC: https://arc.naaleads.com\n" +
          "2. Go to **My Business → Contracting**\n" +
          "3. Click **New Contracting Request**\n" +
          "4. Start with recommended carriers only\n" +
          "5. Complete each required section before submitting\n\n" +
          "If something blocks you, tell me exactly where."
        );
        return res.sendStatus(200);
      }

      // SUBMITTED / WAITING
      if (text.includes("submitted") || text.includes("waiting") || text.includes("pending")) {
        await sendMessage(
          chatId,
          "To check your contracting status:\n\n" +
          "1. Log in to ARC\n" +
          "2. Open **Contracting → My Contracts**\n" +
          "3. Review the status for each carrier\n\n" +
          "If one carrier is delayed, tell me which one."
        );
        return res.sendStatus(200);
      }

      // STUCK
      if (text.includes("stuck") || text.includes("not sure")) {
        await sendMessage(
          chatId,
          "What issue are you running into?\n\n" +
          "• Login issue\n" +
          "• Missing documents\n" +
          "• Contract rejected\n" +
          "• No status update"
        );

        await sendDMToChris(
          `⚠️ CONTRACTING STUCK\nAgent: ${agentLabel}\nResponse:\n"${rawText}"`
        );

        return res.sendStatus(200);
      }

      // FALLBACK
      await sendMessage(
        chatId,
        "Thanks — I’m escalating this to Chris so he can guide you on the next step."
      );

      await sendDMToChris(
        `⚠️ CONTRACTING UNKNOWN STAGE\nAgent: ${agentLabel}\nResponse:\n"${rawText}"`
      );

      return res.sendStatus(200);
    }

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
