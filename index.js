import express from "express";
import fetch from "node-fetch";

const app = express(); // ✅ THIS WAS MISSING
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 3000;

// Health check
app.get("/", (req, res) => {
  res.send("MFG Office Bot is running ✅");
});

// Telegram webhook
app.post("/webhook", async (req, res) => {
  const message = req.body.message;

  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const chatId = message.chat.id;
  const text = message.text;

  console.log("Incoming Telegram message:", text);

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: "✅ Bot connected. Webhook is working."
    })
  });

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
