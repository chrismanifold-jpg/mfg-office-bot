import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

/* -------------------------
   Utility: Should Respond?
-------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

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

  // Contains explicit request phrases
  const contains = [
    "need",
    "stuck",
    "blocked",
    "does anyone know",
    "i can't",
    "urgent"
  ];

  if (contains.some(p => t.includes(p))) return true;

  return false;
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

  // Ignore non-text messages
  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const text = message.text;

  console.log("Incoming Telegram message:", text);

  // 🔒 SOP Step 4 — Gate responses
  if (!shouldRespond(text)) {
    console.log("Ignored (not a question/request)");
    return res.sendStatus(200);
  }

  // Temporary reply (will be replaced by OpenAI later)
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "Got it. I’ll help — what’s the exact issue?"
    })
  });

  res.sendStatus(200);
});

/* -------------------------
   Start Server
-------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
