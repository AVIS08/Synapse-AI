const { getLLM } = require("./llm");
const { z } = require("zod");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

async function testExtraction() {
  console.log("DEBUG: Initializing Local LLM (Ollama)...");
  const llm = getLLM({ temperature: 0 });

  const Schema = z.object({
    tasks: z.array(z.object({
      title: z.string().describe("Task description extracted from the email."),
      from: z.string().describe("The sender of the email."),
      priority: z.enum(["HIGH", "MEDIUM", "LOW"]).describe("Urgency level based on content.")
    }))
  });

  const llmWithStructuredOutput = llm.withStructuredOutput(Schema);
  
  // MOCK DATA: Job opening with deadline tomorrow
  const currentDate = new Date().toDateString();
  const mockEmails = [
    {
      from: "recruiter@dreamjob.com",
      subject: "Action Required: Software Engineer Position",
      preview: "We loved your profile! We have a job opening for a Software Engineer. The deadline to submit the application form is tomorrow. Please apply here: dreamjob.com/apply"
    }
  ];

  const emailsText = mockEmails.map(e => `From: ${e.from}\nSubject: ${e.subject}\nBody: ${e.preview}\n\n`).join("---\n");

  const prompt = `You are a high-granularity task extraction engine. 
Today's date is ${currentDate}.

Your Goal: Scan these emails for ANY actionable items, assignments, job opportunities, or deadlines.

CRITICAL INSTRUCTIONS:
1. DEADLINES: If an email mentions a "deadline", "due date", "submit by", or "last date", extract it as a HIGH PRIORITY task.
2. OPPORTUNITIES: Identify "Job Openings", "Application Forms", or "Registration Links" as tasks.
3. TEMPORAL CONTEXT: If a task is due tomorrow (relative to ${currentDate}), it MUST be HIGH PRIORITY.
4. ITEMIZE: Be specific in the task title (e.g., "Submit Job Application for [Company]").
5. DE-DUPLICATE: Combine similar tasks from the same sender into one actionable item.

Emails:
${emailsText}`;

  console.log("🧠 Testing extraction with mock data...");
  console.log("---------------------------------------");
  console.log(`Mock Email: ${mockEmails[0].subject}`);
  console.log(`Content: ${mockEmails[0].preview}`);
  console.log("---------------------------------------");

  try {
    const response = await llmWithStructuredOutput.invoke(prompt);
    console.log("✅ Extraction Results:");
    console.log(JSON.stringify(response, null, 2));
    
    const task = response.tasks[0];
    if (task && task.priority === "HIGH") {
      console.log("\n✨ SUCCESS: High priority task correctly identified!");
    } else {
      console.log("\n❌ FAILURE: Extraction did not meet expectations.");
    }
  } catch (err) {
    console.error("Test error:", err);
  }
}

testExtraction();
