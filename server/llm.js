/**
 * llm.js — Centralized Local LLM Factory (Ollama)
 * 
 * Bypassing LangChain entirely to avoid NPM dependency hell. 
 * This natively wraps Ollama's HTTP API while maintaining the 
 * exact 'withStructuredOutput().invoke()' method signatures expected by server.js.
 */

function getLLM({ temperature = 0 } = {}) {
  const modelStr = "llama3.2:1b";
  console.log(`🤖 LLM Factory: FORCING model [${modelStr}] (RAM-optimized)`);
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

  return {
    withStructuredOutput: (schema) => ({
      invoke: async (prompt) => {
        // We append instructions to force valid JSON since we bypassed LangChain's prompt injection
        const fullPrompt = prompt + "\n\n--- IMPORTANT: You must output ONLY valid JSON. Do not include markdown blocks like ```json. Do not include conversational text. Provide ONLY the raw JSON object.";
        
        try {
          const response = await fetch(`${baseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: modelStr,
              prompt: fullPrompt,
              format: "json",
              stream: false,
              options: { temperature }
            })
          });

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Ollama API error (${response.status}): ${errBody || response.statusText}`);
          }

          const data = await response.json();
          let jsonStr = data.response.trim();
          
          // Cleanup markdown if the model hallucinated it anyway
          if (jsonStr.startsWith("```json")) {
            jsonStr = jsonStr.replace(/^```json/, "").replace(/```$/, "").trim();
          }

          console.log("Ollama Raw Response:", jsonStr);
          return JSON.parse(jsonStr);
        } catch (error) {
          console.error("Local LLM Invocation Error:", error);
          throw error;
        }
      }
    })
  };
}

module.exports = { getLLM };
