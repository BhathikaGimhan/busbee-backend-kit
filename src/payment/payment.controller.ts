import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PaymentService, PayHereNotifyPayload } from './payment.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('payment')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  createCheckout(@Body() dto: CreateCheckoutDto, @Req() req: Request) {
    const authenticatedUser = req.user as { userId: string; email: string };
    const customerName =
      dto.customerName || authenticatedUser.email.split('@')[0];

    return this.paymentService.createCheckoutPayload(
      dto,
      authenticatedUser.email,
      customerName,
    );
  }

  @Post('notify')
  @HttpCode(HttpStatus.OK)
  handleNotify(@Body() payload: PayHereNotifyPayload) {
    this.paymentService.handleNotification(payload);
    return { status: 'ok' };
  }
}
