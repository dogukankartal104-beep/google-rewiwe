# Shopier Setup Guide

1. Log in to your Shopier Merchant Dashboard.
2. Go to Developer Settings (API credentials).
3. Set your Webhook URL to: `https://your-domain.com/api/webhook/shopier`
4. Copy your API Key and API Secret.
5. Add these secrets to your backend environment variables (e.g. `SHOPIER_API_KEY`, `SHOPIER_API_SECRET`).
6. Our webhook endpoint in `server.ts` handles POST requests from Shopier. Implement signature verification within the webhook endpoint using your API Secret.
