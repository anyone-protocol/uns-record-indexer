export const UNS_ABI = [
  'event Set(uint256 indexed tokenId, string indexed keyIndex, string indexed valueIndex, string key, string value)',
  'event ResetRecords(uint256 indexed tokenId)',
] as const;

/**
 * Standard ERC-721 Transfer event. UNS tokens are ERC-721, so this covers
 * mints (`from = 0x0`), ordinary transfers, and burns (`to = 0x0`). The
 * indexer subscribes to this separately from the record events so token
 * ownership can be tracked even for tokens that never have any UNS records
 * set on them.
 */
export const ERC721_TRANSFER_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
] as const;

export const INDEXER_CHECKPOINT_KEY = 'base-uns-indexer';
export const UNS_TOKEN_CHECKPOINT_KEY = 'base-uns-tokens';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
