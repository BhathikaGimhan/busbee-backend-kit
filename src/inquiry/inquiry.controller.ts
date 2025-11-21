import { Controller, Post, Get, Body, UseGuards, Req, Param } from '@nestjs/common';
import { InquiryService } from './inquiry.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request } from 'express';

@Controller('inquiry')
export class InquiryController {
  constructor(private readonly inquiryService: InquiryService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async submitInquiry(
    @Body() inquiryData: { subject: string; message: string; category?: string },
    @Req() req: Request,
  ) {
    const authenticatedUser = req.user as { userId: string; email: string };
    return await this.inquiryService.submitInquiry(
      authenticatedUser.userId,
      inquiryData,
    );
  }

  @Get('user/:userId')
  @UseGuards(JwtAuthGuard)
  async getUserInquiries(@Param('userId') userId: string) {
    return await this.inquiryService.getUserInquiries(userId);
  }

  @Get('all')
  @UseGuards(JwtAuthGuard)
  async getAllInquiries() {
    return await this.inquiryService.getAllInquiries();
  }

  @Post(':inquiryId/response')
  @UseGuards(JwtAuthGuard)
  async respondToInquiry(
    @Param('inquiryId') inquiryId: string,
    @Body() responseData: { response: string },
    @Req() req: Request,
  ) {
    const authenticatedUser = req.user as { userId: string; email: string };
    return await this.inquiryService.respondToInquiry(
      inquiryId,
      authenticatedUser.userId,
      responseData.response,
    );
  }
}
