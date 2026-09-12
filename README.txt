AUTONOMOUS WEBCMD AGENT - README
==================================

OVERVIEW
--------
This script implements an autonomous browser agent that takes a user's research goal, executes web searches, interprets the results, and maintains a "memory" of past learnings across sessions. It uses the Groq API (via the OpenAI SDK wrapper) for decision-making and result extraction, and dynamically falls back to an offline DuckDuckGo HTML scraper if the API or the required command-line tool fails.

FUNCTIONALITIES
---------------
1.  **AI-Powered Planning (Groq)**: Uses a Large Language Model (Groq's `openai/gpt-oss-20b` via the OpenAI SDK structure) to read the user's goal and formulate a precise search query.
2.  **Web Execution (`webcmd`)**: Attempts to execute live web searches via a local command-line interface tool called `webcmd`.
3.  **Resilient Fallback Mode**: If `webcmd` is unavailable, not installed, or times out, the script falls back to fetching and scraping raw HTML from DuckDuckGo.
4.  **AI-Powered Extraction**: Parses the raw output from the web or search engine and uses Groq to generate a clean, final summary for the user.
5.  **Persistent Memory**: 
    - Analyzes the workflow to generate a "new learning" (e.g., a pitfall to avoid or a better route to take next time).
    - Saves these learnings locally to `memory.json`.
    - Feeds past learnings back into the initial planning prompt on subsequent runs so the agent improves over time.
6.  **Fault Tolerance**: Handles Missing API keys, failed authentication, and malformed JSON responses from the LLM gracefully, allowing the script to continue in an offline state.

HOW IT WORKS
------------
1.  **Initialization**: The user runs the script via terminal and inputs a search goal. The script attempts to initialize the Groq client and loads `memory.json`.
2.  **Phase 1 - Planning**: The agent checks its memory for past mistakes and asks Groq to create a structured JSON plan (query + reasoning).
3.  **Phase 2 - Execution**: The planned query is sent to `webcmd` (or DuckDuckGo if `webcmd` fails).
4.  **Phase 3 - Extraction**: The raw text results are sent back to Groq. Groq formats the final answer and generates a new learning.
5.  **Finalization**: The summary is printed to the console, and the new learning is saved to `memory.json`.

PREREQUISITES
-------------
- Node.js installed.
- The project must be set up to use ES Modules (e.g., `"type": "module"` in `package.json`).
- Installed npm packages: `openai` and `dotenv`.
- A valid Groq API key (added to a `.env` file as `GROQ_API_KEY`).

USAGE
-----
You can run the script in two ways:

1. Interactive Prompt (Run without arguments):
   > node index.js
   (The console will prompt you: "Enter your research goal or query for Webcmd:")

2. Direct Argument (Pass your query immediately):
   > node index.js "What is the capital of France?"
