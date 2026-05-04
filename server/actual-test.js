const fetch = require('node-fetch'); // Assuming node-fetch or similar is available, or use global fetch in Node 18+

async function runTest() {
  const currentDate = new Date().toDateString();
  const payload = {
    emails: [
      {
        id: "test-job-123",
        from: "recruiter@dreamjob.com",
        subject: "Action Required: Software Engineer Position",
        preview: "We have a job opening for a Software Engineer. The deadline to submit the application form is tomorrow. Please apply here: dreamjob.com/apply"
      }
    ]
  };

  console.log("🚀 Sending test request to http://localhost:5000/api/analyze-tasks...");
  console.log("Mock Email Content:", payload.emails[0].preview);

  try {
    const res = await fetch('http://localhost:5000/api/analyze-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error("❌ API Error:", res.status, await res.text());
      return;
    }

    const data = await res.json();
    console.log("✅ API Response Received:");
    console.log(JSON.stringify(data, null, 2));

    const task = data[0];
    if (task && task.priority === "HIGH" && task.title.toLowerCase().includes("job")) {
      console.log("\n✨ SUCCESS: Job deadline correctly identified as HIGH priority!");
    } else {
      console.log("\n❌ FAILURE: Task extraction did not meet sensitivity requirements.");
    }
  } catch (err) {
    console.error("❌ Test failed to connect:", err.message);
  }
}

runTest();
