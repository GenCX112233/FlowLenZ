// .env must win over any stale OPENAI_API_KEY set in the Windows environment.
require("dotenv").config({ override: true });

const express = require("express");
const OpenAI = require("openai").default;

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const API_SECRET = process.env.API_SECRET;
const PORT = process.env.PORT || 3000;

const ARCHITECT_SEMANTICS =
  "\n\nArchitect exit semantics - use precise language when describing these outcomes: " +
  "'Failure' on Transfer to User means a system error occurred during the transfer attempt, NOT that the agent is unavailable (unavailability is handled by voicemail rollover, not the Failure path). " +
  "'Failure' on Transfer to ACD means a system error occurred routing to the queue, not that agents are busy. " +
  "'Failure' on Call Data Action means the external API returned an error. " +
  "'Timeout' on Call Data Action means the external API did not respond in time. " +
  "'No' on a Decision means the condition evaluated to false.";

const SYSTEM_PROMPT =
  "You are a Genesys Cloud contact flow analyst. " +
  "Given structured change facts about a flow, write 2-3 short sentences (maximum 45 words in total) explaining the customer journey impact in plain English. " +
  "Mention only the most important caller-facing changes. " +
  "Use the branch wiring lines (from -> to) to describe the sequence of events a caller experiences, not just the individual changes in isolation. " +
  "Focus on what callers will experience differently - routing, prompts, queues, bot interactions, and specific agents or users they are transferred to. " +
  "Be specific about named queues, prompts, agents, and flows where mentioned. " +
  "Do not repeat block names or tracking IDs verbatim. Do not use bullet points." +
  ARCHITECT_SEMANTICS;

const QA_SYSTEM_PROMPT =
  "You are a Genesys Cloud Architect flow expert with two roles. " +
  "Role 1 — Flow Q&A: answer questions about the provided flow context accurately and concisely. " +
  "If the answer is not in the context, say so clearly. Do not invent block names, queues, or behaviour. " +
  "Role 2 — Build guidance: when the user asks how to build, implement, or improve something in Architect, " +
  "give concrete, actionable advice using Architect block types and patterns. " +
  "Where relevant, reference existing blocks or wiring already in the flow (e.g. 'you already have block 13 Play Audio for transfer failures — wire the Failure exit there'). " +
  "Recommend specific Architect block types by name (e.g. Decision, Collect Input, Transfer to ACD, Call Data Action, Loop). " +
  "Keep answers concise. Use plain English. Use bullet points only when listing steps or options." +
  ARCHITECT_SEMANTICS;

function authMiddleware(req, res, next) {
  if (req.headers["x-api-key"] !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/", (req, res) => {
  res.json({
    service: "FlowLenZ AI service",
    status: "running",
    model: "gpt-4o-mini",
    openAiKeyConfigured: Boolean(process.env.OPENAI_API_KEY),
    endpoints: ["POST /flows/impact", "POST /flows/qa"]
  });
});

app.post("/flows/impact", authMiddleware, async (req, res) => {
  const { facts } = req.body;

  if (!facts || typeof facts !== "string" || !facts.trim()) {
    return res.status(400).json({ error: "facts field is required" });
  }

  console.log("--- Incoming facts ---");
  console.log(facts);
  console.log("----------------------");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: facts }
      ],
      max_tokens: 100,
      temperature: 0.4
    });

    const narrative = completion.choices[0]?.message?.content?.trim() || "";
    console.log("--- AI narrative ---");
    console.log(narrative);
    console.log("--------------------");
    res.json({ narrative });
  } catch (error) {
    console.error("OpenAI error:", error.message);
    res.status(502).json({ error: "AI service unavailable" });
  }
});

app.post("/flows/qa", authMiddleware, async (req, res) => {
  const { context, history, question } = req.body;

  if (!context || !question) {
    return res.status(400).json({ error: "context and question are required" });
  }

  const messages = [
    { role: "system", content: QA_SYSTEM_PROMPT },
    { role: "user", content: `Flow context:\n${context}` }
  ];

  if (Array.isArray(history)) {
    for (const turn of history) {
      if (turn.role && turn.content) messages.push(turn);
    }
  }

  messages.push({ role: "user", content: question });

  console.log("--- QA context ---");
  console.log(context);
  console.log("------------------");
  console.log("--- QA question ---");
  console.log(question);
  console.log("-------------------");

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 600,
      temperature: 0.3
    });

    const answer = completion.choices[0]?.message?.content?.trim() || "";
    console.log("--- QA answer ---");
    console.log(answer);
    console.log("-----------------");
    res.json({ answer });
  } catch (error) {
    console.error("OpenAI QA error:", error.message);
    res.status(502).json({ error: "AI service unavailable" });
  }
});

app.listen(PORT, () => {
  console.log(`FlowLenZ AI service running on http://localhost:${PORT}`);
});
