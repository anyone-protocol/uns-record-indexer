export type DecodedUnsEvent =
  | {
      name: 'Set';
      tokenId: string;
      key: string;
      value: string;
      blockNumber: number;
      transactionHash: string;
      logIndex: number;
      transactionIndex: number;
      address: string;
    }
  | {
      name: 'ResetRecords';
      tokenId: string;
      blockNumber: number;
      transactionHash: string;
      logIndex: number;
      transactionIndex: number;
      address: string;
    }
  | {
      name: 'Transfer';
      tokenId: string;
      from: string;
      to: string;
      blockNumber: number;
      transactionHash: string;
      logIndex: number;
      transactionIndex: number;
      address: string;
    };

export type DecodedTransferEvent = Extract<
  DecodedUnsEvent,
  { name: 'Transfer' }
>;
