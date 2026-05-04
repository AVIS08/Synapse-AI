require("dotenv").config();

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");
global.WebSocket = require("ws");
const { google } = require("googleapis");
const { getLLM } = require("./llm");
const { z } = require("zod");
const { embedTexts, similaritySearch } = require("./embeddings");

const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors({
  origin: true, // Allow all for local dev to prevent CORS issues
  credentials: true
}));

// DIAGNOSTIC LOGGING: Log all errors to a file
const logStream = fs.createWriteStream(path.join(__dirname, "server.log"), { flags: "a" });
function logError(err, context = "") {
  let errStr = err;
  if (err && typeof err === 'object') {
    errStr = err.stack ? err.stack : JSON.stringify(err, null, 2);
  }
  const msg = `[${new Date().toISOString()}] ${context}: ${errStr}\n`;
  console.error(msg);
  logStream.write(msg);
}

process.on("unhandledRejection", (err) => logError(err, "UNHANDLED_REJECTION"));
process.on("uncaughtException", (err) => logError(err, "UNCAUGHT_EXCEPTION"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(session({
  secret: 'synapse-ai-secure-secret-token',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // false for localhost
}));

const WebSocket = require('ws');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

const PORT = 5000;

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);


app.get("/", (req, res) => {
  res.send("SynapseAI backend running 🚀");
});


/* ---------------- GOOGLE LOGIN ---------------- */

app.get("/auth/google", (req, res) => {
  const { hint } = req.query;
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent select_account",
    login_hint: hint || undefined,
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile"
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

    const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
    const userInfo = await oauth2.userinfo.get();
    
    // Upsert into Supabase uniquely
    let { data: user, error: selectErr } = await supabase.from('users').select('*').eq('email', userInfo.data.email).single();
    if (selectErr && selectErr.code !== 'PGRST116') console.log("Select Error:", selectErr);
    
    if (!user) {
      const result = await supabase.from('users').insert({
        email: userInfo.data.email,
        name: userInfo.data.name,
        google_refresh_token: tokens.refresh_token || null
      }).select().single();
      
      logError(result, "SUPABASE_INSERT_FULL_RESULT");
      if (result.error) logError(result.error, "SUPABASE_INSERT_ERROR");
      user = result.data;
    } else if (tokens.refresh_token) {
      const { error: updateErr } = await supabase.from('users').update({ google_refresh_token: tokens.refresh_token }).eq('id', user.id);
      if (updateErr) logError(updateErr, "SUPABASE_UPDATE_ERROR");
    }

    if (!user) {
      logError({ attemptedEmail: userInfo.data.email }, "USER_STILL_NULL");
      throw new Error(`Failed to create user in database: ${JSON.stringify(userInfo.data.email)}`);
    }

    console.log("✅ User connected:", user.email);

    // Save session payload identifying the user and token
    req.session.userId = user.id;
    req.session.accessToken = tokens.access_token;
    req.session.email = user.email;

    res.send(`
      <h2>Gmail connected successfully to Supabase ✅</h2>
      <p>Now open:</p>
      <a href="http://localhost:5173">http://localhost:5173</a>
    `);

  } catch (error) {
    logError(error, "OAUTH_CALLBACK_ERROR");
    console.error("OAuth Error:", error);
    res.send("Error connecting Gmail");
  }
});


/* ---------------- SESSION & PROFILE ---------------- */

app.get("/api/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  
  const { data: user } = await supabase.from('users').select('name, email').eq('id', req.session.userId).single();
  if (!user) return res.status(401).json({ error: "User not found" });
  
  res.json({ name: user.name, email: user.email });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('connect.sid');
    res.json({ success: true, message: "Logged out" });
  });
});

app.get("/api/stats", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  
  const { count, error } = await supabase
    .from('email_embeddings')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.session.userId);
    
  if (error) console.error("Error fetching stats:", error);
  res.json({ vectorCount: count || 0 });
});

app.post("/api/clear-vectors", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  
  const { error } = await supabase
    .from('email_embeddings')
    .delete()
    .eq('user_id', req.session.userId);
    
  if (error) return res.status(500).json({ error: "Failed to clear data" });
  res.json({ success: true, message: "AI Context Memory wiped." });
});

/* ---------------- FETCH EMAILS ---------------- */

app.get("/emails", async (req, res) => {
  try {
    if (!req.session.userId || !req.session.accessToken) {
      return res.status(401).json({ error: "Login first at /auth/google" });
    }

    const { data: user } = await supabase.from('users').select('*').eq('id', req.session.userId).single();
    if (!user) return res.status(401).json({ error: "User not found" });

    const client = new google.auth.OAuth2(process.env.CLIENT_ID, process.env.CLIENT_SECRET, process.env.REDIRECT_URI);
    client.setCredentials({ access_token: req.session.accessToken, refresh_token: user.google_refresh_token });

    const gmailClient = google.gmail({ version: "v1", auth: client });

    let allMessages = [];
    let nextPageToken = null;

    // Fetch up to 50 emails
    while (allMessages.length < 50) {

      const list = await gmailClient.users.messages.list({
        userId: "me",
        maxResults: 100,
        pageToken: nextPageToken,
        q: "-category:social -from:quora.com -from:pinterest.com" // Removed -category:promotions as platforms like Superset are often flagged as such
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
    console.log(`📥 Received ${emails?.length || 0} emails for analysis from frontend.`);
    if (!emails || !emails.length) return res.json([]);
    const chunkSize = 5;
    const allTasks = [];

    const llm = getLLM({ temperature: 0 });

    const Schema = z.object({
      tasks: z.array(z.object({
        title: z.string().describe("Concise task description."),
        from: z.string().describe("Sender name."),
        priority: z.enum(["HIGH", "MEDIUM", "LOW"]).describe("Urgency.")
      }))
    });

    const llmWithStructuredOutput = llm.withStructuredOutput(Schema);
    const currentDate = new Date().toDateString();

    for (let i = 0; i < emails.length; i += chunkSize) {
      const chunk = emails.slice(i, i + chunkSize);
      const emailsText = chunk.map(e => `From: ${e.from}\nSub: ${e.subject}\nBody: ${e.preview}\n`).join("--\n");

      const prompt = `Extract tasks from these emails. Today is ${currentDate}.

STRICT PRIORITY RULES:
1. HIGH PRIORITY: 
   - ANY job opening or application deadline approaching in the near future.
   - ANY assignment, project, or task due in the near future.
   - Explicit "deadline", "submit by", or "urgent" requests.
2. MEDIUM PRIORITY: 
   - Lists of "selected students", "results", or "invitations" to events/webinars.
   - General informational updates that imply a future action.
3. LOW PRIORITY: 
   - Everything else that is actionable but has no clear timeline.

Include the company/sender name in the task title.

OUTPUT FORMAT:
You MUST output ONLY a valid JSON object using strictly this structure:
{
  "tasks": [
    {
      "title": "Concise task description",
      "from": "Sender name",
      "priority": "HIGH" | "MEDIUM" | "LOW"
    }
  ]
}

Emails:
${emailsText}`;

      try {
        console.log(`🧠 Analyzing batch ${i/chunkSize + 1}...`);
        const response = await llmWithStructuredOutput.invoke(prompt);
        logError(response, `OLLAMA_RAW_RESPONSE_BATCH_${i/chunkSize + 1}`);
        if (response && response.tasks) {
          allTasks.push(...response.tasks);
        }
      } catch (chunkErr) {
        logError(chunkErr, `OLLAMA_CHUNK_ERROR_BATCH_${i/chunkSize + 1}`);
        console.error(`Error in batch ${i/chunkSize + 1}:`, chunkErr.message);
      }
    }

    res.json(allTasks);

  } catch (err) {
    console.error("AI Analysis error:", err);
    res.status(500).json({ error: "Failed to analyze emails" });
  }
});

/* ---------------- AI: DETECT PHISHING ---------------- */
app.post("/api/detect-phishing", async (req, res) => {
  try {
    const { email, deepScan } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });

    const llm = getLLM({ temperature: 0 });

    const Schema = z.object({
      riskLevel: z.enum(["SAFE", "MEDIUM", "HIGH"]).describe("The estimated phishing risk level of the email."),
      reasons: z.array(z.string()).describe("List of warnings or reasons for the risk level. Empty if completely safe.")
    });

    const llmWithStructuredOutput = llm.withStructuredOutput(Schema);
    const emailText = `From: ${email.from}\nSubject: ${email.subject}\nBody: ${email.preview}`;
    const prompt = deepScan 
      ? `HYPER-STRICT SECURITY AUDIT: Analyze this email with extreme paranoia.
         Look for subtle social engineering, inconsistent sender names, weird link patterns, or authoritative pressure.
         Be extremely critical.
         
OUTPUT FORMAT:
You MUST output ONLY a valid JSON object using strictly this structure:
{
  "riskLevel": "high" | "medium" | "safe",
  "reasons": ["warning 1", "warning 2"]
}

         Email:
         ${emailText}`
      : `Analyze this email for phishing, scam, or security risks. Be paranoid but accurate.

OUTPUT FORMAT:
You MUST output ONLY a valid JSON object using strictly this structure:
{
  "riskLevel": "HIGH" | "MEDIUM" | "SAFE",
  "reasons": ["warning 1", "warning 2"]
}

         Email:
         ${emailText}`;

    const response = await llmWithStructuredOutput.invoke(prompt);
    res.json(response);

  } catch (err) {
    console.error("Phishing detection error:", err);
    res.status(500).json({ error: "Failed to detect phishing" });
  }
});


/* ---------------- AI: RAG EMAIL SEARCH ---------------- */
/**
 * HOW THIS ENDPOINT WORKS (the full RAG pipeline):
 * 
 * 1. RECEIVE: User's question + their emails from frontend
 * 2. EMBED:   Convert each email into a vector (array of numbers)
 * 3. SEARCH:  Find the 5 most similar emails to the question
 * 4. GENERATE: Send those 5 emails + the question to Groq LLM
 * 5. RESPOND:  Return the AI's answer + which emails it used
 */
app.post("/api/rag-search", async (req, res) => {
  try {
    const { query, emails: localEmails } = req.body;
    if (!query || !query.trim()) return res.status(400).json({ error: "Please enter a search query" });

    if (!req.session.userId || !req.session.accessToken) {
      return res.status(401).json({ error: "Unauthorized. Please log in again." });
    }

    // STEP 1: HYBRID SEARCH - Query Gmail Directly for Keywords
    console.log(`🔍 HYBRID SEARCH: Querying Gmail API for "${query}"...`);
    oauth2Client.setCredentials({ access_token: req.session.accessToken });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    
    const searchRes = await gmail.users.messages.list({
      userId: "me",
      q: `${query} OR "deadline" OR "due" OR "assignment" OR "action required"`,
      maxResults: 5
    });

    const searchEmails = [];
    if (searchRes.data.messages) {
      const msgPromises = searchRes.data.messages.map(async (msg) => {
        try {
          const fullMsg = await gmail.users.messages.get({ userId: "me", id: msg.id });
          const payload = fullMsg.data.payload;
          const headers = payload.headers;
          const subject = headers.find(h => h.name === "Subject")?.value || "No Subject";
          const from = headers.find(h => h.name === "From")?.value || "Unknown";
          
          let emailBody = "";
          const parts = payload.parts || [payload];
          for (const part of parts) {
            if (part.mimeType === "text/plain" && part.body?.data) {
              emailBody = Buffer.from(part.body.data, 'base64').toString();
              break;
            } else if (part.parts) {
               const subPart = part.parts.find(p => p.mimeType === "text/plain" && p.body?.data);
               if (subPart) emailBody = Buffer.from(subPart.body.data, 'base64').toString();
            }
          }
          if (!emailBody) emailBody = fullMsg.data.snippet; 
          
          return { id: msg.id, subject, from, preview: emailBody };
        } catch (msgErr) {
          console.error(`Error fetching full email ${msg.id}:`, msgErr);
          return null;
        }
      });

      const fetchedResults = await Promise.all(msgPromises);
      searchEmails.push(...fetchedResults.filter(r => r !== null));
    }

    const combinedEmails = [...(localEmails || []), ...searchEmails];
    console.log(`📡 TOTAL CANDIDATES FOR ANALYSIS: ${combinedEmails.length}`);
    const uniqueEmails = Array.from(new Map(combinedEmails.map(e => [e.id, e])).values());

    // STEP 2: Embed any new emails
    const { data: existingRows } = await supabase
      .from('email_embeddings')
      .select('email_id')
      .eq('user_id', req.session.userId)
      .in('email_id', uniqueEmails.map(e => e.id));
      
    const existingIds = new Set((existingRows || []).map(r => r.email_id));
    const missingEmails = uniqueEmails.filter(e => !existingIds.has(e.id));

    if (missingEmails.length > 0) {
      console.log(`🧠 Embedding ${missingEmails.length} new/searched emails...`);
      const missingTexts = missingEmails.map(e => `From: ${e.from}\nSubject: ${e.subject}\nBody: ${e.preview}`);
      const missingVectors = await embedTexts(missingTexts);
      
      const insertPayload = missingEmails.map((e, i) => ({
        user_id: req.session.userId,
        email_id: e.id,
        subject: e.subject,
        sender: e.from,
        content: `From: ${e.from}\nSubject: ${e.subject}\nBody: ${e.preview}`,
        embedding: missingVectors[i]
      }));
      
      const { error: insertError } = await supabase.from('email_embeddings').insert(insertPayload);
      if (insertError) console.error("Error inserting vectors:", insertError);
    }

    // STEP 3: Vector Search with reasonable depth (Top 20)
    const [queryVector] = await embedTexts([query]);
    const { data: results, error: searchError } = await supabase.rpc('match_emails', {
      query_embedding: queryVector,
      match_count: 10, // Optimized for Groq Free Tier (prevents 400/Rate Limit errors)
      filter_user_id: req.session.userId
    });

    if (searchError) throw searchError;

    const relevantResults = (results || []).filter(r => r.similarity > 0.01); // Lowered threshold to trust the ranking
    if (relevantResults.length === 0) {
      return res.json({
        answer: "I couldn't find any relevant emails for that query. Try using different keywords like 'assignment' or the specific subject name.",
        sources: []
      });
    }

    // STEP 4: Helpful Assistant Reasoning
    const llm = getLLM({ temperature: 0.4 });

    const Schema = z.object({
      answer: z.string().describe("A HIGHLY DETAILED, conversational, and friendly response. Do NOT just give a summary; talk to the user about their emails, describe the contents, next steps, and deadlines naturally in 3-5 paragraphs if needed."),
      sources: z.array(z.object({
        subject: z.string().describe("Source email subject."),
        from: z.string().describe("Source email sender.")
      })).describe("The emails you used to find this info.")
    });

    const llmWithStructuredOutput = llm.withStructuredOutput(Schema);
    const context = relevantResults.map((r, i) => `Email ${i + 1}:\n${r.content}`).join("\n---\n");
    const currentDate = new Date().toDateString();

    const prompt = `You are Synapse Assistant, a friendly and expert personal inbox AI. 
Today's date is: ${currentDate}.

Your Goal: Provide a DEEP and CONVERSATIONAL "chatbot-style" response to the user's question using their emails.

RULES FOR THE 'ANSWER' FIELD:
1. RESPECT INTENT: If the user asks for "APPROACHING" or "UPCOMING" deadlines, ONLY include items whose dates are in the future relative to ${currentDate}. Do NOT mention old deadlines unless they are still highly relevant.
2. HISTORICAL CONTEXT: If they ask for "PASSED" or "MISSED" items, only show old ones.
3. TALK LIKE A HUMAN: Respond naturally (e.g., "I found 3 tasks coming up for you...").
4. ITEMIZE & SUMMARIZE: Use bullet points for specific deadlines and provide a brief context for each.
5. SENDER INFO: Always mention who sent the email.

Emails Retrieved:
${context}

User's Question: ${query}`;

    const response = await llmWithStructuredOutput.invoke(prompt);
    res.json(response);

  } catch (err) {
    logError(err, "RAG_SEARCH_CRITICAL");
    res.status(500).json({ error: "Mental exhaustion? Just kidding—I hit a temporary snag reading your emails. Try again in 5 seconds!" });
  }
});

// GLOBAL FINAL ERROR HANDLER
app.use((err, req, res, next) => {
  logError(err, "EXPRESS_GLOBAL");
  res.status(500).json({ error: "Internal Server Snag. Check server.log for details." });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`🚀 Synapse AI Backend is LIVE on Port ${PORT}`);
  console.log(`📝 Diagnostic logs: ${path.join(__dirname, "server.log")}`);
  console.log(`========================================\n`);
});