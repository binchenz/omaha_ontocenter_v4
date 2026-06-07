import { Module } from '@nestjs/common';
import { ConnectorSdk } from './connector.sdk';
import { ConnectorClient } from './connector-client.service';

@Module({
  providers: [ConnectorSdk, ConnectorClient],
  exports: [ConnectorSdk, ConnectorClient],
})
export class ConnectorSdkModule {}
