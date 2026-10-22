// ai/ai-chat.js
// Owns the "PingPong Help" support account: per-user session memory (in
// memory only, resets on server restart — this is intentionally NOT a
// permanent chat log), the system prompt, and the first-open welcome message.
const config = require("./ai-config");
const { SUPPORT_EMAIL } = require("../support-config");
const logger = require("./ai-logger");
const analytics = require("./ai-analytics");
const aiService = require("./ai-service");

const sessions = new Map(); // userId -> [{role:"user"|"assistant", content}]

const SYSTEM_PROMPT = `You are Robin, the official PingPong AI Customer Service agent.

Production rules:
- ALWAYS respond in clear, professional English, regardless of the language used by the customer.
- Handle Account, Login, OTP, Password, Wallet, Coins, Diamonds, Recharge, Withdrawal, VIP, Frames, Levels, Rooms, Voice Chat, PK Battle, Gifts, Events, Reports, Community Guidelines, agency/host services, official services, and technical issues.
- Never invent balances, transactions, refunds, permissions, user records, or completed actions.
- Never expose passwords, OTPs, payment secrets, private data, or another user's confidential information.
- Never change wallet balances, transfer currency, delete accounts, or perform bans/unbans through chat.
- If you cannot confidently resolve the request, do not guess. Tell the customer to email ${SUPPORT_EMAIL}.
- For agency, host, official service, partnership, business, complaint, refund, account-specific, or unresolved requests, direct the customer to ${SUPPORT_EMAIL}.
- Keep replies short, actionable, and customer-friendly.`;

function welcomeMessage() {
    return `Hello! I'm Robin, PingPong's official AI Customer Service agent. I can help with accounts, voice chat, rooms, wallet, gifts, recharge, reports, technical issues, agency/official services, and general app support. If I cannot resolve something, email ${SUPPORT_EMAIL}. How can I help you today?`;
}

function isFirstOpen(userId) {
    return !sessions.has(userId);
}

async function reply(userId, userMessage) {
    if (!sessions.has(userId)) {
        sessions.set(userId, []);
        analytics.increment("totalAiConversations");
    }
    const history = sessions.get(userId);
    history.push({ role: "user", content: userMessage });
    while (history.length > config.MAX_HISTORY_TURNS * 2) history.shift();

    let text;
    try {
        text = await aiService.generateReply(history, SYSTEM_PROMPT);
        analytics.increment("totalAiReplies");
    } catch (err) {
        logger.log({ module: "ai-chat", action: "reply", result: "error", userId, error: err.message });
        text = `I'm temporarily unable to complete this request. Please email ${SUPPORT_EMAIL} for official PingPong support.`;
    }
    history.push({ role: "assistant", content: text });
    return text;
}

module.exports = {
    reply,
    welcomeMessage,
    isFirstOpen,
    AI_USER_ID: config.AI_USER_ID,
    AI_NAME: config.AI_NAME,
};
