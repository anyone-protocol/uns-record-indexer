import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class HiddenServiceValidatorService {
  constructor(private readonly configService: ConfigService) {}

  isValid(value: string): boolean {
    const requiredSuffix = this.configService.get<string>(
      'REQUIRED_VALUE_SUFFIX',
      '.anyone',
    );

    return value.toLowerCase().endsWith(requiredSuffix.toLowerCase());
  }
}
