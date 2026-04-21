import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Log, WebSocketProvider } from 'ethers';
import { EventProcessorService } from './event-processor.service';
import { UnsEventDecoderService } from './uns-event-decoder.service';

@Injectable()
export class RealtimeIndexerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeIndexerService.name);
  private wsProvider: WebSocketProvider | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  private shuttingDown = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly decoder: UnsEventDecoderService,
    private readonly eventProcessor: EventProcessorService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }
  }

  private async connect(): Promise<void> {
    const wsRpcUrl = this.configService.get<string>('INFURA_WS_RPC_URL', '');
    const unsAddress = this.configService.get<string>('UNS_CONTRACT_ADDRESS', '');

    if (!wsRpcUrl) {
      this.logger.warn('INFURA_WS_RPC_URL is empty; realtime indexing disabled');
      return;
    }

    if (!unsAddress) {
      this.logger.warn('UNS_CONTRACT_ADDRESS is empty; realtime indexing disabled');
      return;
    }

    this.wsProvider = new WebSocketProvider(wsRpcUrl);

    const filter = {
      address: unsAddress,
      topics: [this.decoder.getEventTopics()],
    };

    this.wsProvider.on(filter, (log: Log) => {
      void this.handleLog(log);
    });

    this.wsProvider.on('error', () => {
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.backoffMs = 1000;
    this.logger.log('Realtime websocket subscription started');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.shuttingDown) {
      return;
    }

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);

    this.logger.warn(`Realtime websocket disconnected; reconnect in ${delay}ms`);
  }

  private async reconnect(): Promise<void> {
    if (this.wsProvider) {
      this.wsProvider.removeAllListeners();
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }

    await this.connect();
  }

  private async handleLog(log: Log): Promise<void> {
    try {
      const decoded = this.decoder.decode(log);
      if (!decoded) {
        return;
      }

      await this.eventProcessor.process(decoded);
    } catch (error) {
      this.logger.error('Failed to process websocket log', error as Error);
    }
  }
}
