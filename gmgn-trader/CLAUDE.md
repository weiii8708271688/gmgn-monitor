# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser-based API wrapper for GMGN.ai that enables automated trading operations on Binance Smart Chain (BSC). The system uses Playwright to maintain persistent browser sessions, bypassing Cloudflare protection by acting as a real browser.

**Type**: Node.js application using ES modules
**Language**: JavaScript
**Key Technology**: Playwright for browser automation

## Common Commands

### Setup and Initialization
```bash
# Install dependencies
npm install

# First-time setup: Launch browser for manual login
node setup-browser-session.js
# This opens a browser window - login to GMGN.ai manually, then press Enter
# Session is saved to .gmgn-session.json (cookies, localStorage, token)

# Test the API
node example-usage.js
```

### Development
```bash
# Run usage example
node example-usage.js

# Run specific tests
node test-price-api.js
node test-all-features-browser.js
node test-price-polling.js
```

## Architecture

### Core Components

**GmgnBrowserAPI** (`gmgn-browser-api.js`)
- Main unified API class for all GMGN.ai operations
- Maintains persistent headless browser session using Playwright
- Executes API calls within browser context to bypass Cloudflare
- Key methods:
  - `init()` - Initialize browser (call once, browser stays open)
  - `getTokenPrice(address)` - Query token price with historical data
  - `getBNBBalance(wallet?)` - Get BNB balance
  - `getTokenBalance(tokenAddress, wallet?)` - Get token balance
  - `getHoldings(tokenAddress, wallet?)` - Get position info (avg cost, P&L)
  - `getMultiTokenPrices(addresses[])` - Batch price query
  - `getTokenInfo(address)` - Token statistics
  - `close()` - Close browser and release resources

**Browser Authentication Flow**
1. `setup-browser-session.js` - Interactive setup script (user runs once)
2. `browser-auth.js` - BrowserAuth class handles browser automation
   - Launches Chromium with anti-detection measures
   - Injects localStorage and cookies from saved session
   - Intercepts network requests to capture authorization tokens
3. `token-manager.js` - TokenManager class manages session persistence
   - Loads/saves session to `.gmgn-session.json`
   - Checks token expiration (JWT exp field)
   - Auto-refreshes tokens using browser when expired
   - Stores: token, cookies, localStorage

**Configuration**
- `gmgn-config.js` - Centralized config with:
  - API base URL and endpoints
  - Device fingerprinting params (device_id, fp_did, client_id)
  - Trade defaults (slippage, expiry, gas settings)
  - Token getter that prioritizes TokenManager over .env

### Session Management

**Initial Setup Flow**:
1. User runs `node setup-browser-session.js`
2. Browser opens (non-headless) to https://gmgn.ai
3. User manually logs in via Telegram
4. Script intercepts authorization headers from API requests
5. Extracts: JWT token, all cookies, localStorage (including tgInfo)
6. Saves everything to `.gmgn-session.json`

**Runtime Flow**:
1. API loads session from `.gmgn-session.json`
2. Launches headless browser with saved cookies/localStorage
3. All API calls execute via `page.evaluate()` with real browser context
4. Token auto-refreshes when expired (uses browser to get new token)

**Why Browser Automation**:
- GMGN.ai uses Cloudflare protection that blocks standard HTTP requests
- Using real Chromium browser bypasses all anti-bot measures
- Persistent session avoids repeated logins
- Browser context ensures all cookies/localStorage are valid

### API Request Pattern

All API methods follow this pattern:
```javascript
// Execute fetch() inside browser context
const result = await this.page.evaluate(
  async ({ endpoint, body }) => {
    // Get token from localStorage (injected during init)
    const tgInfo = JSON.parse(localStorage.getItem('tgInfo'));
    const token = 'Bearer ' + tgInfo.token.access_token;

    // Make request with browser's fetch (has valid session)
    const response = await fetch(endpoint, {
      headers: { 'authorization': token },
      credentials: 'include'
    });
    return await response.json();
  },
  { endpoint, body }
);
```

This executes fetch within the browser page context, ensuring all cookies and session state are valid.

### Anti-Detection Measures

Located in `browser-auth.js` and `gmgn-browser-api.js`:
- Launch args: `--disable-blink-features=AutomationControlled`
- Custom user agent: Chrome 120 on Windows
- Viewport: 1280x720
- Locale/timezone: zh-TW/Asia/Taipei
- Navigator override: `navigator.webdriver = false`
- localStorage injection before page load

## Configuration

### Environment Variables (.env)

**Optional** (most config comes from session file):
```env
GMGN_WALLET_ADDRESS=0xYourWalletAddress  # Default wallet for queries
GMGN_AUTH_TOKEN=jwt_token                # Fallback if session missing
BSC_RPC_URL=https://bsc-dataseed1.binance.org  # For on-chain queries
DEFAULT_SLIPPAGE=40                      # 4% slippage
DEFAULT_EXPIRES_DAYS=3                   # Order expiration
```

**Session File** (`.gmgn-session.json`):
- Auto-generated by `setup-browser-session.js`
- Contains: `token`, `cookies`, `localStorage`, `expiresAt`
- DO NOT commit this file (contains authentication data)

## Important Notes

### Session Management
- **First run**: Must execute `node setup-browser-session.js` before any API usage
- **Session location**: `.gmgn-session.json` in project root
- **Token lifespan**: JWTs typically expire after several hours/days
- **Auto-refresh**: TokenManager automatically refreshes expired tokens using browser
- **Re-authentication**: If auto-refresh fails, re-run `setup-browser-session.js`

### Browser Lifecycle
- Browser is launched once per API instance via `init()`
- Browser stays open until `close()` is called or process exits
- Headless mode for production, visible mode for setup
- Each API call reuses the same browser instance (no overhead)

### API Response Format
All methods return:
```javascript
{
  success: true/false,
  data: { ... },      // on success
  error: "message"    // on failure
}
```

### Testing Files
Multiple `test-*.js` files demonstrate specific features:
- `test-all-features-browser.js` - Complete feature test
- `test-price-api.js` - Price query tests
- `test-price-polling.js` - Continuous price monitoring
- These are NOT formal tests, but usage examples

## Development Guidelines

### Adding New API Methods

1. Add method to `GmgnBrowserAPI` class in `gmgn-browser-api.js`
2. Use `_apiCall()` helper for GET requests
3. Use `page.evaluate()` for POST or complex requests
4. Follow existing pattern:
   ```javascript
   async getNewFeature(param) {
     const endpoint = `https://gmgn.ai/api/v1/new_endpoint`;
     const result = await this._apiCall('GET', endpoint);

     if (result.success && result.data) {
       return { success: true, data: processData(result.data) };
     }
     return { success: false, error: result.error || 'Query failed' };
   }
   ```

### Debugging Browser Issues

1. Launch browser in visible mode:
   ```javascript
   await chromium.launch({ headless: false })
   ```
2. Add delays to observe behavior:
   ```javascript
   await this.page.waitForTimeout(5000);
   ```
3. Check saved session:
   ```bash
   cat .gmgn-session.json
   ```
4. Monitor network requests:
   ```javascript
   this.page.on('request', req => console.log(req.url()));
   ```

### Common Issues

**"沒有保存的會話"**:
- Run `node setup-browser-session.js` first
- Ensure `.gmgn-session.json` exists

**"未檢測到登入狀態"**:
- Delete `.gmgn-session.json`
- Re-run `node setup-browser-session.js`
- Ensure complete login (wait for API requests to appear)

**API returns errors**:
- Check token expiration (auto-refresh should handle this)
- Verify browser is still running (`api.isReady()`)
- Re-authenticate if persistent issues

**Browser crashes or hangs**:
- Call `api.close()` and `api.init()` to restart
- Check system resources (Chromium uses ~200-300MB RAM)
- Ensure only one API instance per process

## File Structure

### Core Files (DO NOT DELETE)
- `gmgn-browser-api.js` - Main API class
- `browser-auth.js` - Browser authentication
- `token-manager.js` - Token/session management
- `gmgn-config.js` - Configuration
- `setup-browser-session.js` - Initial setup tool

### Usage Examples
- `example-usage.js` - Comprehensive usage demo
- `test-*.js` - Various feature tests

### Session Data
- `.gmgn-session.json` - Saved session (auto-generated)
- `.env` - Optional environment config

## Migration Notes

This codebase replaced earlier approaches that used:
- Direct HTTP requests (blocked by Cloudflare)
- DexScreener/CoinGecko APIs (rate-limited, unreliable)
- PancakeSwap on-chain queries (complex, not GMGN-specific)

Current approach uses browser automation for maximum reliability and feature access to GMGN.ai's API.
