import { Injectable } from '@nestjs/common';
import { Interface, Log, LogDescription, getAddress, id } from 'ethers';
import { ERC721_TRANSFER_ABI, UNS_ABI } from './constants';
import { DecodedUnsEvent } from './types';

@Injectable()
export class UnsEventDecoderService {
  // The Transfer fragment is merged into the same Interface so a single
  // parseLog call can dispatch Set / ResetRecords / Transfer events.
  private readonly iface = new Interface([...UNS_ABI, ...ERC721_TRANSFER_ABI]);

  getSetEventTopic(): string {
    return this.iface.getEvent('Set')!.topicHash;
  }

  getResetRecordsEventTopic(): string {
    return this.iface.getEvent('ResetRecords')!.topicHash;
  }

  getTransferEventTopic(): string {
    return this.iface.getEvent('Transfer')!.topicHash;
  }

  /**
   * Compute the topic hash for the indexed `keyIndex` parameter of a `Set`
   * event. Solidity hashes indexed string arguments with keccak256, so this
   * value can be used as the third topic in an eth_getLogs / eth_subscribe
   * filter to restrict `Set` events to a single record key.
   */
  getKeyIndexTopic(key: string): string {
    return id(key);
  }

  decode(log: Log): DecodedUnsEvent | null {
    let parsed: LogDescription | null;
    try {
      parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      return null;
    }

    if (!parsed) {
      return null;
    }

    const args = parsed.args as unknown as {
      tokenId: bigint;
      key: unknown;
      value: unknown;
      from: unknown;
      to: unknown;
    };

    if (parsed.name === 'Set') {
      return {
        name: 'Set',
        tokenId: args.tokenId.toString(),
        key: String(args.key),
        value: String(args.value),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        transactionIndex: log.transactionIndex,
        address: log.address.toLowerCase(),
      };
    }

    if (parsed.name === 'ResetRecords') {
      return {
        name: 'ResetRecords',
        tokenId: args.tokenId.toString(),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        transactionIndex: log.transactionIndex,
        address: log.address.toLowerCase(),
      };
    }

    if (parsed.name === 'Transfer') {
      return {
        name: 'Transfer',
        tokenId: args.tokenId.toString(),
        from: getAddress(String(args.from)).toLowerCase(),
        to: getAddress(String(args.to)).toLowerCase(),
        blockNumber: log.blockNumber,
        transactionHash: log.transactionHash,
        logIndex: log.index,
        transactionIndex: log.transactionIndex,
        address: log.address.toLowerCase(),
      };
    }

    return null;
  }
}
