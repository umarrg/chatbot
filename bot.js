const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
require('dotenv').config();

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Environment variables validation
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!TELEGRAM_TOKEN || !OPENAI_API_KEY) {
    console.error('Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

// Store user conversations (in production, use a database)
const userConversations = new Map();

// Helper function to get or create user conversation history
function getUserConversation(userId) {
    if (!userConversations.has(userId)) {
        userConversations.set(userId, [
            {
                role: 'system',
                content: 'You are a helpful AI assistant integrated into a Telegram bot. Be concise but informative in your responses.'
            }
        ]);
    }
    return userConversations.get(userId);
}

// Helper function to limit conversation history
function limitConversationHistory(conversation, maxMessages = 20) {
    if (conversation.length > maxMessages) {
        // Keep system message and last maxMessages-1 messages
        const systemMessage = conversation[0];
        const recentMessages = conversation.slice(-(maxMessages - 1));
        return [systemMessage, ...recentMessages];
    }
    return conversation;
}

// Helper function to process AI request
async function processAIRequest(chatId, userId, userMessage) {
    try {
        // Send typing indicator
        bot.sendChatAction(chatId, 'typing');

        // Get user's conversation history
        const conversation = getUserConversation(userId);

        // Add user message to conversation
        conversation.push({
            role: 'user',
            content: userMessage
        });

        // Limit conversation history to prevent token overflow
        const limitedConversation = limitConversationHistory(conversation);

        // Call OpenAI API
        const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: limitedConversation,
            max_tokens: 1000,
            temperature: 0.7,
        });

        const aiResponse = response.choices[0].message.content;

        // Add AI response to conversation history
        conversation.push({
            role: 'assistant',
            content: aiResponse
        });

        // Update user's conversation
        userConversations.set(userId, limitConversationHistory(conversation));

        // Send response to user
        bot.sendMessage(chatId, aiResponse);

    } catch (error) {
        console.error('Error processing message:', error);

        let errorMessage = '❌ Sorry, I encountered an error while processing your message.';

        if (error.response?.status === 401) {
            errorMessage = '❌ Authentication error. Please check the OpenAI API key.';
        } else if (error.response?.status === 429) {
            errorMessage = '❌ Rate limit exceeded. Please try again in a moment.';
        } else if (error.response?.status === 500) {
            errorMessage = '❌ OpenAI service temporarily unavailable. Please try again later.';
        }

        bot.sendMessage(chatId, errorMessage);
    }
}

// Telegram bot event handlers
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
🤖 Welcome to the Memecoin Chat Bot

I'm ready to help you with:
•⁠  ⁠Answering questions
•⁠  ⁠Writing assistance
•⁠  ⁠Problem solving
•⁠  ⁠General conversation
•⁠  ⁠And much more!

Just send me any message and I'll respond using AI.

Commands:
/start - Show this welcome message
/ask question - Ask a specific question to AI
/clear - Clear our conversation history
/help - Show help information
    `;

    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/ask (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const question = match[1]; // Extract the question after /ask

    if (!question || question.trim() === '') {
        bot.sendMessage(chatId, '❓ Please provide a question after the /ask command.\n\nExample: `/ask What is the capital of France?`', { parse_mode: 'Markdown' });
        return;
    }

    // Process the AI request
    await processAIRequest(chatId, userId, question.trim());
});

bot.onText(/\/ask$/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
❓ *How to use the /ask command:*

Format: \`/ask [your question]\`

*Examples:*
• \`/ask What is the weather like?\`
• \`/ask How do I learn JavaScript?\`
• \`/ask Write a short poem about cats\`
• \`/ask Explain quantum physics simply\`

Just type your question after the /ask command and I'll respond using AI!
    `;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/clear/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    userConversations.delete(userId);

    bot.sendMessage(chatId, '🗑️ Conversation history cleared! Starting fresh.');
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
ℹ️ *How to use this bot:*

1. Simply send any message and I'll respond using ChatGPT
2. Use \`/ask [question]\` for specific questions
3. I remember our conversation context
4. Use /clear to start a new conversation
5. I can help with various tasks like writing, coding, math, etc.

*Tips:*
• Be specific in your questions for better responses
• I work best with clear, well-structured queries
• Feel free to ask follow-up questions

*Commands:*
/start - Welcome message
/ask [question] - Ask a specific question
/clear - Clear conversation history  
/help - This help message
    `;

    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Handle all text messages (excluding commands)
bot.on('message', async (msg) => {
    // Skip if message is a command
    if (msg.text && msg.text.startsWith('/')) {
        return;
    }

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userMessage = msg.text;

    // Skip if no text content
    if (!userMessage) {
        return;
    }

    // Process the AI request
    // await processAIRequest(chatId, userId, userMessage);
});

// Handle bot errors
bot.on('error', (error) => {
    console.error('Telegram Bot Error:', error);
});

// Handle polling errors
bot.on('polling_error', (error) => {
    console.error('Polling Error:', error);
});

// Express routes
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        message: 'Telegram ChatGPT Bot Server',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

app.get('/stats', (req, res) => {
    res.json({
        activeConversations: userConversations.size,
        timestamp: new Date().toISOString()
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Express Error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🤖 Telegram bot is active and polling for messages`);
    console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});