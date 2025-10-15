import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { BusService } from './bus.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('bus')
@UseGuards(JwtAuthGuard)
export class BusController {
  constructor(private readonly busService: BusService) {}

  @Get('pending')
  async getPendingBusRegistrations() {
    return await this.busService.getPendingBusRegistrations();
  }

  @Post(':userId/approve')
  @HttpCode(HttpStatus.OK)
  async approveBusRegistration(@Param('userId') userId: string) {
    return await this.busService.approveBusRegistration(userId);
  }

  @Post(':userId/reject')
  @HttpCode(HttpStatus.OK)
  async rejectBusRegistration(
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    return await this.busService.rejectBusRegistration(userId, body.reason);
  }

  @Get('approved')
  async getApprovedBuses() {
    return await this.busService.getApprovedBuses();
  }
}
