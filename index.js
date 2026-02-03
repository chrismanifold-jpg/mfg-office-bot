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

    /* ============================
       1️⃣ HARD ESCALATION (ALWAYS FIRST)
       ============================ */
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

    /* ============================
       2️⃣ ACTIVE SOP FLOW (PRIORITY)
       ============================ */
    const state = pendingState.get(chatId);

    if (state?.intent === "CONTRACTING") {
      /* ---- ARC ACCESS CHECK ---- */
      if (state.step === "ARC_ACCESS") {
        const yes = ["yes", "yep", "yeah", "i do", "have"].some(w => text.includes(w));
        const no = ["no", "no access", "none", "dont", "don't"].some(w => text.includes(w));

        if (no) {
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

        if (yes) {
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
          "Please reply **yes** or **no** so I can guide you correctly."
        );
        return res.sendStatus(200);
      }

      /* ---- CONTRACTING STAGE ---- */
      if (state.step === "STAGE") {
        pendingState.delete(chatId);

        if (text.includes("haven’t") || text.includes("not started")) {
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

        if (text.includes("submitted")) {
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
          "Thanks — I’m escalating this to Chris so he can guide you on the next step."
        );

        await sendDMToChris(
          `⚠️ CONTRACTING STUCK\nAgent: ${agentLabel}\nResponse:\n"${rawText}"`
        );

        return res.sendStatus(200);
      }
    }

    /* ============================
       3️⃣ SOP INTENT DETECTION
       ============================ */
    const intent = getSOPIntent(text);

    if (intent === "CONTRACTING") {
      pendingState.set(chatId, { intent: "CONTRACTING", step: "ARC_ACCESS" });

      await sendMessage(
        chatId,
        "Quick check first — do you already have access to the ARC website using your NAA credentials? (yes / no)"
      );

      return res.sendStatus(200);
    }

    /* ============================
       4️⃣ KB GAP (NO SOP)
       ============================ */
    await sendMessage(
      chatId,
      "This question isn’t in my approved knowledge base yet. I’ll escalate this to Chris for review."
    );

    await sendDMToChris(
      `📚 KB GAP\nAgent: ${agentLabel}\nQuestion:\n"${rawText}"`
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
