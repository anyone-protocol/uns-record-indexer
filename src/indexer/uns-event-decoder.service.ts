import { Injectable } from '@nestjs/common';
import { Interface, Log } from 'ethers';
import { UNS_ABI } from './constants';
import { DecodedUnsEvent } from './types';

@Injectable()
export class UnsEventDecoderService {
  private readonly iface = new Interface(UNS_ABI);

  getEventTopics(): string[] {
    return [
      this.iface.getEvent('Set')!.topicHash,
      this.iface.getEvent('ResetRecords')!.topicHash,
    ];
  }

  decode(log: Log): DecodedUnsEvent | null {
    let parsed;
    try {
      parsed = this.iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      return null;
    }

    if (!parsed) {
      return null;
    }

    if (parsed.name === 'Set') {
      return {
        name: 'Set',
        tokenId: parsed.args.tokenId.toString(),
        key: String(parsed.args.key),
        value: String(parsed.args.value),
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
        tokenId: parsed.args.tokenId.toString(),
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
