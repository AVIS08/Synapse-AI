require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const { ChatGroq } = require("@langchain/groq");
const { z } = require("zod");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

let gmailClient = null;

app.get("/", (req, res) => {
  res.send("SynapseAI backend running 🚀");
});


/* ---------------- GOOGLE LOGIN ---------------- */

app.get("/auth/google", (req, res) => {

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly"
    ]
  });

  res.redirect(authUrl);

});


/* ---------------- GOOGLE CALLBACK ---------------- */

app.get("/auth/google/callback", async (req, res) => {

  try {

    const code = req.query.code;

    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);

    gmailClient = google.gmail({
      version: "v1",
      auth: oauth2Client
    });

    console.log("✅ Gmail connected");

    res.send(`
      <h2>Gmail connected successfully ✅</h2>
      <p>Now open:</p>
      <a href="http://localhost:5173">http://localhost:5173</a>
    `);

  } catch (error) {

    console.error("OAuth Error:", error);
    res.send("Error connecting Gmail");

  }

});


/* ---------------- FETCH EMAILS ---------------- */

app.get("/emails", async (req, res) => {

  try {

    if (!gmailClient) {
      return res.status(401).json({
        error: "Login first at /auth/google"
      });
    }

    let allMessages = [];
    let nextPageToken = null;

    // Fetch up to 50 emails
    while (allMessages.length < 50) {

      const list = await gmailClient.users.messages.list({
        userId: "me",
        maxResults: 10,
        pageToken: nextPageToken
      });

      const messages = list.data.messages || [];

      allMessages.push(...messages);

      nextPageToken = list.data.nextPageToken;

      if (!nextPageToken) break;

    }

    const emails = [];

    for (let msg of allMessages.slice(0, 50)) {

      const email = await gmailClient.users.messages.get({
        userId: "me",
        id: msg.id
      });

      const headers = email.data.payload.headers;

      const subject =
        headers.find(h => h.name === "Subject")?.value || "No subject";

      const from =
        headers.find(h => h.name === "From")?.value || "Unknown";

      emails.push({
        id: msg.id,
        subject,
        from,
        preview: email.data.snippet
      });

    }

    res.json(emails);

  } catch (error) {

    console.error("Email fetch error:", error);

    res.status(500).json({
      error: "Error fetching emails"
    });

  }

});


/* ---------------- AI: ANALYZE TASKS ---------------- */
app.post("/api/analyze-tasks", async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails || !emails.length) return res.json([]);

    const llm = new ChatGroq({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      apiKey: process.env.GROQ_API_KEY,
    });

    const Schema = z.object({
      tasks: z.array(z.object({
        title: z.string().describe("Task description extracted from the email."),
        from: z.string().describe("The sender of the email."),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).describe("Urgency level based on content.")
      }))
    });

    const llmWithStructuredOutput = llm.withStructuredOutput(Schema);
    const emailsText = emails.map(e => `From: ${e.from}\nSubject: ${e.subject}\nBody: ${e.preview}\n\n`).join("---\n");

    const prompt = `You are a strict task extraction engine. Follow these EXACT rules for EVERY email:

RULES:
1. Extract a task from an email ONLY if the email explicitly asks the recipient to DO something (reply, submit, attend, review, pay, register, update, fix, complete, etc.).
2. Do NOT extract tasks from newsletters, promotions, notifications, automated alerts, or purely informational emails.
3. Every qualifying email produces EXACTLY ONE task.
4. Priority rules (follow strictly):
   - HIGH: Email asks to SUBMIT, COMPLETE, or DO something AND mentions a deadline or due date (even if not explicitly "urgent"). Also HIGH if it uses urgent language ("ASAP", "immediately", "urgent", "by today", "by tomorrow"), involves money/payments/legal matters, or has a deadline within 7 days.
   - MEDIUM: Requests an action but has no specific deadline mentioned, or the deadline is more than 7 days away.
   - LOW: Optional actions like "feel free to", "when you get a chance", suggestions, or general FYI with a soft ask.
5. The task title must start with a verb (e.g., "Reply to...", "Submit...", "Attend...", "Review...").

Emails:
${emailsText}`;

    const response = await llmWithStructuredOutput.invoke(prompt);
    res.json(response.tasks || []);

  } catch (err) {
    console.error("AI Analysis error:", err);
    res.status(500).json({ error: "Failed to analyze emails" });
  }
});

/* ---------------- AI: DETECT PHISHING ---------------- */
app.post("/api/detect-phishing", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const llm = new ChatGroq({
      model: "llama-3.3-70b-versatile",
      temperature: 0,
      apiKey: process.env.GROQ_API_KEY,
    });

    const Schema = z.object({
      riskLevel: z.enum(["SAFE", "MEDIUM", "HIGH"]).describe("The estimated phishing risk level of the email."),
      reasons: z.array(z.string()).describe("List of warnings or reasons for the risk level. Empty if completely safe.")
    });

    const llmWithStructuredOutput = llm.withStructuredOutput(Schema);
    const emailText = `From: ${email.from}\nSubject: ${email.subject}\nBody: ${email.preview}`;
    const prompt = `Analyze this email for phishing, scam, or security risks. Be paranoid but accurate.
Email:
${emailText}`;

    const response = await llmWithStructuredOutput.invoke(prompt);
    res.json(response);

  } catch (err) {
    console.error("Phishing detection error:", err);
    res.status(500).json({ error: "Failed to detect phishing" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} 🚀`);
});