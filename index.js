import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CHRIS_TELEGRAM_ID = process.env.CHRIS_TELEGRAM_ID;
const PORT = process.env.PORT || 3000;

/* ---------------------------
   Constants
---------------------------- */
const KB_MISS_REPLY =
  "This question isn’t in my approved knowledge base yet. I’ll escalate this to Chris for review.";

/* ---------------------------
   Escalation Dedup Memory
---------------------------- */
const escalatedCases = new Map();
const ESCALATION_TTL_MS = 24 * 60 * 60 * 1000;

const normalizeText = (text) =>
  text
    .toLowerCase()
    .replace(/\$[\d,]+/g, "$AMOUNT")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();

/* ---------------------------
   HARD ESCALATION DETECTOR
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
   RAG — SOP REGISTRY
---------------------------- */
const SOP_LIBRARY = [
  {
    id: "contracting",
    title: "SOP – Contracting Checklist",
    keywords: [
      "contracting",
      "agent agreement",
      "arc",
      "naa",
      "carrier contracting",
      "w-9",
      "licenses",
      "tax document"
    ],
    content: `
PURPOSE:
Guide agents through the contracting process.

STEPS:
1. Log in to Training Portals:
   - https://www.tristategrp.com
   - https://naauniversity.com/login/
2. Complete required training modules
3. Complete ARC checklist:
   - Agent Agreement
   - Licenses
   - W-9
   - Carrier Contracting
   - Personal Use Policy
   - ARC Deposit

ESCALATE IF:
- No portal access after 48 hours
- Licensing issue blocks submission
`
  }
];

const findMatchingSOP = (text) => {
  const t = text.toLowerCase();
  return SOP_LIBRARY.find(sop =>
    sop.keywords.some(k => t.includes(k))
  );
};

/* ---------------------------
   SOP STEP 4 — GATING
---------------------------- */
const shouldRespond = (text) => {
  if (!text) return false;
  const t = text.toLowerCase().trim();

  if (t.includes("?")) return true;

  const starters = [
    "how",
    "how do i",
    "what",
    "what is",
    "what are",
    "when",
    "where",
    "who",
    "can you",
    "should i",
    "help",
    "next step",
    "next steps"
  ];

  if (starters.some(p => t === p || t.startsWith(p + " "))) return true;

  const contains = [
    "need help",
    "stuck",
    "blocked",
    "i can't",
    "not sure what to do"
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
  try {
    const message = req.body.message;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;
    const user = message.from;

    const agentName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const agentUsername = user.username ? `@${user.username}` : "no_username";
    const agentLabel = `${agentName} (${agentUsername})`;

    console.log("Incoming:", agentLabel, text);

    if (!shouldRespond(text)) return res.sendStatus(200);

    /* ---------------------------
       HARD ESCALATION (BYPASS RAG)
    ---------------------------- */
    if (isHardEscalation(text)) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text:
            "This looks like a high-risk or high-value case. I’m escalating this to Chris for guidance."
        })
      });

      const dedupKey = `${chatId}:${normalizeText(text)}`;
      const now = Date.now();
      const last = escalatedCases.get(dedupKey);

      if (!last || now - last > ESCALATION_TTL_MS) {
        escalatedCases.set(dedupKey, now);

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(CHRIS_TELEGRAM_ID),
            text: `🚨 CASE ESCALATION\n\nAgent: ${agentLabel}\nQuestion:\n"${text}"`
          })
        });
      }

      return res.sendStatus(200);
    }

    /* ---------------------------
       RAG — SOP ENFORCEMENT
    ---------------------------- */
    const matchedSOP = findMatchingSOP(text);

    if (!matchedSOP) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: KB_MISS_REPLY
        })
      });

      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: Number(CHRIS_TELEGRAM_ID),
          text: `📚 KB GAP\n\nAgent: ${agentLabel}\nQuestion:\n"${text}\n\n
          Hey Chris I don't know how to answer this one, can you reach back to the group to solve this concern?
          However what I need is a approve SOP for this concern so it can be add to my knowledge base by Jodie"`
        })
      });

      return res.sendStatus(200);
    }

    /* ---------------------------
       OPENAI (RAG SAFE)
    ---------------------------- */
    const systemInstructions = `
You may ONLY answer using the SOP below.
If insufficient, escalate.

APPROVED SOP:
${matchedSOP.content}

OUTPUT:
USER_REPLY:
<short answer>
ESCALATE: <YES/NO>
DM_TO_CHRIS:
<only if YES>
`;

    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            { role: "system", content: systemInstructions },
            { role: "user", content: text }
          ],
          temperature: 0
        })
      }
    );

    const data = await openaiResponse.json();
    const output = data.choices?.[0]?.message?.content || "";

    const replyMatch = output.match(/USER_REPLY:\s*([\s\S]*)/);
    if (replyMatch) {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyMatch[1].trim()
        })
      });
    }

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
