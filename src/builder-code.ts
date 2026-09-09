// Base Builder Code — ERC-8021 transaction attribution.
//
// Registers Moni's agent activity on Base with a builder code so it shows up in
// base.dev analytics / the Builder Code leaderboard. The code is appended to
// every trade Moni broadcasts as an ERC-8021 calldata suffix. Contracts ignore
// the trailing bytes; offchain indexers parse them back out of tx.input.
//
// Registered reward/payout wallet (self-custody, Base mainnet): OKX
//   0xe2b5355ca98bd39ed175b9f72cb13da3488eb287
// Registered via POST https://api.base.dev/v1/agents/builder-codes
export const BUILDER_CODE = 'bc_es9rlwqi';

export const BUILDER_CODE_PAYOUT_WALLET = '0xe2b5355ca98bd39ed175b9f72cb13da3488eb287';

// Fixed ERC-8021 end marker: `0x8021` x 8 (16 bytes).
const ERC8021_MARKER = '80218021802180218021802180218021';
// Schema 0: simple ASCII (comma-delimited) codes.
const ERC8021_SCHEMA_ID = '00';

// Wire format (parsed backwards): codes ∥ codesLength(1B) ∥ schemaId(1B) ∥ marker(16B).
// e.g. "bc_es9rlwqi" → 0x62635f657339726c777169 0b 00 8021…
export function encodeAttributionSuffix(code: string = BUILDER_CODE): `0x${string}` {
  const codeHex = Buffer.from(code, 'utf8').toString('hex');
  const codeByteLen = codeHex.length / 2;
  if (codeByteLen > 255) {
    throw new Error(`Builder code too long for ERC-8021 schema 0: ${codeByteLen} bytes`);
  }
  const codeLengthHex = codeByteLen.toString(16).padStart(2, '0');
  return `0x${codeHex}${codeLengthHex}${ERC8021_SCHEMA_ID}${ERC8021_MARKER}`;
}

// Pre-computed suffix to pass as `dataSuffix` on every broadcast tx.
export const BUILDER_CODE_DATA_SUFFIX = encodeAttributionSuffix(BUILDER_CODE);