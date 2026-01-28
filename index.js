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

COMMON ISSUES:
- No email received
- License rejected
- Portal access error

ESCALATE IF:
- No portal access after 48 hours
- Licensing issue blocks submission
`
  }
];

const findMatchingSOP = (text) => {
  const t = text.toLowerCase();
  return SOP_LIBRARY.find((sop) =>
    sop.keywords.some((k) => t.includes(k))
  );
};

/* ---------------------------
   SOP STEP 4 — GATING
---------------------------- */
const shouldRespond = (text) => {
  if (!text) return false;
  const t = text.toLowerCase().trim();

  const highRisk = [
    "annuity",
    "replacement",
    "rollover",
    "ira",
    "401k",
    "$",
    "commission"
  ];
  if (highRisk.some((p) => t.includes(p))) return true;

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
  if (starters.some((p) => t === p || t.startsWith(p + " "))) return true;

  const contains = [
    "need help",
    "need to",
    "stuck",
    "blocked",
    "does anyone know",
    "i can't",
    "urgent",
    "not sure what to do",
    "what should i do"
  ];
  return contains.some((p) => t.includes(p));
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

    console.log("Incoming message from:", agentLabel);
    console.log("Message:", text);

    if (!shouldRespond(text)) {
      console.log("Ignored (gating)");
      return res.sendStatus(200);
    }

    /* ---------------------------
       RAG — SOP ENFORCEMENT
    ---------------------------- */
    const matchedSOP = findMatchingSOP(text);

    if (!matchedSOP) {
      console.log("No SOP match — KB gap detected");

      // Public reply
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: KB_MISS_REPLY
        })
      });

      // DM Chris (knowledge-base gap alert)
      if (CHRIS_TELEGRAM_ID) {
        const kbAlert = `
📚 Knowledge Base Gap Detected

Agent: ${agentLabel}
Question:
"${text}"

Action needed:
Hey Chris, I don't know how to answer this one, can you reach back to the group and answer this concern?
However it will be sent to Jodie to add in drive, what I need from you is to
Create or approve an SOP for this topic and add it to the MFG_AI_Knowledge_Base.
`;

        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(CHRIS_TELEGRAM_ID),
            text: kbAlert
          })
        });

        console.log("KB gap DM sent to Chris");
      }

      return res.sendStatus(200);
    }

    /* ---------------------------
       SOP STEP 5 — OPENAI (RAG SAFE)
    ---------------------------- */
    const systemInstructions = `
You are the internal AI assistant for Manifold Financial Group.

You may ONLY answer using the approved SOP below.
Do NOT add information not found in the SOP.
If the SOP does not fully answer the question, escalate.

APPROVED SOP:
${matchedSOP.content}

OUTPUT FORMAT (STRICT):

ESCALATE: <YES/NO>
ESCALATE_REASON: <short reason or NONE>
EXPECTED_COMMISSION_USD: <number or UNKNOWN>
USER_REPLY:
<short, action-forcing response based ONLY on SOP>
DM_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
EMAIL_TO_CHRIS:
<only if ESCALATE=YES, else NONE>
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
    if (!data.choices?.[0]) return res.sendStatus(200);

    const output = data.choices[0].message.content;

    const get = (label) => {
      const match = output.match(
        new RegExp(`${label}:([\\s\\S]*?)(?=\\n[A-Z_]+:|$)`)
      );
      return match ? match[1].trim() : null;
    };

    const ESCALATE = get("ESCALATE");
    const USER_REPLY = get("USER_REPLY");
    const DM_TO_CHRIS = get("DM_TO_CHRIS");

    if (USER_REPLY && USER_REPLY !== "NONE") {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: USER_REPLY
        })
      });
    }

    if (ESCALATE === "YES" && CHRIS_TELEGRAM_ID && DM_TO_CHRIS && DM_TO_CHRIS !== "NONE") {
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
            text: `🚨 Escalation from ${agentLabel}\n\n${DM_TO_CHRIS}`
          })
        });
      }
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
