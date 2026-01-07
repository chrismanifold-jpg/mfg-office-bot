import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID; // numeric ID
const PORT = process.env.PORT || 3000;

/* ---------------------------
   SOP STEP 4 — GATING
---------------------------- */
const shouldRespond = (text) => {
  const t = text.toLowerCase();

  const highRisk = ["annuity", "replacement", "rollover", "ira", "401k", "$"];
  if (highRisk.some(p => t.includes(p))) return true;

  if (t.includes("?")) return true;

  const starts = [
    "how","what","when","where","who",
    "can you","should i","help","next step"
  ];
  if (starts.some(p => t.startsWith(p))) return true;

  const contains = [
    "need","stuck","blocked",
    "does anyone know","i can't",
    "urgent","not sure what to do"
  ];
  return contains.some(p => t.includes(p));
};

/* ---------------------------
   Health Check
---------------------------- */
app.get("/", (req, res) => {
  res.send("MFG Office Bot is running ✅");
});

/* ---------------------------
   Telegram Webhook
---------------------------- */
app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  console.log("Incoming Telegram message:", text);

  if (!shouldRespond(text)) {
    console.log("Ignored (chatter)");
    return res.sendStatus(200);
  }

  /* ---------------------------
     SOP STEP 5 — OPENAI DECISION
  ---------------------------- */
  const systemInstructions = `
You are the internal AI assistant for Manifold Financial Group.

You MUST output in this exact structure every time:

ESCALATE: <YES/NO>
ESCALATE_REASON: <short reason or NONE>
EXPECTED_COMMISSION_USD: <number or UNKNOWN>
USER_REPLY:
<short, action-forcing response>
DM_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
EMAIL_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
`;

  const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemInstructions },
        { role: "user", content: text }
      ],
      temperature: 0
    })
  });

  const data = await openaiResponse.json();
  const output = data.choices[0].message.content;

  console.log("OpenAI raw output:\n", output);

  /* ---------------------------
     PARSE DECISION HEADER
  ---------------------------- */
  const get = (label) => {
    const match = output.match(new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`));
    return match ? match[1].trim() : "NONE";
  };

  const ESCALATE = get("ESCALATE");
  const USER_REPLY = get("USER_REPLY");
  const DM_TO_CHRIS = get("DM_TO_CHRIS");
  const EMAIL_TO_CHRIS = get("EMAIL_TO_CHRIS");

  /* ---------------------------
     Public reply (ONLY this)
  ---------------------------- */
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: USER_REPLY
    })
  });

  console.log("Bot replied successfully");

  /* ---------------------------
     Escalation delivery
  ---------------------------- */
  if (ESCALATE === "YES") {
    console.log("ESCALATION TRIGGERED");

    // Telegram DM to Chris
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: Number(CHRIS_TELEGRAM_ID),
        text: DM_TO_CHRIS
      })
    });

    // Email placeholder (SendGrid/Mailgun next)
    console.log("EMAIL_TO_CHRIS:\n", EMAIL_TO_CHRIS);
  }

  res.sendStatus(200);
});

/* ---------------------------
   Start Server
---------------------------- */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
