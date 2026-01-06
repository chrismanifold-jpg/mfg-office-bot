import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------
   SOP STEP 4 — SHOULD RESPOND (WITH RISK OVERRIDE)
------------------------------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

  // 🚨 Always respond to high-value or compliance-risk signals
  const highRiskSignals = [
    "annuity",
    "replacement",
    "rollover",
    "ira",
    "401k",
    "$"
  ];

  if (highRiskSignals.some(p => t.includes(p))) {
    console.log("High-risk signal detected");
    return true;
  }

  // Question mark
  if (t.includes("?")) return true;

  // Starts with common question words
  const startsWith = [
    "how",
    "what",
    "when",
    "where",
    "who",
    "can you",
    "should i",
    "help",
    "next step"
  ];

  if (startsWith.some(p => t.startsWith(p))) return true;

  // Explicit help / uncertainty phrases
  const contains = [
    "need",
    "stuck",
    "blocked",
    "does anyone know",
    "i can't",
    "urgent",
    "not sure what to do"
  ];

  return contains.some(p => t.includes(p));
};

/* -------------------------
   Health Check
-------------------------- */
app.get("/", (req, res) => {
  res.send("MFG Office Bot is running ✅");
});

/* -------------------------
   Telegram Webhook
-------------------------- */
app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const text = message.text;

  console.log("Incoming Telegram message:", text);

  // Apply gating
  if (!shouldRespond(text)) {
    console.log("Ignored (chatter)");
    return res.sendStatus(200);
  }

  // TEMP response (OpenAI comes next step)
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Flagged. This may require escalation. Stand by."
    })
  });

  console.log("Bot replied successfully");
  res.sendStatus(200);
});

/* -------------------------
   Start Server
-------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
