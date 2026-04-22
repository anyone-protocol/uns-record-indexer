import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HARD_ROTATE_REASONS,
  RpcEndpoint,
  RpcFailureReason,
  RpcTransport,
} from './rpc-endpoint.types';

type TransportState = {
  endpoints: RpcEndpoint[];
  activeIndex: number;
  consecutiveErrors: number;
  rotatedAt: number | null;
};

@Injectable()
export class RpcEndpointManagerService {
  private readonly logger = new Logger(RpcEndpointManagerService.name);
  private readonly cooldownMs: number;
  private readonly errorThreshold: number;
  private readonly healBackEnabled: boolean;
  private readonly states: Record<RpcTransport, TransportState>;

  constructor(private readonly configService: ConfigService) {
    this.cooldownMs = Number(
      this.configService.get<string>('RPC_FAILOVER_COOLDOWN_MS', '600000'),
    );
    this.errorThreshold = Math.max(
      1,
      Number(
        this.configService.get<string>('RPC_FAILOVER_ERROR_THRESHOLD', '3'),
      ),
    );
    this.healBackEnabled =
      this.configService
        .get<string>('RPC_FAILOVER_HEAL_BACK_ENABLED', 'true')
        .toLowerCase() !== 'false';

    this.states = {
      ws: this.buildState('ws'),
      http: this.buildState('http'),
    };

    this.logger.log(
      `RPC failover config: healBack=${this.healBackEnabled ? `enabled (cooldown=${this.cooldownMs}ms)` : 'disabled'}, errorThreshold=${this.errorThreshold}`,
    );

    for (const transport of ['ws', 'http'] as const) {
      const state = this.states[transport];
      if (state.endpoints.length === 0) {
        this.logger.warn(
          `No ${transport.toUpperCase()} RPC endpoints configured; service will run without RPC access`,
        );
      } else if (state.endpoints.length === 1) {
        this.logger.warn(
          `Only one ${transport.toUpperCase()} RPC endpoint configured (${state.endpoints[0].name}); failover disabled for this transport`,
        );
      } else {
        this.logger.log(
          `${transport.toUpperCase()} RPC endpoints: primary=${state.endpoints[0].name}, backup=${state.endpoints[1].name}`,
        );
      }
    }
  }

  getActive(transport: RpcTransport): RpcEndpoint | null {
    const state = this.states[transport];
    if (state.endpoints.length === 0) {
      return null;
    }

    // Heal back to primary after cooldown (unless disabled).
    if (
      this.healBackEnabled &&
      state.activeIndex !== 0 &&
      state.rotatedAt !== null &&
      Date.now() - state.rotatedAt >= this.cooldownMs
    ) {
      const from = state.endpoints[state.activeIndex].name;
      state.activeIndex = 0;
      state.consecutiveErrors = 0;
      state.rotatedAt = null;
      this.logger.log(
        `RPC heal-back: ${transport} ${from} → ${state.endpoints[0].name} (cooldown elapsed)`,
      );
    }

    return state.endpoints[state.activeIndex];
  }

  reportSuccess(transport: RpcTransport): void {
    const state = this.states[transport];
    if (state.consecutiveErrors !== 0) {
      state.consecutiveErrors = 0;
    }
  }

  reportError(transport: RpcTransport, reason: RpcFailureReason): void {
    const state = this.states[transport];
    if (state.endpoints.length === 0) {
      return;
    }

    state.consecutiveErrors += 1;
    this.logger.debug(
      `RPC error on ${transport} ${state.endpoints[state.activeIndex].name}: reason=${reason} consecutiveErrors=${state.consecutiveErrors}`,
    );

    const shouldRotate =
      HARD_ROTATE_REASONS.has(reason) ||
      state.consecutiveErrors >= this.errorThreshold;

    if (shouldRotate) {
      this.rotate(transport, reason);
    }
  }

  private rotate(transport: RpcTransport, reason: RpcFailureReason): void {
    const state = this.states[transport];
    if (state.endpoints.length < 2) {
      this.logger.warn(
        `RPC rotate requested on ${transport} (reason=${reason}) but no backup endpoint configured; staying on ${state.endpoints[0]?.name ?? 'none'}`,
      );
      return;
    }

    const fromIndex = state.activeIndex;
    const toIndex = (state.activeIndex + 1) % state.endpoints.length;
    const from = state.endpoints[fromIndex].name;
    const to = state.endpoints[toIndex].name;

    state.activeIndex = toIndex;
    state.rotatedAt = Date.now();
    state.consecutiveErrors = 0;

    const triggeredBy =
      reason === 'threshold' || !HARD_ROTATE_REASONS.has(reason)
        ? `reason=${reason} (threshold=${this.errorThreshold})`
        : `reason=${reason}`;

    this.logger.warn(
      `RPC failover: ${transport} ${from} → ${to} (${triggeredBy})`,
    );
  }

  private buildState(transport: RpcTransport): TransportState {
    const endpoints: RpcEndpoint[] = [];
    const infuraKey =
      transport === 'ws' ? 'INFURA_WS_RPC_URL' : 'INFURA_HTTP_RPC_URL';
    const alchemyKey =
      transport === 'ws' ? 'ALCHEMY_WS_RPC_URL' : 'ALCHEMY_HTTP_RPC_URL';

    const infuraUrl = this.configService.get<string>(infuraKey, '').trim();
    const alchemyUrl = this.configService.get<string>(alchemyKey, '').trim();

    if (infuraUrl) {
      endpoints.push({ name: 'infura', url: infuraUrl });
    }
    if (alchemyUrl) {
      endpoints.push({ name: 'alchemy', url: alchemyUrl });
    }

    return {
      endpoints,
      activeIndex: 0,
      consecutiveErrors: 0,
      rotatedAt: null,
    };
  }
}
