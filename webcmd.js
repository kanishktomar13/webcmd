import { exec } from 'child_process';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import util from 'util';
import { fileURLToPath } from 'url';
import readline from 'readline';

dotenv.config();

const execAsync = util.promisify(exec);
const MEMORY_FILE = './memory.json';

function parseJsonSafely(rawText, fallback = {}) {
    if (!rawText) return fallback;

    try {
        return JSON.parse(rawText);
    } catch {
        const trimmed = String(rawText).trim();
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');

        if (start !== -1 && end !== -1 && end > start) {
            try {
                return JSON.parse(trimmed.slice(start, end + 1));
            } catch {
                return fallback;
            }
        }
        return fallback;
    }
}

function isAuthFailure(error) {
    return error?.status === 401 || error?.code === 'invalid_api_key' || /invalid token|unauthorized|authentication/i.test(error?.message || '');
}

async function createOpenAIClient() {
    const apiKey = process.env.LLAMA4_API_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return null;
    }

    try {
        const { default: OpenAI } = await import('openai');
        // Defaulting to the standard environment variable but allowing a fallback if missing
        return new OpenAI({
            apiKey,
            baseURL: process.env.OPENAI_BASE_URL || "https://api.cometapi.com/v1"
        });
    } catch (error) {
        console.warn('OpenAI SDK not available; continuing in offline mode.', error.message);
        return null;
    }
}

async function loadMemory() {
    try {
        const data = await fs.readFile(MEMORY_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        return Array.isArray(parsed?.learnings) ? parsed.learnings : [];
    } catch {
        return [];
    }
}

async function saveMemory(newLearning) {
    const memory = await loadMemory();
    if (newLearning && !memory.includes(newLearning)) {
        memory.push(newLearning);
        await fs.writeFile(MEMORY_FILE, JSON.stringify({ learnings: memory }, null, 2));
        console.log(`\n🧠 [Saved to Memory]: ${newLearning}`);
    }
}

function cleanHtmlText(input = '') {
    return String(input)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchDuckDuckGoResults(prompt) {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(prompt)}`;
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
        }
    });

    if (!response.ok) {
        throw new Error(`DuckDuckGo request failed with status ${response.status}`);
    }

    const html = await response.text();
    const titleMatches = [...html.matchAll(/class="result__title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/gi)];
    const snippetMatches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/gi)];

    const extracted = [];
    for (let index = 0; index < Math.min(titleMatches.length, snippetMatches.length, 3); index += 1) {
        const title = cleanHtmlText(titleMatches[index][1]);
        const snippet = cleanHtmlText(snippetMatches[index][1]);

        if (title) {
            extracted.push(`${title}${snippet ? ` — ${snippet}` : ''}`);
        }
    }

    if (!extracted.length) {
        return `DuckDuckGo fallback returned no usable results for "${prompt}".`;
    }

    return extracted.join('\n');
}

async function useLiveWeb(prompt) {
    console.log(`\n🌐 [Using Live Web]: ${prompt}`);

    try {
        const { stdout } = await execAsync(`where webcmd`, { timeout: 15000 });
        if (stdout && stdout.trim()) {
            const result = await execAsync(`webcmd run "${prompt}"`);
            return result.stdout || result.stderr || 'No output from webcmd.';
        }
    } catch {
        // webcmd is not installed or is unavailable; continue to fallback.
    }

    try {
        return await fetchDuckDuckGoResults(prompt);
    } catch (error) {
        return `Webcmd unavailable and fallback search failed: ${error.message}`;
    }
}

async function runAgent(userGoal) {
    console.log(`\n🚀 Starting Agent for Goal: "${userGoal}"`);

    const pastLearnings = await loadMemory();
    const openai = await createOpenAIClient();

    let plan = {
        webcmd_prompt: userGoal,
        reasoning: 'No API key is configured, so the agent is using the built-in offline fallback to keep the workflow working.'
    };

    if (openai) {
        const systemPrompt = `
        You are an autonomous browser agent that uses the 'webcmd' tool.
        Past Learnings (Do not repeat these mistakes, use these routes):
        ${pastLearnings.map((learning) => `- ${learning}`).join('\n')}

        Your task is to:
        1. Formulate a specific command to send to webcmd to achieve the user's goal.
        2. Analyze the result from webcmd.

        Respond STRICTLY in JSON format:
        {
          "webcmd_prompt": "The exact natural language instruction to send to webcmd",
          "reasoning": "Why you are doing this based on the goal and memory"
        }`;

        try {
            const planningResponse = await openai.chat.completions.create({
                model: 'llama-4-maverick',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userGoal }
                ],
                response_format: { type: 'json_object' }
            });

            plan = parseJsonSafely(planningResponse.choices?.[0]?.message?.content, plan);
        } catch (error) {
            if (isAuthFailure(error)) {
                console.warn('\n⚠️ LLM authentication failed. Check your API Key and Base URL in the .env file. Falling back to offline mode.');
            } else {
                console.warn('\n⚠️ LLM planning request failed. Falling back to offline mode.', error.message);
            }
            plan = {
                webcmd_prompt: userGoal,
                reasoning: 'The model request failed, so the agent is using the built-in offline fallback to keep the workflow working.'
            };
        }
    }

    console.log(`\n🤖 [Agent Reasoning]: ${plan.reasoning}`);

    const webcmdResult = await useLiveWeb(plan.webcmd_prompt);

    let result = {
        final_answer: `Search result summary for: ${userGoal}\n${webcmdResult}`,
        new_learning: `Use the offline fallback when the webcmd CLI is unavailable for "${userGoal}".`
    };

    if (openai) {
        const extractionPrompt = `
        Based on the user's goal: "${userGoal}"
        And the result from the web browser:
        ---
        ${webcmdResult}
        ---
        1. Summarize the final answer for the user.
        2. Formulate ONE new useful learning (a pitfall, a better path, or routing rule) to save to memory based on this execution.

        Output STRICTLY in JSON format:
        {
          "final_answer": "Summary of data found",
          "new_learning": "Short, actionable learning for the next agent"
        }`;

        try {
            const extractionResponse = await openai.chat.completions.create({
                model: 'llama-4-maverick',
                messages: [{ role: 'user', content: extractionPrompt }],
                response_format: { type: 'json_object' }
            });

            result = parseJsonSafely(extractionResponse.choices?.[0]?.message?.content, result);
        } catch (error) {
            if (isAuthFailure(error)) {
                console.warn('\n⚠️ LLM authentication failed during result extraction. Keeping offline summary.');
            } else {
                console.warn('\n⚠️ Result extraction request failed. Keeping offline summary.', error.message);
            }
        }
    }

    console.log(`\n✅ [Final Answer]:\n${result.final_answer}`);

    if (result.new_learning) {
        await saveMemory(result.new_learning);
    }

    return result;
}

// Ensure the code runs dynamically via terminal
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const args = process.argv.slice(2).join(' ');

    if (args) {
        // Run with command line arguments if provided
        runAgent(args).then(() => process.exit(0));
    } else {
        // Start an interactive terminal prompt if no arguments are provided
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('🔍 Enter your research goal or query for Webcmd: ', (goal) => {
            rl.close();
            if (goal.trim()) {
                runAgent(goal).then(() => process.exit(0));
            } else {
                console.log('No goal provided. Exiting.');
                process.exit(0);
            }
        });
    }
}

export { createOpenAIClient, loadMemory, saveMemory, useLiveWeb, runAgent };