import OpenAI from 'openai';

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const openai = new OpenAI({
    apiKey: NVIDIA_API_KEY || 'dummy-key',
    baseURL: 'https://integrate.api.nvidia.com/v1',
});

export const callNvidiaModel = async (
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
    maxTokens: number = 1024
): Promise<string | null> => {
    if (!NVIDIA_API_KEY) {
        console.warn('[NVIDIA AI] NVIDIA_API_KEY is not defined. Skipping AI completions.');
        return null;
    }

    try {
        const completion = await openai.chat.completions.create({
            model: 'meta/llama-3.3-70b-instruct',
            messages: messages as any,
            temperature: 0.2,
            top_p: 0.7,
            max_tokens: maxTokens,
            stream: false
        });
        return completion.choices[0]?.message?.content || null;
    } catch (err: any) {
        console.error('[NVIDIA AI] API Error:', err.message);
        return null;
    }
};

/**
 * Detects intent, spam, and sentiment of a message.
 * Returns a JSON output with: { intent: string, spam: boolean, sentiment: string }
 */
export const detectSpamAndIntent = async (text: string): Promise<{ intent: string; spam: boolean; sentiment: string } | null> => {
    const prompt = `Analyze the following customer chat message and extract:
1. Intent: Categorize the intent strictly as one of: "sales", "support", "billing", or "other".
2. Spam: Detect if the message is spam (advertising, malicious, gibberish) and output true or false.
3. Sentiment: Categorize the sentiment strictly as one of: "positive", "negative", or "neutral".

You MUST output ONLY a valid JSON object matching this schema:
{
  "intent": "sales" | "support" | "billing" | "other",
  "spam": boolean,
  "sentiment": "positive" | "negative" | "neutral"
}

Do NOT include any markdown formatting, backticks, or extra text. Output ONLY the raw JSON string.

Message: "${text}"`;

    try {
        const result = await callNvidiaModel([{ role: 'user', content: prompt }], 128);
        if (!result) return null;
        
        // Clean markdown code blocks if any got returned despite the prompt
        const cleaned = result.trim().replace(/^```json/, '').replace(/```$/, '').trim();
        return JSON.parse(cleaned);
    } catch (err) {
        console.error('[NVIDIA AI] detectSpamAndIntent parsing failed:', err);
        return null;
    }
};

/**
 * Translates a message into a target language.
 */
export const translateMessage = async (text: string, targetLanguage: string): Promise<string | null> => {
    const prompt = `You are a professional real-time chat translator. Translate the following text into ${targetLanguage}.
Output ONLY the translated text. Do NOT add notes, explanations, or quotes.

Text: "${text}"`;

    try {
        const result = await callNvidiaModel([{ role: 'user', content: prompt }], 512);
        return result ? result.trim() : null;
    } catch (err) {
        console.error('[NVIDIA AI] translateMessage failed:', err);
        return null;
    }
};

/**
 * Automatically detects the language of a text and returns it.
 */
export const detectLanguage = async (text: string): Promise<string | null> => {
    const prompt = `Detect the language of the following text. Respond with ONLY the name of the language (e.g. "English", "Spanish", "Hindi", "French"). Do NOT add punctuation or extra words.

Text: "${text}"`;

    try {
        const result = await callNvidiaModel([{ role: 'user', content: prompt }], 32);
        return result ? result.trim() : null;
    } catch (err) {
        console.error('[NVIDIA AI] detectLanguage failed:', err);
        return null;
    }
};

/**
 * Generates an AI suggested reply based on the recent messages in a conversation.
 */
export const suggestReply = async (messagesContext: { role: 'user' | 'assistant' | 'system'; content: string }[]): Promise<string | null> => {
    const prompt = `You are an AI customer support assistant. Based on the chat history between the agent and customer below, suggest a helpful, concise, and professional reply for the agent to send.
Keep it to 1-2 sentences. Output ONLY the suggested response text. Do not add quotes, explanations, or preambles.

Chat History:
${messagesContext.map(m => `${m.role === 'assistant' ? 'Agent' : 'Customer'}: ${m.content}`).join('\n')}

Suggested Reply:`;

    try {
        const result = await callNvidiaModel([{ role: 'user', content: prompt }], 256);
        return result ? result.trim() : null;
    } catch (err) {
        console.error('[NVIDIA AI] suggestReply failed:', err);
        return null;
    }
};

/**
 * Generates a one-sentence summary of the conversation.
 */
export const summarizeChat = async (messagesContext: { role: 'user' | 'assistant' | 'system'; content: string }[]): Promise<string | null> => {
    const prompt = `Based on the chat history between support agent and customer below, summarize the core issue and status in exactly one short sentence (max 15 words).
Output ONLY the summary string.

Chat History:
${messagesContext.map(m => `${m.role === 'assistant' ? 'Agent' : 'Customer'}: ${m.content}`).join('\n')}

Summary:`;

    try {
        const result = await callNvidiaModel([{ role: 'user', content: prompt }], 64);
        return result ? result.trim() : null;
    } catch (err) {
        console.error('[NVIDIA AI] summarizeChat failed:', err);
        return null;
    }
};
