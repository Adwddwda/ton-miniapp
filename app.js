/*
  app.js – logic for the TON prediction market mini app.

  This script runs in the context of a Telegram Mini App.  It imports the
  TON Core library to construct payloads and interact with the blockchain
  via TonConnect.  It also demonstrates how to respond to theme changes
  using the Telegram Mini App API【266470416382491†L620-L633】【266470416382491†L1716-L1735】.

  Before using this file you must replace the placeholder values for
  CONTRACT_ADDRESS, MANIFEST_URL, and TWA_RETURN_URL with real values
  corresponding to your deployed contract and hosted manifest.  See
  README.md for instructions.
*/

import * as TonCore from 'https://esm.sh/@ton/core@0.0.4';
import { Buffer } from 'https://esm.sh/buffer@6.0.3';

// Assign Buffer to the global window object so that @ton/core can use it.
window.Buffer = Buffer;

const { beginCell } = TonCore;

// ======== Configuration ========
// Address of your deployed PredictionMarket contract.  Replace with a real
// address once you have deployed the contract using Tact.  The address
// must be in user friendly format (e.g. EQ... or UQ...).
const CONTRACT_ADDRESS = 'EQXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

// URL pointing to your hosted tonconnect manifest.  This must use HTTPS and
// be reachable from the Telegram Mini App.  See manifest.json in this
// repository for an example structure【59512868102778†L74-L105】.
const MANIFEST_URL = 'https://example.com/miniapp/manifest.json';

// t.me link used by TonConnect to return the user to your bot after
// completing a wallet action outside of Telegram.  Replace <botUsername> with
// your bot’s username (without the @ symbol).  Example:
//   'https://t.me/my_prediction_bot'
const TWA_RETURN_URL = 'https://t.me/<botUsername>';

// Default bet amount (in TON) that will be sent when the user clicks a bet
// button.  You can modify this value or allow users to choose their own.
const DEFAULT_BET_AMOUNT = 0.2;

// ======== Helpers ========

/**
 * Construct a BOC payload containing a 32‑bit operation code.  The
 * PredictionMarket contract uses the following op codes:
 *   0 – bet on "yes"
 *   1 – bet on "no"
 *   2 – resolve the market (only owner)
 *   3 – claim winnings
 *
 * @param {number} op the operation code
 * @returns {string} base64‑encoded BOC
 */
function buildPayload(op) {
  const cell = beginCell().storeUint(op, 32).endCell();
  // Convert the cell to a BOC (Bag of Cells) binary representation.  The
  // returned value is a Uint8Array.  Use Buffer to convert it to a
  // base64 string because window.Buffer has been polyfilled above.
  const boc = cell.toBoc();
  return Buffer.from(boc).toString('base64');
}

/**
 * Convert a TON value in whole TON to nanotons (1 TON = 1e9 nanotons).
 * TonConnect expects amounts as decimal strings of nanotons.
 *
 * @param {number} amountTon value in TON
 * @returns {string} string representation in nanotons
 */
function toNanoString(amountTon) {
  const nano = BigInt(Math.floor(amountTon * 1e9));
  return nano.toString();
}

// ======== Initialise TonConnect ========

// Create a TonConnectUI instance.  The buttonRootId must match the id
// provided in index.html.  The twaReturnUrl ensures that mobile wallets can
// return the user to your bot after the transaction.
const tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
  manifestUrl: MANIFEST_URL,
  buttonRootId: 'wallet-connect',
  twaReturnUrl: TWA_RETURN_URL
});

// Keep track of the current wallet connection status.
let connected = false;

// Listen for wallet status changes.  When connected update the UI and
// enable bet/claim buttons; when disconnected hide them.
tonConnectUI.onStatusChange(async (wallet) => {
  connected = !!wallet;
  toggleInteraction(connected);
  if (connected) {
    await updatePools();
  }
});

// ======== Telegram Mini App integration ========

// Signal to Telegram that the app is ready and request the app to be shown
// with the full screen layout.
if (window.Telegram && Telegram.WebApp) {
  Telegram.WebApp.ready();
  Telegram.WebApp.expand();
  applyTheme(Telegram.WebApp.themeParams, Telegram.WebApp.colorScheme);
  // Listen for theme changes and reapply styles accordingly【266470416382491†L1716-L1735】.
  Telegram.WebApp.onEvent('themeChanged', () => {
    applyTheme(Telegram.WebApp.themeParams, Telegram.WebApp.colorScheme);
  });
}

/**
 * Apply colours from Telegram theme parameters to CSS variables.  The
 * parameters object contains fields like bg_color, text_color, etc., and
 * colorScheme indicates if the current theme is light or dark【266470416382491†L620-L633】【266470416382491†L892-L939】.
 *
 * @param {object} params Telegram themeParams object
 * @param {string} scheme either 'light' or 'dark'
 */
function applyTheme(params, scheme) {
  const root = document.documentElement;
  if (!params) return;
  // Map theme parameters to CSS variables with fallbacks
  root.style.setProperty('--bg-color', `#${params.bg_color || (scheme === 'dark' ? '0d1117' : 'f5f5f5')}`);
  root.style.setProperty('--text-color', `#${params.text_color || (scheme === 'dark' ? 'ffffff' : '202020')}`);
  root.style.setProperty('--button-color', `#${params.button_color || (scheme === 'dark' ? '2a86ff' : '0088cc')}`);
  root.style.setProperty('--button-text-color', `#${params.button_text_color || 'ffffff'}`);
  root.style.setProperty('--hint-color', `#${params.hint_color || (scheme === 'dark' ? '888888' : '6d6d6d')}`);
  root.style.setProperty('--section-bg', `#${params.secondary_bg_color || (scheme === 'dark' ? '161c26' : 'ffffff')}`);
}

/**
 * Enable or disable interaction buttons based on wallet connection status.
 *
 * @param {boolean} isConnected
 */
function toggleInteraction(isConnected) {
  document.getElementById('yes-btn').disabled = !isConnected;
  document.getElementById('no-btn').disabled = !isConnected;
  document.getElementById('claim-btn').disabled = !isConnected;
}

// ======== Event handlers ========

// Bet on "yes"
document.getElementById('yes-btn').addEventListener('click', async () => {
  if (!connected) return;
  await placeBet(0);
});

// Bet on "no"
document.getElementById('no-btn').addEventListener('click', async () => {
  if (!connected) return;
  await placeBet(1);
});

// Claim winnings
document.getElementById('claim-btn').addEventListener('click', async () => {
  if (!connected) return;
  await claimWinnings();
});

/**
 * Send a bet transaction to the contract.  The op code determines whether
 * the bet is for "yes" (0) or "no" (1).  The amount is taken from
 * DEFAULT_BET_AMOUNT and converted to nanotons.
 *
 * @param {number} op op code: 0 for yes, 1 for no
 */
async function placeBet(op) {
  const payload = buildPayload(op);
  const tx = {
    validUntil: Math.floor(Date.now() / 1000) + 600, // valid for 10 minutes
    messages: [
      {
        address: CONTRACT_ADDRESS,
        amount: toNanoString(DEFAULT_BET_AMOUNT),
        payload
      }
    ]
  };
  try {
    await tonConnectUI.sendTransaction(tx);
    await updatePools();
  } catch (error) {
    console.error('Bet failed:', error);
  }
}

/**
 * Send a claim transaction.  The payload op code 3 tells the contract
 * to transfer the user’s winnings.  No TON value is attached to this
 * message.
 */
async function claimWinnings() {
  const payload = buildPayload(3);
  const tx = {
    validUntil: Math.floor(Date.now() / 1000) + 600,
    messages: [
      {
        address: CONTRACT_ADDRESS,
        amount: '0',
        payload
      }
    ]
  };
  try {
    await tonConnectUI.sendTransaction(tx);
    await updatePools();
  } catch (error) {
    console.error('Claim failed:', error);
  }
}

/**
 * Fetch the latest pool sizes and resolution state from the blockchain.
 * In a production system you should use a trusted API (e.g. tonapi.io or
 * a self‑hosted indexer) to read the contract’s getters.  Here we call
 * tonapi.io anonymously for demonstration purposes.  The API returns the
 * result of the getTotals and getState getters.  Note that unauthenticated
 * requests may be rate limited.
 */
async function updatePools() {
  try {
    const totalsRes = await fetch(
      `https://tonapi.io/v1/blockchain/getter?address=${CONTRACT_ADDRESS}&method=getTotals`);
    const stateRes = await fetch(
      `https://tonapi.io/v1/blockchain/getter?address=${CONTRACT_ADDRESS}&method=getState`);
    if (!totalsRes.ok || !stateRes.ok) {
      throw new Error('Failed to fetch contract state');
    }
    const totalsData = await totalsRes.json();
    const stateData = await stateRes.json();
    const yes = parseInt(totalsData.output[0]);
    const no = parseInt(totalsData.output[1]);
    const marketState = parseInt(stateData.output[0]);
    const outcome = parseInt(stateData.output[1]);

    document.getElementById('yes-pool').textContent = `${(yes / 1e9).toFixed(2)} TON`;
    document.getElementById('no-pool').textContent = `${(no / 1e9).toFixed(2)} TON`;

    // Show claim button only when the market is resolved
    const claimSection = document.getElementById('claim-section');
    if (marketState === 1) {
      claimSection.hidden = false;
    } else {
      claimSection.hidden = true;
    }
  } catch (err) {
    console.error('Unable to update pools:', err);
  }
}

// Initially disable buttons until a wallet is connected
toggleInteraction(false);