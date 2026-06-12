import { Controller, Get, Post, Body, HttpCode } from '@nestjs/common';
import { SetupService } from './setup.service';
import { InitializeDto } from './dto/initialize.dto';

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  getStatus() { return this.setup.getStatus(); }

  @Post('test-llm')
  @HttpCode(200)
  testLlm(@Body() body: { apiKey: string }) { return this.setup.testLlm(body.apiKey); }

  @Post('initialize')
  @HttpCode(201)
  initialize(@Body() dto: InitializeDto) { return this.setup.initialize(dto); }
}
