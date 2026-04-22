import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Log, WebSocketProvider } from 'ethers';
import { EventProcessorService } from './event-processor.service';
import { RpcEndpointManagerService } from './rpc/rpc-endpoint-manager.service';
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
    private readonly rpcManager: RpcEndpointManagerService,
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
      await this.wsProvider.destroy();
      this.wsProvider = null;
    }
  }

  private async connect(): Promise<void> {
    const endpoint = this.rpcManager.getActive('ws');
    const unsAddress = this.configService.get<string>(
      'UNS_CONTRACT_ADDRESS',
      '',
    );

    if (!endpoint) {
      this.logger.warn(
        'No WS RPC endpoint configured (INFURA_WS_RPC_URL / ALCHEMY_WS_RPC_URL); realtime indexing disabled',
      );
      return;
    }

    if (!unsAddress) {
      this.logger.warn(
        'UNS_CONTRACT_ADDRESS is empty; realtime indexing disabled',
      );
      return;
    }

    this.wsProvider = new WebSocketProvider(endpoint.url);

    const filter = {
      address: unsAddress,
      topics: [this.decoder.getEventTopics()],
    };

    await this.wsProvider.on(filter, (log: Log) => {
      void this.handleLog(log);
    });

    await this.wsProvider.on('error', (error: unknown) => {
      this.logger.warn(
        `Realtime websocket error on ${endpoint.name}: ${(error as Error)?.message ?? String(error)}`,
      );
      this.rpcManager.reportError('ws', 'ws_error');
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });

    this.backoffMs = 1000;
    this.logger.log(
      `Realtime websocket subscription started on ${endpoint.name}`,
    );
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

    this.logger.warn(
      `Realtime websocket disconnected; reconnect in ${delay}ms`,
    );
  }

  private async reconnect(): Promise<void> {
    if (this.wsProvider) {
      try {
        await this.wsProvider.destroy();
      } catch (error) {
        this.logger.debug(
          `Error destroying stale ws provider: ${(error as Error)?.message ?? String(error)}`,
        );
      }
      this.wsProvider = null;
    }

    await this.connect();
  }

  private async handleLog(log: Log): Promise<void> {
    this.rpcManager.reportSuccess('ws');
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
