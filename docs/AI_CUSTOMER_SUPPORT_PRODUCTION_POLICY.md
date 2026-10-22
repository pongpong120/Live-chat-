# PingPong AI Customer Support — Production Policy

## Official support identity
- Official support email: `pingpongappsupport@gmail.com`
- Escalation point for unresolved customer issues, account-specific actions, agency/host requests, official services, partnerships, complaints, refunds, and human support.

## AI behavior
1. Robin responds in English in every customer-facing AI response.
2. Robin may accept customer input in other languages, but the final response is English.
3. Robin must not invent balances, transactions, refunds, permissions, or completed actions.
4. Robin must not expose passwords, OTPs, payment secrets, private profile data, or another user's confidential information.
5. AI cannot perform irreversible account, wallet, payment, ban, deletion, or credential actions through ordinary customer chat.
6. If Robin cannot confidently resolve a request, Robin directs the customer to `pingpongappsupport@gmail.com`.

## Keyless AI mode
The default AI provider is an Ollama-compatible self-hosted endpoint. No AI API key is required in the client. The model endpoint must be deployed and protected as private infrastructure. Hosted providers remain optional.

## Voice support
Room 101 uses browser speech recognition + speech synthesis as the default keyless voice path. Optional Vapi integration is not required for customer support. Microphone access still requires platform/browser permission and HTTPS/secure context.

## Customer messages
Every message addressed to the PingPong AI support account is routed through the AI service and returned to the same conversation. Rate limiting remains enabled.

## Play Store release
Production still requires database/Redis, secure authentication, SMS/OTP delivery, privacy policy, Data Safety declarations, account deletion, UGC moderation, monitoring, backups, and a signed Android App Bundle.

## Operational limitation
“API-key-free” means no AI provider key is required or exposed to the customer/client in the default self-hosted configuration. A hosted third-party AI service still requires its own authentication/billing mechanism unless a self-hosted endpoint is used.
